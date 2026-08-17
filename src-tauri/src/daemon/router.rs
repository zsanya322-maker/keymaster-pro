use serde::Deserialize;
use serde_json::{Value, json};
use tracing::info;

use crate::daemon::state::DaemonStateRef;

fn current_tap_hold_timeout() -> u64 {
    crate::shared::config::load_config()
        .map(|c| c.tap_hold_timeout_ms)
        .unwrap_or(200)
}

fn profile_exists(id: &str) -> Result<bool, String> {
    Ok(crate::shared::persistence::list_profiles()?
        .iter()
        .any(|existing| existing == id))
}

fn default_profile_id() -> Result<Option<String>, String> {
    for id in crate::shared::persistence::list_profiles()? {
        if let Ok(profile) = crate::shared::persistence::load_profile_checked(&id) {
            if profile.is_default {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}

fn update_active_profile_runtime(
    profile: crate::shared::types::Profile,
    state: &DaemonStateRef,
) -> Result<(), String> {
    let mut s = state.write().map_err(|_| "Failed to lock state")?;
    if s.active_profile_id == profile.id {
        let frontend_config = crate::schemas::frontend::FrontendConfig {
            rules: profile.rules.clone(),
            layers: profile.layers.clone(),
            tap_hold_timeout_ms: current_tap_hold_timeout(),
        };
        s.engine_schema = crate::daemon::compiler::compile_schema(&frontend_config);
        if let Ok(mut input) = s.advanced_input.lock() {
            input.reset();
        }
        s.active_profile = Some(profile);
    }
    Ok(())
}

fn remap_layer_action(
    action: &mut crate::schemas::frontend::FrontendAction,
    layer_ids: &std::collections::HashMap<String, String>,
) {
    use crate::schemas::frontend::FrontendAction;
    match action {
        FrontendAction::ToggleLayer { layer_id } | FrontendAction::HoldLayer { layer_id } => {
            if let Some(new_id) = layer_ids.get(layer_id) {
                *layer_id = new_id.clone();
            }
        }
        _ => {}
    }
}

fn regenerate_profile_identity(
    profile: &mut crate::shared::types::Profile,
    new_profile_id: String,
    new_name: String,
) {
    let mut layer_ids = std::collections::HashMap::new();
    for layer in &mut profile.layers {
        let old_id = layer.id.clone();
        let new_id = uuid::Uuid::new_v4().to_string();
        layer.id = new_id.clone();
        layer_ids.insert(old_id, new_id);
    }

    let mut folder_ids = std::collections::HashMap::new();
    for folder in &mut profile.folders {
        let old_id = folder.id.clone();
        let new_id = uuid::Uuid::new_v4().to_string();
        folder.id = new_id.clone();
        folder_ids.insert(old_id, new_id);
    }
    for folder in &mut profile.folders {
        if let Some(parent_id) = folder.parent_id.as_mut() {
            if let Some(new_id) = folder_ids.get(parent_id) {
                *parent_id = new_id.clone();
            }
        }
    }

    for rule in &mut profile.rules {
        rule.id = uuid::Uuid::new_v4().to_string();
        if let Some(folder_id) = rule.folder_id.as_mut() {
            if let Some(new_id) = folder_ids.get(folder_id) {
                *folder_id = new_id.clone();
            }
        }
        for condition in &mut rule.conditions {
            if let crate::schemas::frontend::FrontendCondition::LayerActive { layer_id } = condition
            {
                if let Some(new_id) = layer_ids.get(layer_id) {
                    *layer_id = new_id.clone();
                }
            }
        }
        for action in &mut rule.actions {
            remap_layer_action(action, &layer_ids);
        }
        if let Some(actions) = rule.hold_actions.as_mut() {
            for action in actions {
                remap_layer_action(action, &layer_ids);
            }
        }
    }

    profile.id = new_profile_id;
    profile.name = new_name;
    profile.is_default = false;
    profile.order = profile.order.saturating_add(1);
}

/// Helper function to load, modify, save, and update the active profile in DaemonState.
/// Recovery placeholders are intentionally rejected here: a broken source is
/// visible in profile.list but can never be edited into a new empty profile.
fn modify_profile<F>(profile_id: &str, state: &DaemonStateRef, f: F) -> Result<(), String>
where
    F: FnOnce(&mut crate::shared::types::Profile),
{
    let mut profile = crate::shared::persistence::load_profile_checked(profile_id)?;
    f(&mut profile);
    crate::shared::persistence::save_profile(&profile)?;
    update_active_profile_runtime(profile, state)
}

/// Central router to dispatch all IPC JSON-RPC commands from Frontend
pub async fn dispatch(
    method: &str,
    params: Option<Value>,
    state: &DaemonStateRef,
) -> Result<Value, String> {
    info!("IPC Router received command: {}", method);

    match method {
        // Profiles
        "profile.list" => {
            let mut ids = crate::shared::persistence::list_profiles()?;
            if ids.is_empty() {
                let default_prof = crate::shared::types::Profile {
                    id: "1".to_string(),
                    name: "Default".to_string(),
                    is_default: true,
                    linked_apps: vec![],
                    bindings: vec![],
                    order: 0,
                    rules: vec![],
                    layers: vec![],
                    folders: vec![],
                };
                crate::shared::persistence::save_profile(&default_prof)?;
                ids.push("1".to_string());
            }
            let mut list = Vec::new();
            for id in ids {
                // Deliberately use recovery-capable load here: damaged files
                // must remain visible to the user as "Ошибка загрузки" entries.
                if let Ok(prof) = crate::shared::persistence::load_profile(&id) {
                    list.push(prof);
                }
            }
            list.sort_by(|a, b| {
                a.order
                    .cmp(&b.order)
                    .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });
            let active = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            Ok(json!({ "profiles": list, "active": active }))
        }
        "profile.activate" => {
            let id = params
                .as_ref()
                .and_then(|value| value.get("id"))
                .and_then(|value| value.as_str())
                .ok_or("Missing profile id")?;
            let profile = crate::shared::persistence::load_profile_checked(id)?;

            // Manual activation owns persistence. Auto-switch changes runtime only.
            let mut config = crate::shared::config::load_config()?;
            config.active_profile_id = id.to_string();
            crate::shared::config::save_config(&config)?;

            crate::daemon::profile_runtime::activate_runtime(state, profile)?;
            {
                let mut daemon = state.write().map_err(|_| "Failed to lock state")?;
                daemon.preferred_profile_id = id.to_string();
            }
            Ok(json!({ "success": true }))
        }
        "profile.create" => {
            if let Some(p) = params {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct ProfileInput {
                    id: String,
                    name: String,
                    is_default: bool,
                    linked_apps: Option<Vec<String>>,
                }
                let input: ProfileInput = serde_json::from_value(p).map_err(|e| e.to_string())?;

                if profile_exists(&input.id)? {
                    return Err(format!(
                        "Профиль с ID '{}' уже существует; создание не может перезаписывать существующий профиль",
                        input.id
                    ));
                }
                if input.is_default {
                    if let Some(existing_default) = default_profile_id()? {
                        return Err(format!(
                            "Профиль по умолчанию уже существует ({}); второй default-профиль создать нельзя",
                            existing_default
                        ));
                    }
                }

                let prof = crate::shared::types::Profile {
                    id: input.id,
                    name: input.name,
                    is_default: input.is_default,
                    linked_apps: input.linked_apps.unwrap_or_default(),
                    bindings: vec![],
                    order: 0,
                    rules: vec![],
                    layers: vec![],
                    folders: vec![],
                };

                crate::shared::persistence::save_profile(&prof)?;
                update_active_profile_runtime(prof, state)?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "profile.save" => {
            if let Some(p) = params {
                let prof: crate::shared::types::Profile =
                    serde_json::from_value(p).map_err(|e| e.to_string())?;
                if !profile_exists(&prof.id)? {
                    return Err(format!(
                        "Профиль '{}' не существует; используйте profile.create или profile.import",
                        prof.id
                    ));
                }

                // isDefault is a protected identity flag, not an ordinary editable
                // field. Checked load also prevents saving over a recovery placeholder.
                let existing = crate::shared::persistence::load_profile_checked(&prof.id)?;
                if existing.is_default != prof.is_default {
                    return Err(format!(
                        "Флаг профиля по умолчанию для '{}' нельзя менять через profile.save",
                        prof.id
                    ));
                }

                crate::shared::persistence::save_profile(&prof)?;
                update_active_profile_runtime(prof, state)?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "profile.import" => {
            if let Some(p) = params {
                // Import is schema-aware: legacy v0 is accepted/migrated in memory,
                // future or malformed schema is rejected before anything reaches disk.
                let mut prof = crate::shared::persistence::import_profile_value(p)?;
                if profile_exists(&prof.id)? {
                    return Err(format!(
                        "Профиль с ID '{}' уже существует; импорт не может перезаписывать существующий профиль",
                        prof.id
                    ));
                }

                // Импортированный профиль не должен создавать второго protected
                // default-профиля в уже существующей конфигурации.
                if prof.is_default && default_profile_id()?.is_some() {
                    prof.is_default = false;
                }

                crate::shared::persistence::save_profile(&prof)?;
                update_active_profile_runtime(prof, state)?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "profile.delete" => {
            let id = params
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(|i| i.as_str())
                .unwrap_or("");
            // Recovery-capable load is intentional here: a broken *inactive*
            // profile may be deleted after persistence creates its mandatory backup.
            let profile = crate::shared::persistence::load_profile(id)?;
            if profile.is_default {
                return Err("Профиль по умолчанию нельзя удалить".to_string());
            }
            let active_id = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            if active_id == id {
                return Err(
                    "Активный профиль нельзя удалить; сначала переключитесь на другой".to_string(),
                );
            }
            crate::shared::persistence::delete_profile(id)?;
            Ok(json!({ "success": true }))
        }
        "profile.rename" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Missing id")?;
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .ok_or("Missing name")?
                .trim();
            if name.is_empty() {
                return Err("Name is empty".into());
            }
            let mut profile = crate::shared::persistence::load_profile_checked(id)?;
            profile.name = name.to_string();
            crate::shared::persistence::save_profile(&profile)?;
            update_active_profile_runtime(profile, state)?;
            Ok(json!({"success": true}))
        }
        "profile.duplicate" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Missing id")?;
            let mut profile = crate::shared::persistence::load_profile_checked(id)?;
            let new_id = value
                .get("newId")
                .and_then(Value::as_str)
                .filter(|candidate| !candidate.trim().is_empty() && *candidate != id)
                .map(str::to_string)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            if profile_exists(&new_id)? {
                return Err("Duplicate target profile id already exists".into());
            }
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{} copy", profile.name));
            regenerate_profile_identity(&mut profile, new_id, name);
            crate::shared::persistence::save_profile(&profile)?;
            serde_json::to_value(profile).map_err(|error| error.to_string())
        }
        "profile.reorder" => {
            let value = params.ok_or("Missing parameters")?;
            let ids = value
                .get("ids")
                .and_then(Value::as_array)
                .ok_or("Missing ids")?;
            for (index, id) in ids.iter().filter_map(Value::as_str).enumerate() {
                if let Ok(mut profile) = crate::shared::persistence::load_profile_checked(id) {
                    profile.order = index as i32;
                    crate::shared::persistence::save_profile(&profile)?;
                }
            }
            Ok(json!({"success": true}))
        }
        "profile.backups" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Missing id")?;
            Ok(json!({"backups": crate::shared::persistence::list_profile_backups(id)?}))
        }
        "profile.backup.create" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Missing id")?;
            Ok(json!({"name": crate::shared::persistence::create_profile_backup(id)?}))
        }
        "profile.backup.restore" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Missing id")?;
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .ok_or("Missing name")?;
            let profile = crate::shared::persistence::restore_profile_backup(id, name)?;
            update_active_profile_runtime(profile.clone(), state)?;
            serde_json::to_value(profile).map_err(|error| error.to_string())
        }
        "profile.runtime_status" => {
            let daemon = state.read().map_err(|_| "Failed to lock state")?;
            Ok(json!({
                "active": daemon.active_profile_id,
                "preferred": daemon.preferred_profile_id,
                "autoSwitch": daemon.auto_switch_profiles,
                "manualLock": daemon.manual_profile_lock
            }))
        }

        "apply_onboarding_example" => {
            if let Some(p) = params {
                let example_type = p.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if !matches!(example_type, "remap" | "expansion" | "macro") {
                    return Err(format!(
                        "Неизвестный тип onboarding-примера: {}",
                        example_type
                    ));
                }

                let active_id = {
                    let s = state.read().map_err(|_| "Failed to lock state")?;
                    s.active_profile_id.clone()
                };

                modify_profile(&active_id, state, |prof| {
                    use crate::schemas::frontend::{
                        FrontendAction, FrontendRule, FrontendTrigger, KeyChord, MacroAction,
                        MacroPlayback, MacroStep,
                    };
                    let new_rule = match example_type {
                        "remap" => FrontendRule {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: Some("Caps Lock -> Backspace".to_string()),
                            trigger: FrontendTrigger::KeyDown {
                                chord: KeyChord::single(20),
                            }, // VK_CAPITAL
                            actions: vec![FrontendAction::RemapKey {
                                chord: KeyChord::single(8),
                            }], // VK_BACK
                            hold_actions: None,
                            conditions: vec![],
                            priority: 10,
                            enabled: true,
                            folder_id: None,
                            order: prof.rules.len() as i32,
                        },
                        "expansion" => FrontendRule {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: Some("Email Expansion".to_string()),
                            trigger: FrontendTrigger::TypedText {
                                sequence: "@@".to_string(),
                                mode: crate::schemas::frontend::TextExpansionMode::Instant,
                                delimiters: " \t\n.,;:!?".into(),
                                case_sensitive: true,
                            },
                            actions: vec![FrontendAction::TypeText {
                                text: "user@example.com".to_string(),
                                date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                                time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                            }],
                            hold_actions: None,
                            conditions: vec![],
                            priority: 10,
                            enabled: true,
                            folder_id: None,
                            order: prof.rules.len() as i32,
                        },
                        "macro" => FrontendRule {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: Some("Demo Macro".to_string()),
                            trigger: FrontendTrigger::KeyDown {
                                chord: KeyChord::single(123),
                            }, // F12
                            actions: vec![FrontendAction::RunMacro {
                                steps: vec![
                                    MacroStep {
                                        action: MacroAction::KeyDown { code: 72 },
                                        delay_ms: 50,
                                    }, // H
                                    MacroStep {
                                        action: MacroAction::KeyUp { code: 72 },
                                        delay_ms: 50,
                                    },
                                    MacroStep {
                                        action: MacroAction::KeyDown { code: 69 },
                                        delay_ms: 50,
                                    }, // E
                                    MacroStep {
                                        action: MacroAction::KeyUp { code: 69 },
                                        delay_ms: 50,
                                    },
                                ],
                                playback: MacroPlayback::default(),
                            }],
                            hold_actions: None,
                            conditions: vec![],
                            priority: 10,
                            enabled: true,
                            folder_id: None,
                            order: prof.rules.len() as i32,
                        },
                        _ => unreachable!(),
                    };
                    prof.rules.push(new_rule);
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }

        // Macro playback / preview. Preview compiles through the same compiler
        // helpers and executes through the same macro-player as a real rule.
        "macro.preview" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct MacroPreviewInput {
                steps: Vec<crate::schemas::frontend::MacroStep>,
                #[serde(default)]
                playback: crate::schemas::frontend::MacroPlayback,
            }

            let input: MacroPreviewInput =
                serde_json::from_value(params.ok_or_else(|| "Missing parameters".to_string())?)
                    .map_err(|e| e.to_string())?;
            let commands = crate::daemon::compiler::compile_macro_commands(&input.steps);
            let mut playback = crate::daemon::compiler::compile_macro_playback(&input.playback);
            // A preview must always be bounded. Repeat count/speed are preserved,
            // while "while held" is a source-input lifecycle concept.
            playback.repeat_while_held = false;
            let simulator = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.simulator
                    .clone()
                    .ok_or_else(|| "Simulator is not ready".to_string())?
            };
            let job_id = simulator.send_macro(
                commands,
                playback,
                crate::shared::calculate_hash(&"__macro_preview__"),
            )?;
            Ok(json!({ "success": true, "jobId": job_id }))
        }
        "macro.stop_playback" => {
            let simulator = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.simulator
                    .clone()
                    .ok_or_else(|| "Simulator is not ready".to_string())?
            };
            simulator.cancel_current_macro();
            Ok(json!({ "success": true }))
        }
        "macro.emergency_stop" => {
            let simulator = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.simulator
                    .clone()
                    .ok_or_else(|| "Simulator is not ready".to_string())?
            };
            simulator.cancel_all_macros();
            Ok(json!({ "success": true }))
        }

        // Macro recording
        "macro.start_recording" => {
            let record_mouse_moves = params
                .as_ref()
                .and_then(|p| p.get("recordMouseMoves"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let record_mouse_drag_drop_only = params
                .as_ref()
                .and_then(|p| p.get("recordMouseDragDropOnly"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let existing_steps_opt = params
                .as_ref()
                .and_then(|p| p.get("existingSteps"))
                .and_then(|v| {
                    serde_json::from_value::<Vec<crate::schemas::frontend::MacroStep>>(v.clone())
                        .ok()
                });

            let s = state.read().map_err(|_| "Failed to lock state")?;
            s.is_recording
                .store(true, std::sync::atomic::Ordering::Relaxed);
            s.record_mouse_moves
                .store(record_mouse_moves, std::sync::atomic::Ordering::Relaxed);
            s.record_mouse_drag_drop_only.store(
                record_mouse_drag_drop_only,
                std::sync::atomic::Ordering::Relaxed,
            );

            if let Ok(mut steps) = s.recorded_steps.lock() {
                if let Some(existing) = existing_steps_opt {
                    *steps = existing;
                } else {
                    steps.clear();
                }
            }
            if let Ok(mut last_time) = s.last_record_time.lock() {
                *last_time = None;
            }
            if let Ok(mut last_pos) = crate::daemon::hooks::LAST_RECORDED_MOUSE_POS.lock() {
                *last_pos = None;
            }
            if let Ok(mut last_mouse_time) = crate::daemon::hooks::LAST_RECORDED_MOUSE_TIME.lock() {
                *last_mouse_time = None;
            }
            Ok(json!({ "success": true }))
        }
        "macro.stop_recording" => {
            let steps = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.is_recording
                    .store(false, std::sync::atomic::Ordering::Relaxed);
                let steps_guard = s
                    .recorded_steps
                    .lock()
                    .map_err(|_| "Failed to lock recorded steps")?;
                steps_guard.clone()
            };
            let val = serde_json::to_value(&steps).map_err(|e| e.to_string())?;
            Ok(json!({ "steps": val }))
        }
        "macro.get_recording_status" => {
            let s = state.read().map_err(|_| "Failed to lock state")?;
            let is_recording = s.is_recording.load(std::sync::atomic::Ordering::Relaxed);
            let count = s.recorded_steps.lock().map(|g| g.len()).unwrap_or(0);
            Ok(json!({
                "isRecording": is_recording,
                "stepsCount": count
            }))
        }
        "macro.set_record_ready" => {
            if let Some(p) = params {
                let ready = p.get("ready").and_then(|v| v.as_bool()).unwrap_or(false);
                let record_mouse_moves = p
                    .get("recordMouseMoves")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let record_mouse_drag_drop_only = p
                    .get("recordMouseDragDropOnly")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let existing_steps_opt = p.get("existingSteps").and_then(|v| {
                    serde_json::from_value::<Vec<crate::schemas::frontend::MacroStep>>(v.clone())
                        .ok()
                });

                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.record_ready
                    .store(ready, std::sync::atomic::Ordering::Relaxed);
                s.record_mouse_moves
                    .store(record_mouse_moves, std::sync::atomic::Ordering::Relaxed);
                s.record_mouse_drag_drop_only.store(
                    record_mouse_drag_drop_only,
                    std::sync::atomic::Ordering::Relaxed,
                );

                if let Ok(mut steps) = s.recorded_steps.lock() {
                    if ready {
                        if let Some(existing) = existing_steps_opt {
                            *steps = existing;
                        } else {
                            steps.clear();
                        }
                    } else {
                        steps.clear();
                    }
                }
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }

        "keycapture.set_active" => {
            // Включает/выключает режим захвата клавиши/кнопки для KeyPicker.
            // Когда active=true, оба LL-хука пропускают события мимо engine —
            // GUI может записать любую клавишу, даже заблокированную правилом.
            if let Some(p) = params {
                let active = p.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                let s = state.write().map_err(|_| "Failed to lock state")?;
                s.key_capture_active
                    .store(active, std::sync::atomic::Ordering::Relaxed);
                // Сбрасываем предыдущий захваченный код при включении/выключении,
                // чтобы GUI не подхватило «залежавшееся» значение.
                if let Ok(mut captured) = s.last_captured_key.lock() {
                    *captured = None;
                }
                if let Ok(mut captured) = s.last_captured_mouse.lock() {
                    *captured = None;
                }
                Ok(json!({ "success": true, "active": active }))
            } else {
                Err("Missing parameters".into())
            }
        }

        "keycapture.get_captured_key" => {
            let chord = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                if !s
                    .key_capture_active
                    .load(std::sync::atomic::Ordering::Relaxed)
                {
                    return Ok(json!({ "code": 0, "modifiers": 0 }));
                }
                let mut captured = s
                    .last_captured_key
                    .lock()
                    .map_err(|_| "Failed to lock last_captured_key")?;
                captured.take()
            };
            match chord {
                Some(chord) => Ok(json!({ "code": chord.code, "modifiers": chord.modifiers })),
                None => Ok(json!({ "code": 0, "modifiers": 0 })),
            }
        }

        "keycapture.get_captured_mouse" => {
            // Поллинг: GUI вызывает это каждые ~50мс во время listening KeyPicker'а.
            // Возвращает код последней нажатой кнопки (1-5) и сбрасывает в None.
            // 0 = ничего не нажато с последнего опроса.
            let button: u8 = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                if !s
                    .key_capture_active
                    .load(std::sync::atomic::Ordering::Relaxed)
                {
                    return Ok(json!({ "button": 0 }));
                }
                let mut captured = s
                    .last_captured_mouse
                    .lock()
                    .map_err(|_| "Failed to lock last_captured_mouse")?;
                captured.take().unwrap_or(0)
            };
            Ok(json!({ "button": button }))
        }

        "get_active_window" => {
            if let Some(context) = crate::trackers::context_tracker::get_context() {
                if let Ok(context) = context.read() {
                    return Ok(json!({
                        "process": context.active_process,
                        "path": context.active_process_path,
                        "title": context.active_window_title,
                        "className": context.active_window_class,
                        "width": context.window_width,
                        "height": context.window_height,
                        "fullscreen": context.fullscreen,
                        "monitorId": context.monitor_id,
                        "virtualDesktopId": context.virtual_desktop_id,
                    }));
                }
            }
            Ok(json!({
                "process": "", "path": "", "title": "", "className": "",
                "width": 0, "height": 0, "fullscreen": false,
                "monitorId": "", "virtualDesktopId": ""
            }))
        }

        // System / Other. get_status/get_config/update_config/shutdown are owned
        // by ipc.rs and intentionally do not have shadow implementations here.
        "open_log_folder" => {
            let log_dir = crate::shared::persistence::app_data_dir()?.join("logs");
            std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("explorer")
                    .arg(log_dir)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            Ok(json!({ "success": true }))
        }

        _ => Err(format!("Method {} is not supported by the router", method)),
    }
}

#[cfg(test)]
mod v032_profile_identity_tests {
    use super::regenerate_profile_identity;
    use crate::schemas::frontend::{
        FrontendAction, FrontendCondition, FrontendRule, FrontendTrigger, KeyChord, LayerMeta,
        RuleFolder,
    };
    use crate::shared::types::Profile;

    #[test]
    fn duplicate_regenerates_nested_ids_and_references() {
        let mut profile = Profile {
            id: "profile-old".into(),
            name: "Original".into(),
            is_default: true,
            linked_apps: vec![],
            bindings: vec![],
            order: 4,
            layers: vec![LayerMeta {
                id: "layer-old".into(),
                name: "Layer".into(),
            }],
            folders: vec![
                RuleFolder {
                    id: "folder-root".into(),
                    name: "Root".into(),
                    parent_id: None,
                    order: 0,
                },
                RuleFolder {
                    id: "folder-child".into(),
                    name: "Child".into(),
                    parent_id: Some("folder-root".into()),
                    order: 1,
                },
            ],
            rules: vec![FrontendRule {
                id: "rule-old".into(),
                name: Some("Rule".into()),
                trigger: FrontendTrigger::KeyDown {
                    chord: KeyChord::single(65),
                },
                actions: vec![FrontendAction::ToggleLayer {
                    layer_id: "layer-old".into(),
                }],
                hold_actions: Some(vec![FrontendAction::HoldLayer {
                    layer_id: "layer-old".into(),
                }]),
                conditions: vec![FrontendCondition::LayerActive {
                    layer_id: "layer-old".into(),
                }],
                priority: 0,
                enabled: true,
                folder_id: Some("folder-child".into()),
                order: 0,
            }],
        };

        regenerate_profile_identity(&mut profile, "profile-new".into(), "Copy".into());
        assert_eq!(profile.id, "profile-new");
        assert_eq!(profile.name, "Copy");
        assert!(!profile.is_default);
        assert_ne!(profile.layers[0].id, "layer-old");
        assert_ne!(profile.folders[0].id, "folder-root");
        assert_ne!(profile.folders[1].id, "folder-child");
        assert_eq!(
            profile.folders[1].parent_id.as_deref(),
            Some(profile.folders[0].id.as_str())
        );
        assert_ne!(profile.rules[0].id, "rule-old");
        assert_eq!(
            profile.rules[0].folder_id.as_deref(),
            Some(profile.folders[1].id.as_str())
        );

        let layer_id = profile.layers[0].id.as_str();
        assert!(
            matches!(&profile.rules[0].conditions[0], FrontendCondition::LayerActive { layer_id: id } if id == layer_id)
        );
        assert!(
            matches!(&profile.rules[0].actions[0], FrontendAction::ToggleLayer { layer_id: id } if id == layer_id)
        );
        assert!(
            matches!(&profile.rules[0].hold_actions.as_ref().unwrap()[0], FrontendAction::HoldLayer { layer_id: id } if id == layer_id)
        );
    }
}
