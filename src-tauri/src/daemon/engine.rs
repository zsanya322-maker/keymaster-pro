use std::collections::HashMap;
use std::sync::{Mutex, LazyLock};
use std::time::Instant;
use crate::daemon::state::DaemonStateRef;
use crate::schemas::engine::{EngineCondition, EngineAction, SimulatorCommand};
use crate::shared::calculate_hash;

/// Тип результата обработки события
#[derive(Debug)]
pub enum EventAction {
    PassThrough,
    Block,
}

pub struct PendingTapHold {
    pub vk_code: u8,
    pub tap_actions: Vec<EngineAction>,
    pub hold_actions: Vec<EngineAction>,
    pub down_time: Instant,
    pub timeout_ms: u32,
    pub is_held: bool,
}

pub static PENDING_TAP_HOLDS: LazyLock<Mutex<HashMap<u8, PendingTapHold>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn check_conditions(conditions: &[EngineCondition], ctx: &crate::context::AppContext) -> bool {
    for cond in conditions {
        match cond {
            EngineCondition::WindowFocused { process_hash } => {
                let current_hash = calculate_hash(&ctx.active_process);
                if *process_hash != current_hash {
                    return false;
                }
            }
            EngineCondition::LayerActive { layer_id_hash } => {
                if !ctx.active_layers.contains(layer_id_hash) {
                    return false;
                }
            }
            EngineCondition::VirtualDesktop { .. } => {
                // Not implemented yet
            }
        }
    }
    true
}

fn notify_layer_change(state: Option<&DaemonStateRef>, layer_id_hash: u64, active: bool) {
    if let Some(state_ref) = state {
        if let Ok(s) = state_ref.read() {
            if let Some(ref prof) = s.active_profile {
                for layer in &prof.layers {
                    if crate::shared::calculate_hash(&layer.id) == layer_id_hash {
                        let event = if active {
                            crate::gui::events::DaemonEvent::LayerActivated {
                                layer_id: layer.id.clone(),
                                layer_name: layer.name.clone(),
                            }
                        } else {
                            crate::gui::events::DaemonEvent::LayerDeactivated {
                                layer_id: layer.id.clone(),
                            }
                        };
                        crate::gui::events::broadcast_event(event);
                        break;
                    }
                }
            }
        }
    }
}

