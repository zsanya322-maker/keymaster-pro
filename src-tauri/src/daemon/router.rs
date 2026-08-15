use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{info, warn};

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
        s.active_profile = Some(profile);
    }
    Ok(())
}

/// Helper function to load, modify, save, and update the active profile in DaemonState
fn modify_profile<F>(profile_id: &str, state: &DaemonStateRef, f: F) -> Result<(), String>
where
    F: FnOnce(&mut crate::shared::types::Profile),
{
    let mut profile = crate::shared::persistence::load_profile(profile_id)?;
    f(&mut profile);
    crate::shared::persistence::save_profile(&profile)?;
    update_active_profile_runtime(profile, state)
}

/// Central router to dispatch all IPC JSON-RPC commands from Frontend
pub async fn dispatch(method: &str, params: Option<Value>, state: &DaemonStateRef) -> Result<Value, String> {
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
                    rules: vec![],
                    layers: vec![],
                };
                let _ = crate::shared::persistence::save_profile(&default_prof);
                ids.push("1".to_string());
            }
            let mut list = Vec::new();
            for id in ids {
                if let Ok(prof) = crate::shared::persistence::load_profile(&id) {
                    list.push(prof);
                }
            }
            let active = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            Ok(json!({ "profiles": list, "active": active }))
        }
        "profile.activate" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            let profile = crate::shared::persistence::load_profile(id)?;
            {
                let mut s = state.write().map_err(|_| "Failed to lock state")?;
                s.active_profile_id = id.to_string();
                let frontend_config = crate::schemas::frontend::FrontendConfig {
                    rules: profile.rules.clone(),
                    layers: profile.layers.clone(),
                    tap_hold_timeout_ms: current_tap_hold_timeout(),
                };
                s.engine_schema = crate::daemon::compiler::compile_schema(&frontend_config);
                s.active_profile = Some(profile);
            }
            if let Ok(mut config) = crate::shared::config::load_config() {
                config.active_profile_id = id.to_string();
                let _ = crate::shared::config::save_config(&config);
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

                let prof = crate::shared::types::Profile {
                    id: input.id,
                    name: input.name,
                    is_default: input.is_default,
                    linked_apps: input.linked_apps.unwrap_or_default(),
                    rules: vec![],
                    layers: vec![],
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
                let prof: crate::shared::types::Profile = serde_json::from_value(p).map_err(|e| e.to_string())?;
                if !profile_exists(&prof.id)? {
                    return Err(format!(
                        "Профиль '{}' не существует; используйте profile.create или profile.import",
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
                let mut prof: crate::shared::types::Profile = serde_json::from_value(p).map_err(|e| e.to_string())?;
                if profile_exists(&prof.id)? {
                    return Err(format!(
                        "Профиль с ID '{}' уже существует; импорт не может перезаписывать существующий профиль",
                        prof.id
                    ));
                }

                // Импортированный профиль не должен создавать второго protected
                // default-профиля в уже существующей конфигурации.
                if prof.is_default {
                    let has_default = crate::shared::persistence::list_profiles()?
                        .into_iter()
                        .filter_map(|id| crate::shared::persistence::load_profile(&id).ok())
                        .any(|profile| profile.is_default);
                    if has_default {
                        prof.is_default = false;
                    }
                }

                crate::shared::persistence::save_profile(&prof)?;
                update_active_profile_runtime(prof, state)?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "profile.delete" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            let profile = crate::shared::persistence::load_profile(id)?;
            if profile.is_default {
                return Err("Профиль по умолчанию нельзя удалить".to_string());
            }
            let active_id = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            if active_id == id {
                return Err("Активный профиль нельзя удалить; сначала переключитесь на другой".to_string());
            }
            crate::shared::persistence::delete_profile(id)?;
            Ok(json!({ "success": true }))
        }
        "apply_onboarding_example" => {
            if let Some(p) = params {
                let example_type = p.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let active_id = {
                    let s = state.read().map_err(|_| "Failed to lock state")?;
                    s.active_profile_id.clone()
                };

                modify_profile(&active_id, state, |prof| {
                    use crate::schemas::frontend::{FrontendAction, FrontendRule, FrontendTrigger, MacroAction, MacroStep};
                    let new_rule = match example_type {
                        "remap" => FrontendRule {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: Some("Caps Lock -> Backspace".to_string()),
                            trigger: FrontendTrigger::KeyDown { code: 20 }, // VK_CAPITAL (Caps Lock)
                            actions: vec![FrontendAction::RemapKey { code: 8 }], // VK_BACK (Backspace)
                            hold_actions: None,
                            conditions: vec![],
                            priority: 10,
                        },
                        "expansion" => FrontendRule {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: Some("Email Expansion".to_string()),
                            trigger: FrontendTrigger::TypedText { sequence: "@@".to_string() },
                            actions: vec![FrontendAction::TypeText { text: "user@example.com".to_string() }],
                            hold_actions: None,
                            conditions: vec![],
                            priority: 10,
                        },
                        "macro" => FrontendRule {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: Some("Demo Macro".to_string()),
                            trigger: FrontendTrigger::KeyDown { code: 123 }, // F12
                            actions: vec![FrontendAction::RunMacro { steps: vec![
                                MacroStep { action: MacroAction::KeyDown { code: 72 }, delay_ms: 50 }, // H
                                MacroStep { action: MacroAction::KeyUp { code: 72 }, delay_ms: 50 },
                                MacroStep { action: MacroAction::KeyDown { code: 69 }, delay_ms: 50 }, // E
                                MacroStep { action: MacroAction::KeyUp { code: 69 }, delay_ms: 50 },
                            ]}],
                            hold_actions: None,
                            conditions: vec![],
                            priority: 10,
                        },
                        _ => return,
                    };
                    prof.rules.push(new_rule);
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }

        // Macro recording
        "macro.start_recording" => {
            let record_mouse_moves = params.as_ref()
                .and_then(|p| p.get("recordMouseMoves"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let record_mouse_drag_drop_only = params.as_ref()
                .and_then(|p| p.get("recordMouseDragDropOnly"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let existing_steps_opt = params.as_ref()
                .and_then(|p| p.get("existingSteps"))
                .and_then(|v| serde_json::from_value::<Vec<crate::schemas::frontend::MacroStep>>(v.clone()).ok());

            let s = state.read().map_err(|_| "Failed to lock state")?;
            s.is_recording.store(true, std::sync::atomic::Ordering::Relaxed);
            s.record_mouse_moves.store(record_mouse_moves, std::sync::atomic::Ordering::Relaxed);
            s.record_mouse_drag_drop_only.store(record_mouse_drag_drop_only, std::sync::atomic::Ordering::Relaxed);

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
                s.is_recording.store(false, std::sync::atomic::Ordering::Relaxed);
                let steps_guard = s.recorded_steps.lock().map_err(|_| "Failed to lock recorded steps")?;
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
                let record_mouse_moves = p.get("recordMouseMoves").and_then(|v| v.as_bool()).unwrap_or(false);
                let record_mouse_drag_drop_only = p.get("recordMouseDragDropOnly").and_then(|v| v.as_bool()).unwrap_or(true);
                let existing_steps_opt = p.get("existingSteps")
                    .and_then(|v| serde_json::from_value::<Vec<crate::schemas::frontend::MacroStep>>(v.clone()).ok());

                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.record_ready.store(ready, std::sync::atomic::Ordering::Relaxed);
                s.record_mouse_moves.store(record_mouse_moves, std::sync::atomic::Ordering::Relaxed);
                s.record_mouse_drag_drop_only.store(record_mouse_drag_drop_only, std::sync::atomic::Ordering::Relaxed);

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
                s.key_capture_active.store(active, std::sync::atomic::Ordering::Relaxed);
                // Сбрасываем предыдущий захваченный код при включении/выключении,
                // чтобы GUI не подхватило «залежавшееся» значение.
                if let Ok(mut captured) = s.last_captured_mouse.lock() {
                    *captured = None;
                }
                Ok(json!({ "success": true, "active": active }))
            } else {
                Err("Missing parameters".into())
            }
        }

        "keycapture.get_captured_mouse" => {
            // Поллинг: GUI вызывает это каждые ~50мс во время listening KeyPicker'а.
            // Возвращает код последней нажатой кнопки (1-5) и сбрасывает в None.
            // 0 = ничего не нажато с последнего опроса.
            let button: u8 = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                if !s.key_capture_active.load(std::sync::atomic::Ordering::Relaxed) {
                    return Ok(json!({ "button": 0 }));
                }
                let mut captured = s.last_captured_mouse.lock()
                    .map_err(|_| "Failed to lock last_captured_mouse")?;
                captured.take().unwrap_or(0)
            };
            Ok(json!({ "button": button }))
        }

        "get_active_window" => {
            if let Some(ctx_state) = crate::trackers::context_tracker::get_context() {
                if let Ok(ctx) = ctx_state.read() {
                    return Ok(json!({
                        "process": ctx.active_process,
                        "title": ctx.active_window_title,
                    }));
                }
            }
            Ok(json!({
                "process": "",
                "title": "",
            }))
        }

        // System / Other
        "get_status" => {
            let active_id = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            Ok(json!({
                "status": "running",
                "active_profile_id": active_id
            }))
        }
        "get_config" => {
            let config = crate::shared::config::load_config()?;
            Ok(serde_json::to_value(config).unwrap())
        }
        "update_config" => {
            if let Some(p) = params {
                let mut config = crate::shared::config::load_config()?;
                if let Some(onboarding_complete) = p.get("onboardingComplete").and_then(|v| v.as_bool()) {
                    config.onboarding_complete = onboarding_complete;
                }
                if let Some(timeout) = p.get("tapHoldTimeoutMs").and_then(|v| v.as_u64()) {
                    config.tap_hold_timeout_ms = timeout;
                }
                if let Some(active_id) = p.get("activeProfileId").and_then(|v| v.as_str()) {
                    config.active_profile_id = active_id.to_string();
                }
                crate::shared::config::save_config(&config)?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
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
        "shutdown" => {
            warn!("Shutdown command received by Daemon!");
            std::process::exit(0);
        }

        _ => Err(format!("Method {} is not supported by the router", method)),
    }
}
