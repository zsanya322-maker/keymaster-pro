use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{info, warn};

use crate::daemon::state::DaemonStateRef;

/// Helper function to load, modify, save, and update the active profile in DaemonState
fn modify_profile<F>(profile_id: &str, state: &DaemonStateRef, f: F) -> Result<(), String>
where
    F: FnOnce(&mut crate::shared::types::Profile),
{
    let mut profile = crate::shared::persistence::load_profile(profile_id)?;
    f(&mut profile);
    crate::shared::persistence::save_profile(&profile)?;
    if let Ok(mut s) = state.write() {
        if s.active_profile_id == profile_id {
            s.active_profile = Some(profile);
        }
    }
    Ok(())
}

fn save_recorded_macro(macro_id: &str, steps: Vec<crate::shared::types::MacroStep>, state: &DaemonStateRef) -> Result<(), String> {
    let active_id = {
        let s = state.read().map_err(|_| "Failed to lock state")?;
        s.active_profile_id.clone()
    };
    modify_profile(&active_id, state, |prof| {
        if let Some(m) = prof.macros.iter_mut().find(|mac| mac.id == macro_id) {
            m.steps = steps;
        }
    })?;
    Ok(())
}

/// Central router to dispatch all IPC JSON-RPC commands from Frontend
pub async fn dispatch(method: &str, params: Option<Value>, state: &DaemonStateRef) -> Result<Value, String> {
    info!("IPC Router received command: {}", method);

    match method {
        // Profiles
        "profile.list" => {
            let ids = crate::shared::persistence::list_profiles()?;
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
                s.active_profile = Some(profile);
            }
            // Save active ID in config.json
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
                
                let mut prof = crate::shared::persistence::load_profile(&input.id).unwrap_or_else(|_| {
                    crate::shared::types::Profile {
                        id: input.id.clone(),
                        name: input.name.clone(),
                        is_default: input.is_default,
                        linked_apps: input.linked_apps.clone().unwrap_or_default(),
                        remaps: vec![],
                        mouse_remaps: vec![],
                        layers: vec![],
                        macros: vec![],
                        text_expansions: vec![],
                    }
                });
                
                prof.name = input.name;
                prof.is_default = input.is_default;
                if let Some(apps) = input.linked_apps {
                    prof.linked_apps = apps;
                }

                crate::shared::persistence::save_profile(&prof)?;
                
                {
                    let mut s = state.write().map_err(|_| "Failed to lock state")?;
                    if s.active_profile_id == prof.id {
                        s.active_profile = Some(prof);
                    }
                }
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "profile.update" => {
            if let Some(p) = params {
                let id = p.get("id").and_then(|v| v.as_str()).ok_or("Missing profile id")?.to_string();
                modify_profile(&id, state, |prof| {
                    if let Some(name) = p.get("name").and_then(|v| v.as_str()) {
                        prof.name = name.to_string();
                    }
                    if let Some(is_default) = p.get("isDefault").and_then(|v| v.as_bool()) {
                        prof.is_default = is_default;
                    }
                    if let Some(linked_apps) = p.get("linkedApps").and_then(|v| v.as_array()) {
                        prof.linked_apps = linked_apps.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
                    }
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "profile.delete" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            crate::shared::persistence::delete_profile(id)?;
            Ok(json!({ "success": true }))
        }
        "profile.import" => {
            if let Some(p) = params {
                let prof: crate::shared::types::Profile = serde_json::from_value(p).map_err(|e| e.to_string())?;
                crate::shared::persistence::save_profile(&prof)?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }

        // Keyboard Remapping
        "remap.list" => {
            let profile_id = params.as_ref().and_then(|v| v.get("profileId")).and_then(|i| i.as_str()).unwrap_or("1");
            let prof = crate::shared::persistence::load_profile(profile_id)?;
            Ok(json!({ "rules": prof.remaps }))
        }
        "remap.add" => {
            if let Some(p) = params {
                let rule: crate::shared::types::RemapRule = serde_json::from_value(p).map_err(|e| e.to_string())?;
                let profile_id = rule.profile_id.clone();
                modify_profile(&profile_id, state, |prof| {
                    prof.remaps.retain(|r| r.id != rule.id);
                    prof.remaps.push(rule);
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "remap.remove" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            let active_id = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            modify_profile(&active_id, state, |prof| {
                prof.remaps.retain(|r| r.id != id);
            })?;
            Ok(json!({ "success": true }))
        }

        // Mouse Remapping
        "remap.mouse.list" => {
            let profile_id = params.as_ref().and_then(|v| v.get("profileId")).and_then(|i| i.as_str()).unwrap_or("1");
            let prof = crate::shared::persistence::load_profile(profile_id)?;
            Ok(json!({ "rules": prof.mouse_remaps }))
        }
        "remap.mouse.add" => {
            if let Some(p) = params {
                let rule: crate::shared::types::MouseRemapRule = serde_json::from_value(p).map_err(|e| e.to_string())?;
                let profile_id = rule.profile_id.clone();
                modify_profile(&profile_id, state, |prof| {
                    prof.mouse_remaps.retain(|r| r.id != rule.id);
                    prof.mouse_remaps.push(rule);
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "remap.mouse.remove" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            let active_id = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            modify_profile(&active_id, state, |prof| {
                prof.mouse_remaps.retain(|r| r.id != id);
            })?;
            Ok(json!({ "success": true }))
        }

        // Layers
        "layer.list" => {
            let profile_id = params.as_ref().and_then(|v| v.get("profileId")).and_then(|i| i.as_str()).unwrap_or("1");
            let prof = crate::shared::persistence::load_profile(profile_id)?;
            Ok(json!({ "layers": prof.layers }))
        }
        "layer.create" => {
            if let Some(p) = params {
                let layer: crate::shared::types::Layer = serde_json::from_value(p).map_err(|e| e.to_string())?;
                let profile_id = layer.profile_id.clone();
                modify_profile(&profile_id, state, |prof| {
                    prof.layers.retain(|l| l.id != layer.id);
                    prof.layers.push(layer);
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "layer.delete" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            let active_id = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            modify_profile(&active_id, state, |prof| {
                prof.layers.retain(|l| l.id != id);
            })?;
            Ok(json!({ "success": true }))
        }
        "layer.update" => {
            if let Some(p) = params {
                let id = p.get("id").and_then(|v| v.as_str()).ok_or("Missing layer id")?.to_string();
                let active_id = {
                    let s = state.read().map_err(|_| "Failed to lock state")?;
                    s.active_profile_id.clone()
                };
                modify_profile(&active_id, state, |prof| {
                    if let Some(layer) = prof.layers.iter_mut().find(|l| l.id == id) {
                        if let Some(updates) = p.get("updates") {
                            if let Some(name) = updates.get("name").and_then(|v| v.as_str()) {
                                layer.name = name.to_string();
                            }
                            if let Some(priority) = updates.get("priority").and_then(|v| v.as_i64()) {
                                layer.priority = priority as i32;
                            }
                            if let Some(trigger_type) = updates.get("triggerType").and_then(|v| v.as_str()) {
                                layer.trigger_type = trigger_type.to_string();
                            }
                            if let Some(trigger_value) = updates.get("triggerValue").and_then(|v| v.as_str()) {
                                layer.trigger_value = trigger_value.to_string();
                            }
                        }
                    }
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }

        // Macros
        "macro.list" => {
            let profile_id = params.as_ref().and_then(|v| v.get("profileId")).and_then(|i| i.as_str()).unwrap_or("1");
            let prof = crate::shared::persistence::load_profile(profile_id)?;
            Ok(json!({ "macros": prof.macros }))
        }
        "macro.create" => {
            if let Some(p) = params {
                let m: crate::shared::types::Macro = serde_json::from_value(p).map_err(|e| e.to_string())?;
                let profile_id = m.profile_id.clone();
                modify_profile(&profile_id, state, |prof| {
                    prof.macros.retain(|mac| mac.id != m.id);
                    prof.macros.push(m);
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "macro.delete" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            let active_id = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            modify_profile(&active_id, state, |prof| {
                prof.macros.retain(|m| m.id != id);
            })?;
            Ok(json!({ "success": true }))
        }
        "macro.update" => {
            if let Some(p) = params {
                let id = p.get("id").and_then(|v| v.as_str()).ok_or("Missing macro id")?.to_string();
                let active_id = {
                    let s = state.read().map_err(|_| "Failed to lock state")?;
                    s.active_profile_id.clone()
                };
                modify_profile(&active_id, state, |prof| {
                    if let Some(m) = prof.macros.iter_mut().find(|mac| mac.id == id) {
                        if let Some(updates) = p.get("updates") {
                            if let Some(name) = updates.get("name").and_then(|v| v.as_str()) {
                                m.name = name.to_string();
                            }
                            if let Some(trigger_key) = updates.get("triggerKey").and_then(|v| v.as_str()) {
                                m.trigger_key = trigger_key.to_string();
                            }
                            if let Some(steps_val) = updates.get("steps") {
                                if let Ok(steps) = serde_json::from_value(steps_val.clone()) {
                                    m.steps = steps;
                                }
                            }
                            if let Some(trigger_type_val) = updates.get("triggerType") {
                                m.trigger_type = trigger_type_val.as_str().map(|s| s.to_string());
                            }
                            if let Some(trigger_time_val) = updates.get("triggerTime") {
                                m.trigger_time = trigger_time_val.as_u64().map(|v| v as u32);
                            }
                            if let Some(trigger_layout_val) = updates.get("triggerLayout") {
                                m.trigger_layout = trigger_layout_val.as_str().map(|s| s.to_string());
                            }
                        }
                    }
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "macro.play" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            crate::daemon::macros::play_macro(id, state).await?;
            Ok(json!({ "success": true }))
        }
        "macro.select_for_recording" => {
            let macro_id = params.as_ref().and_then(|v| v.get("macroId")).and_then(|i| i.as_str()).map(|s| s.to_string());
            let mut s = state.write().map_err(|_| "Failed to lock state")?;
            s.selected_macro_id = macro_id;
            Ok(json!({ "success": true }))
        }
        "macro.start_recording" => {
            let macro_id = params.as_ref().and_then(|v| v.get("macroId")).and_then(|i| i.as_str()).ok_or("Missing macroId")?.to_string();
            let mut s = state.write().map_err(|_| "Failed to lock state")?;
            s.recording_macro_id = Some(macro_id);
            s.record_start_time = Some(std::time::Instant::now());
            s.record_last_event_time = Some(std::time::Instant::now());
            s.recorded_steps = Vec::new();
            Ok(json!({ "success": true }))
        }
        "macro.stop_recording" => {
            let (macro_id, steps) = {
                let mut s = state.write().map_err(|_| "Failed to lock state")?;
                let m_id = s.recording_macro_id.take().ok_or("Not recording")?;
                s.record_start_time = None;
                s.record_last_event_time = None;
                let steps = std::mem::take(&mut s.recorded_steps);
                (m_id, steps)
            };
            save_recorded_macro(&macro_id, steps, state)?;
            Ok(json!({ "success": true }))
        }
        "macro.get_recording_status" => {
            let s = state.read().map_err(|_| "Failed to lock state")?;
            Ok(json!({
                "isRecording": s.recording_macro_id.is_some(),
                "recordingMacroId": s.recording_macro_id,
                "stepCount": s.recorded_steps.len(),
                "selectedMacroId": s.selected_macro_id,
                "steps": s.recorded_steps
            }))
        }
        "macro.capture_active_window" => {
            let delay_sec = params.as_ref()
                .and_then(|v| v.get("delay"))
                .and_then(|v| v.as_u64())
                .unwrap_or(3);
            
            tokio::time::sleep(std::time::Duration::from_secs(delay_sec)).await;
            
            let (process, title) = crate::daemon::engine::get_active_window_info();
            Ok(json!({
                "process": process,
                "title": title
            }))
        }

        // Text Expansions
        "text_expansion.list" => {
            let profile_id = params.as_ref().and_then(|v| v.get("profileId")).and_then(|i| i.as_str()).unwrap_or("1");
            let prof = crate::shared::persistence::load_profile(profile_id)?;
            Ok(json!({ "expansions": prof.text_expansions }))
        }
        "text_expansion.create" => {
            if let Some(p) = params {
                let te: crate::shared::types::TextExpansion = serde_json::from_value(p).map_err(|e| e.to_string())?;
                let profile_id = te.profile_id.clone();
                modify_profile(&profile_id, state, |prof| {
                    prof.text_expansions.retain(|t| t.id != te.id);
                    prof.text_expansions.push(te);
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
        }
        "text_expansion.delete" => {
            let id = params.as_ref().and_then(|v| v.get("id")).and_then(|i| i.as_str()).unwrap_or("");
            let active_id = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                s.active_profile_id.clone()
            };
            modify_profile(&active_id, state, |prof| {
                prof.text_expansions.retain(|t| t.id != id);
            })?;
            Ok(json!({ "success": true }))
        }
        "text_expansion.update" => {
            if let Some(p) = params {
                let te: crate::shared::types::TextExpansion = serde_json::from_value(p).map_err(|e| e.to_string())?;
                let profile_id = te.profile_id.clone();
                modify_profile(&profile_id, state, |prof| {
                    if let Some(t) = prof.text_expansions.iter_mut().find(|x| x.id == te.id) {
                        *t = te;
                    } else {
                        prof.text_expansions.push(te);
                    }
                })?;
                Ok(json!({ "success": true }))
            } else {
                Err("Missing parameters".into())
            }
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
        "shutdown" => {
            warn!("Shutdown command received by Daemon!");
            std::process::exit(0);
        }

        _ => Err(format!("Method {} is not supported by the router", method)),
    }
}