fn execute_actions(
    actions: &[EngineAction], 
    simulator: &crate::simulator::SimulatorSender, 
    ctx_arc: &std::sync::Arc<std::sync::RwLock<crate::context::AppContext>>, 
    is_down: bool,
    state: Option<&DaemonStateRef>,
) -> EventAction {
    for action in actions {
        match action {
            EngineAction::RemapKey { code } => {
                if is_down { let _ = simulator.send(SimulatorCommand::PressKey(*code)); }
                else { let _ = simulator.send(SimulatorCommand::ReleaseKey(*code)); }
            }
            EngineAction::RemapMouse { code } => {
                if is_down { let _ = simulator.send(SimulatorCommand::MousePress(*code)); }
                else { let _ = simulator.send(SimulatorCommand::MouseRelease(*code)); }
            }
            EngineAction::TypeText { text } => {
                if is_down { let _ = simulator.send(SimulatorCommand::TypeString(text.clone())); }
            }
            EngineAction::MacroCommands { commands } => {
                if is_down {
                    for cmd in commands { let _ = simulator.send(cmd.clone()); }
                }
            }
            EngineAction::ToggleLayer { layer_id_hash } => {
                if is_down {
                    let mut became_active = false;
                    let mut state_changed = false;
                    if let Ok(mut wctx) = ctx_arc.write() {
                        state_changed = true;
                        if wctx.active_layers.contains(layer_id_hash) {
                            wctx.active_layers.remove(layer_id_hash);
                            became_active = false;
                        } else {
                            wctx.active_layers.insert(*layer_id_hash);
                            became_active = true;
                        }
                    }
                    if state_changed {
                        notify_layer_change(state, *layer_id_hash, became_active);
                    }
                }
            }
            EngineAction::HoldLayerPush { layer_id_hash } => {
                let mut state_changed = false;
                if is_down {
                    if let Ok(mut wctx) = ctx_arc.write() {
                        if !wctx.active_layers.contains(layer_id_hash) {
                            wctx.active_layers.insert(*layer_id_hash);
                            state_changed = true;
                        }
                    }
                    if state_changed {
                        notify_layer_change(state, *layer_id_hash, true);
                    }
                } else {
                    if let Ok(mut wctx) = ctx_arc.write() {
                        if wctx.active_layers.contains(layer_id_hash) {
                            wctx.active_layers.remove(layer_id_hash);
                            state_changed = true;
                        }
                    }
                    if state_changed {
                        notify_layer_change(state, *layer_id_hash, false);
                    }
                }
            }
            EngineAction::HoldLayerPop { layer_id_hash } => {
                if !is_down {
                    let mut state_changed = false;
                    if let Ok(mut wctx) = ctx_arc.write() {
                        if wctx.active_layers.contains(layer_id_hash) {
                            wctx.active_layers.remove(layer_id_hash);
                            state_changed = true;
                        }
                    }
                    if state_changed {
                        notify_layer_change(state, *layer_id_hash, false);
                    }
                }
            }
            EngineAction::SystemVolume { action } => {
                if is_down {
                    let vk = match action.as_str() {
                        "mute" => 0xAD, // VK_VOLUME_MUTE
                        "down" => 0xAE, // VK_VOLUME_DOWN
                        "up" => 0xAF,   // VK_VOLUME_UP
                        _ => 0,
                    };
                    if vk != 0 {
                        let _ = simulator.send(SimulatorCommand::PressKey(vk));
                        let _ = simulator.send(SimulatorCommand::ReleaseKey(vk));
                    }
                }
            }
            EngineAction::MediaKey { key } => {
                if is_down {
                    let vk = match key.as_str() {
                        "play_pause" => 0xB3, // VK_MEDIA_PLAY_PAUSE
                        "next" => 0xB0,       // VK_MEDIA_NEXT_TRACK
                        "prev" => 0xB1,       // VK_MEDIA_PREV_TRACK
                        "stop" => 0xB2,       // VK_MEDIA_STOP
                        _ => 0,
                    };
                    if vk != 0 {
                        let _ = simulator.send(SimulatorCommand::PressKey(vk));
                        let _ = simulator.send(SimulatorCommand::ReleaseKey(vk));
                    }
                }
            }
            EngineAction::WindowAction { action } => {
                if is_down {
                    crate::simulator::system::execute_window_action(action);
                }
            }
            EngineAction::LaunchApp { path } => {
                if is_down {
                    crate::simulator::system::launch_app(path);
                }
            }
            EngineAction::Sleep => {
                if is_down {
                    crate::simulator::system::sleep_pc();
                }
            }
            EngineAction::MonitorOff => {
                if is_down {
                    crate::simulator::system::monitor_off();
                }
            }
        }
    }
    EventAction::Block
}


pub fn tick_tap_holds(state: Option<&DaemonStateRef>) {
    let now = Instant::now();
    let mut to_trigger_hold = Vec::new();
    
    if let Ok(mut pending) = PENDING_TAP_HOLDS.lock() {
        for (_vk, info) in pending.iter_mut() {
            if !info.is_held && now.duration_since(info.down_time).as_millis() as u32 >= info.timeout_ms {
                info.is_held = true;
                to_trigger_hold.push(info.hold_actions.clone());
            }
        }
    }

    if let Some(state_ref) = state {
        if let Ok(s) = state_ref.read() {
            if let Some(simulator) = &s.simulator {
                if let Some(ctx_state) = crate::trackers::context_tracker::get_context() {
                    for actions in to_trigger_hold {
                        execute_actions(&actions, simulator, &ctx_state, true, Some(state_ref));
                    }
                }
            }
        }
    }
}

pub fn process_keyboard_event(
    vk_code: u8,
    _scan_code: u16,
    is_key_down: bool,
    _flags: u32,
    state: Option<&DaemonStateRef>,
) -> EventAction {
    let state_ref = match state {
        Some(s) => s,
        None => return EventAction::PassThrough,
    };

    let s = match state_ref.read() {
        Ok(s) => s,
        Err(_) => return EventAction::PassThrough,
    };

    if !s.kb_hook_enabled {
        return EventAction::PassThrough;
    }

    let simulator = match &s.simulator {
        Some(sim) => sim,
        None => return EventAction::PassThrough,
    };

    let engine_schema = &s.engine_schema;

    let ctx_arc = match crate::trackers::context_tracker::get_context() {
        Some(c) => c,
        None => return EventAction::PassThrough,
    };

    // Text expansion matching
    if is_key_down {
        let is_modifier = matches!(vk_code, 0x11 | 0x12 | 0x5B | 0x5C | 0xA2 | 0xA3 | 0xA4 | 0xA5);
        if is_modifier {
            if let Ok(mut buf) = s.typed_buffer.lock() {
                buf.clear();
            }
        } else if vk_code == 0x08 { // Backspace
            if let Ok(mut buf) = s.typed_buffer.lock() {
                buf.pop();
            }
        } else {
            let shift = is_shift_pressed();
            if let Some(c) = vk_to_char(vk_code, shift) {
                let mut matched_rule = None;
                let mut matched_sequence = String::new();
                
                if let Ok(mut buf) = s.typed_buffer.lock() {
                    buf.push(c);
                    // Keep buffer under reasonable size
                    let buf_len = buf.len();
                    if buf_len > 30 {
                        buf.drain(0..buf_len - 30);
                    }
                    
                    // Search for match in text_expansion_map
                    let ctx = ctx_arc.read().unwrap();
                    for (seq, rules) in &engine_schema.text_expansion_map {
                        if buf.ends_with(seq) {
                            for rule in rules {
                                if check_conditions(&rule.conditions, &ctx) {
                                    matched_rule = Some(rule.clone());
                                    matched_sequence = seq.clone();
                                    break;
                                }
                            }
                        }
                        if matched_rule.is_some() {
                            break;
                        }
                    }
                    
                    // If matched, clear buffer
                    if matched_rule.is_some() {
                        buf.clear();
                    }
                }
                
                if let Some(rule) = matched_rule {
                    // Send backspaces to delete typed letters (excluding the blocked one)
                    let backspaces = matched_sequence.chars().count() - 1;
                    for _ in 0..backspaces {
                        let _ = simulator.send(SimulatorCommand::PressKey(0x08));
                        let _ = simulator.send(SimulatorCommand::ReleaseKey(0x08));
                    }
                    
                    // Execute expansion actions
                    execute_actions(&rule.actions, simulator, &ctx_arc, true, state);
                    execute_actions(&rule.actions, simulator, &ctx_arc, false, state);
                    
                    return EventAction::Block;
                }
            } else {
                // Non-printable character typed (e.g. Enter, Escape, Arrow key) -> clear buffer
                if let Ok(mut buf) = s.typed_buffer.lock() {
                    buf.clear();
                }
            }
        }
    }

    // Check Tap-Hold resolution FIRST
    if is_key_down {
        let mut early_trigger = Vec::new();
        if let Ok(mut pending) = PENDING_TAP_HOLDS.lock() {
            if !pending.contains_key(&vk_code) {
                // Another key pressed while holds are pending! Resolve all holds immediately.
                for (_, info) in pending.iter_mut() {
                    if !info.is_held {
                        info.is_held = true;
                        early_trigger.push(info.hold_actions.clone());
                    }
                }
            }
        }
        for actions in early_trigger {
            execute_actions(&actions, simulator, &ctx_arc, true, state);
        }

        // Now check if this new key down matches a TapHold rule
        let tap_rules_opt = engine_schema.tap_hold_map.get(&vk_code);
        if let Some(rules) = tap_rules_opt {
            let ctx = ctx_arc.read().unwrap();
            for rule in rules {
                if check_conditions(&rule.conditions, &ctx) {
                    if let Ok(mut pending) = PENDING_TAP_HOLDS.lock() {
                        pending.insert(vk_code, PendingTapHold {
                            vk_code,
                            tap_actions: rule.tap_actions.clone(),
                            hold_actions: rule.hold_actions.clone(),
                            down_time: Instant::now(),
                            timeout_ms: rule.timeout_ms,
                            is_held: false,
                        });
                    }
                    return EventAction::Block;
                }
            }
        }

    } else {
        // KeyUp
        let mut tap_actions = None;
        let mut hold_actions = None;
        
        if let Ok(mut pending) = PENDING_TAP_HOLDS.lock() {
            if let Some(info) = pending.remove(&vk_code) {
                if info.is_held {
                    hold_actions = Some(info.hold_actions);
                } else {
                    tap_actions = Some(info.tap_actions);
                }
            }
        }
        
        if let Some(actions) = tap_actions {
            // TAP! Execute press and release immediately
            execute_actions(&actions, simulator, &ctx_arc, true, state);
            execute_actions(&actions, simulator, &ctx_arc, false, state);
            return EventAction::Block;
        } else if let Some(actions) = hold_actions {
            // Release the hold actions
            execute_actions(&actions, simulator, &ctx_arc, false, state);
            return EventAction::Block;
        }
    }

    let rules_opt = engine_schema.keyboard_map.get(&vk_code);
    if let Some(rules) = rules_opt {
        let ctx = ctx_arc.read().unwrap();
        for rule in rules {
            if check_conditions(&rule.conditions, &ctx) {
                drop(ctx);
                return execute_actions(&rule.actions, simulator, &ctx_arc, is_key_down, state);
            }
        }
    }

    EventAction::PassThrough
}

pub fn process_mouse_event(
    button: u8,
    _x: i32,
    _y: i32,
    _delta: i32,
    _flags: u32,
    is_down: bool,
    state: Option<&DaemonStateRef>,
) -> EventAction {
    let state_ref = match state {
        Some(s) => s,
        None => return EventAction::PassThrough,
    };

    let s = match state_ref.read() {
        Ok(s) => s,
        Err(_) => return EventAction::PassThrough,
    };

    if !s.mouse_hook_enabled {
        return EventAction::PassThrough;
    }

    if is_down {
        if let Ok(mut buf) = s.typed_buffer.lock() {
            buf.clear();
        }
    }

    let simulator = match &s.simulator {
        Some(sim) => sim,
        None => return EventAction::PassThrough,
    };

    let engine_schema = &s.engine_schema;

    let ctx_arc = match crate::trackers::context_tracker::get_context() {
        Some(c) => c,
        None => return EventAction::PassThrough,
    };

    let rules_opt = engine_schema.mouse_map.get(&button);
    if let Some(rules) = rules_opt {
        let ctx = ctx_arc.read().unwrap();
        for rule in rules {
            if check_conditions(&rule.conditions, &ctx) {
                drop(ctx);
                return execute_actions(&rule.actions, simulator, &ctx_arc, is_down, state);
            }
        }
    }

    EventAction::PassThrough
}

pub fn vk_to_key_name(vk: u8) -> String {
    match vk {
        0x14 => "CapsLock".to_string(),
        0x1B => "Escape".to_string(),
        0x20 => "Space".to_string(),
        0x0D => "Enter".to_string(),
        0x08 => "Backspace".to_string(),
        0x09 => "Tab".to_string(),
        0x2E => "Delete".to_string(),
        0x2D => "Insert".to_string(),
        0x21 => "PageUp".to_string(),
        0x22 => "PageDown".to_string(),
        0x23 => "End".to_string(),
        0x24 => "Home".to_string(),
        0x25 => "Left".to_string(),
        0x26 => "Up".to_string(),
        0x27 => "Right".to_string(),
        0x28 => "Down".to_string(),
        0xAD => "VolumeMute".to_string(),
        0xAE => "VolumeDown".to_string(),
        0xAF => "VolumeUp".to_string(),
        0x12 | 0xA4 | 0xA5 => "Alt".to_string(),
        0x11 | 0xA2 | 0xA3 => "Ctrl".to_string(),
        0x10 | 0xA0 | 0xA1 => "Shift".to_string(),
        0x5B | 0x5C => "Win".to_string(),
        0x70 => "F1".to_string(),
        0x71 => "F2".to_string(),
        0x72 => "F3".to_string(),
        0x73 => "F4".to_string(),
        0x74 => "F5".to_string(),
        0x75 => "F6".to_string(),
        0x76 => "F7".to_string(),
        0x77 => "F8".to_string(),
        0x78 => "F9".to_string(),
        0x79 => "F10".to_string(),
        0x7A => "F11".to_string(),
        0x7B => "F12".to_string(),
        val @ 0x41..=0x5A => ((val - 0x41 + b'A') as char).to_string(),
        val @ 0x30..=0x39 => ((val - 0x30 + b'0') as char).to_string(),
        other => format!("VK_{}", other),
    }
}

#[cfg(target_os = "windows")]
fn is_shift_pressed() -> bool {
    unsafe {
        let state = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(0x10); // VK_SHIFT = 0x10
        (state & 0x8000u16 as i16) != 0
    }
}

#[cfg(not(target_os = "windows"))]
fn is_shift_pressed() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn vk_to_char(vk: u8, _shift: bool) -> Option<char> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyboardState, ToUnicodeEx, GetKeyboardLayout, MapVirtualKeyW, MAPVK_VK_TO_VSC_EX};
    
    unsafe {
        let mut key_state = [0u8; 256];
        if GetKeyboardState(&mut key_state).is_err() {
            return None;
        }
        
        let dwhkl = GetKeyboardLayout(0);
        let scan_code = MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC_EX);
        
        let mut buf = [0u16; 4];
        let result = ToUnicodeEx(vk as u32, scan_code, &key_state, &mut buf, 0, dwhkl);
        
        if result > 0 {
            if let Some(c) = char::from_u32(buf[0] as u32) {
                if !c.is_control() {
                    return Some(c);
                }
            }
        }
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn vk_to_char(_vk: u8, _shift: bool) -> Option<char> {
    None
}