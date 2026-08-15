use std::collections::HashMap;
use std::sync::{atomic::{AtomicU16, Ordering}, LazyLock, Mutex, RwLockReadGuard};
use std::time::Instant;

use tracing::error;

use crate::context::AppContext;
use crate::daemon::state::DaemonStateRef;
use crate::schemas::engine::{EngineAction, EngineCondition, SimulatorCommand};
use crate::schemas::frontend::key_modifiers;
use crate::shared::calculate_hash;

/// Тип результата обработки события
#[derive(Debug)]
pub enum EventAction {
    PassThrough,
    Block,
}

/// Безопасно читает контекст приложения.
///
/// Возвращает `None`, если RwLock отравлен (poisoned) из-за паники в другом потоке,
/// либо если контекст ещё не инициализирован. В callback'ах LL-хуков паника = abort
/// процесса, поэтому НИКОГДА не используем `.unwrap()` на `ctx_arc.read()` —
/// только через эту функцию.
fn try_read_ctx(ctx_arc: &crate::context::AppContextState) -> Option<RwLockReadGuard<'_, AppContext>> {
    match ctx_arc.read() {
        Ok(guard) => Some(guard),
        Err(poisoned) => {
            error!("AppContext RwLock отравлен, пропускаем обработку правила");
            Some(poisoned.into_inner())
        }
    }
}

pub struct PendingTapHold {
    pub vk_code: u8,
    pub tap_actions: Vec<EngineAction>,
    pub hold_actions: Vec<EngineAction>,
    pub down_time: Instant,
    pub timeout_ms: u32,
    pub is_held: bool,
}

pub static PENDING_TAP_HOLDS: LazyLock<Mutex<HashMap<u8, PendingTapHold>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static PHYSICAL_MODIFIERS: AtomicU16 = AtomicU16::new(0);
static ACTIVE_COMBO_ACTIONS: LazyLock<Mutex<HashMap<u8, Vec<EngineAction>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn modifier_bit_for_vk(vk: u8) -> u16 {
    match vk {
        0xA2 => key_modifiers::LCTRL,
        0xA3 => key_modifiers::RCTRL,
        0xA4 => key_modifiers::LALT,
        0xA5 => key_modifiers::RALT,
        0xA0 => key_modifiers::LSHIFT,
        0xA1 => key_modifiers::RSHIFT,
        0x5B => key_modifiers::LWIN,
        0x5C => key_modifiers::RWIN,
        0x11 => key_modifiers::CTRL,
        0x12 => key_modifiers::ALT,
        0x10 => key_modifiers::SHIFT,
        _ => 0,
    }
}

pub fn is_modifier_vk(vk: u8) -> bool {
    modifier_bit_for_vk(vk) != 0
}

/// Update physical modifier state and return the modifier snapshot that belongs
/// to this event. For a modifier key itself, its own bit is excluded so legacy
/// single-modifier rules still behave like an ordinary key trigger.
pub fn update_modifier_state(vk: u8, is_down: bool) -> u16 {
    let bit = modifier_bit_for_vk(vk);
    if bit == 0 {
        return PHYSICAL_MODIFIERS.load(Ordering::Relaxed) & key_modifiers::ALL;
    }

    if is_down {
        let before = PHYSICAL_MODIFIERS.fetch_or(bit, Ordering::Relaxed);
        before & key_modifiers::ALL
    } else {
        let before = PHYSICAL_MODIFIERS.fetch_and(!bit, Ordering::Relaxed);
        (before & !bit) & key_modifiers::ALL
    }
}

pub fn reset_modifier_state() {
    PHYSICAL_MODIFIERS.store(0, Ordering::Relaxed);
    if let Ok(mut active) = ACTIVE_COMBO_ACTIONS.lock() {
        active.clear();
    }
}

fn family_matches(required: u16, actual: u16, generic: u16, left: u16, right: u16) -> bool {
    let req_generic = required & generic != 0;
    let req_sides = required & (left | right);
    let actual_family = actual & (generic | left | right);

    if req_generic {
        return actual_family != 0;
    }
    if req_sides != 0 {
        return actual_family & req_sides == req_sides
            && actual_family & (left | right) & !req_sides == 0
            && actual_family & generic == 0;
    }
    actual_family == 0
}

fn modifiers_match(required: u16, actual: u16) -> bool {
    let required = required & key_modifiers::ALL;
    let actual = actual & key_modifiers::ALL;
    family_matches(required, actual, key_modifiers::CTRL, key_modifiers::LCTRL, key_modifiers::RCTRL)
        && family_matches(required, actual, key_modifiers::ALT, key_modifiers::LALT, key_modifiers::RALT)
        && family_matches(required, actual, key_modifiers::SHIFT, key_modifiers::LSHIFT, key_modifiers::RSHIFT)
        && family_matches(required, actual, key_modifiers::WIN, key_modifiers::LWIN, key_modifiers::RWIN)
}

fn modifier_vks(mask: u16) -> Vec<u8> {
    let mut result = Vec::with_capacity(4);
    if mask & key_modifiers::CTRL != 0 { result.push(0xA2); }
    else {
        if mask & key_modifiers::LCTRL != 0 { result.push(0xA2); }
        if mask & key_modifiers::RCTRL != 0 { result.push(0xA3); }
    }
    if mask & key_modifiers::ALT != 0 { result.push(0xA4); }
    else {
        if mask & key_modifiers::LALT != 0 { result.push(0xA4); }
        if mask & key_modifiers::RALT != 0 { result.push(0xA5); }
    }
    if mask & key_modifiers::SHIFT != 0 { result.push(0xA0); }
    else {
        if mask & key_modifiers::LSHIFT != 0 { result.push(0xA0); }
        if mask & key_modifiers::RSHIFT != 0 { result.push(0xA1); }
    }
    if mask & key_modifiers::WIN != 0 { result.push(0x5B); }
    else {
        if mask & key_modifiers::LWIN != 0 { result.push(0x5B); }
        if mask & key_modifiers::RWIN != 0 { result.push(0x5C); }
    }
    result
}

fn send_atomic_chord(
    simulator: &crate::simulator::SimulatorSender,
    code: u8,
    modifiers: u16,
) {
    let physical = PHYSICAL_MODIFIERS.load(Ordering::Relaxed) & key_modifiers::ALL;
    let physical_vks = modifier_vks(physical);
    let output_vks = modifier_vks(modifiers & key_modifiers::ALL);

    // Neutralize the physical trigger modifiers so Ctrl+Shift+F2 -> Alt+Tab
    // does not accidentally become Ctrl+Shift+Alt+Tab in the foreground app.
    for vk in physical_vks.iter().rev() {
        let _ = simulator.send(SimulatorCommand::ReleaseKey(*vk));
    }
    for vk in &output_vks {
        let _ = simulator.send(SimulatorCommand::PressKey(*vk));
    }
    if code != 0 {
        let _ = simulator.send(SimulatorCommand::PressKey(code));
        let _ = simulator.send(SimulatorCommand::ReleaseKey(code));
    }
    for vk in output_vks.iter().rev() {
        let _ = simulator.send(SimulatorCommand::ReleaseKey(*vk));
    }
    // Restore the OS-visible modifier state to the keys that are still
    // physically held. Injected events are ignored by our LL hook.
    for vk in &physical_vks {
        let _ = simulator.send(SimulatorCommand::PressKey(*vk));
    }
}

fn check_conditions(conditions: &[EngineCondition], ctx: &crate::context::AppContext) -> bool {
    for cond in conditions {
        match cond {
            EngineCondition::LayerActive { layer_id_hash } => {
                if !ctx.active_layers.contains(layer_id_hash) {
                    return false;
                }
            }
            EngineCondition::VirtualDesktop { .. } => {
                // Defensive fail-closed. The compiler currently converts legacy
                // VirtualDesktop conditions to an impossible WindowMatch too.
                return false;
            }
            EngineCondition::WindowMatch {
                process_hash,
                title_contains,
            } => {
                let process_ok = match process_hash {
                    Some(h) => calculate_hash(&ctx.active_process) == *h,
                    None => false,
                };
                let title_ok = match title_contains {
                    Some(t) => ctx.active_window_title.to_lowercase().contains(t),
                    None => false,
                };
                if !process_ok && !title_ok {
                    return false;
                }
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
    trigger_modifiers: u16,
) -> EventAction {
    for action in actions {
        match action {
            EngineAction::RemapKey { code, modifiers } => {
                // Chord remaps are emitted atomically. Legacy single-key -> single-key
                // remaps keep their down/up lifecycle and therefore preserve hold/repeat.
                if trigger_modifiers != 0 || *modifiers != 0 {
                    if is_down {
                        send_atomic_chord(simulator, *code, *modifiers);
                    }
                } else if is_down {
                    let _ = simulator.send(SimulatorCommand::PressKey(*code));
                } else {
                    let _ = simulator.send(SimulatorCommand::ReleaseKey(*code));
                }
            }
            EngineAction::RemapMouse { code } => {
                if is_down {
                    let _ = simulator.send(SimulatorCommand::MousePress(*code));
                } else {
                    let _ = simulator.send(SimulatorCommand::MouseRelease(*code));
                }
            }
            EngineAction::TypeText { text } => {
                if is_down {
                    let _ = simulator.send(SimulatorCommand::TypeString(text.clone()));
                }
            }
            EngineAction::MacroCommands { commands } => {
                if is_down {
                    let mut macro_commands = commands.clone();

                    // Позицию курсора фиксируем в момент запуска макроса, но команду
                    // возврата добавляем в КОНЕЦ macro-job. Раньше все команды, включая
                    // Delay, шли в общую очередь и могли задерживать обычный remap.
                    #[cfg(target_os = "windows")]
                    {
                        if let Some(state_ref) = state {
                            if let Ok(s) = state_ref.read() {
                                if s.restore_mouse_after_macro {
                                    let mut point = windows::Win32::Foundation::POINT { x: 0, y: 0 };
                                    unsafe {
                                        let _ = windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point);
                                    }
                                    macro_commands.push(SimulatorCommand::MouseAbsolute {
                                        x: point.x,
                                        y: point.y,
                                    });
                                }
                            }
                        }
                    }

                    let _ = simulator.send_macro(macro_commands);
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
                        "mute" => 0xAD,
                        "down" => 0xAE,
                        "up" => 0xAF,
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
                        "play_pause" => 0xB3,
                        "next" => 0xB0,
                        "prev" => 0xB1,
                        "stop" => 0xB2,
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
            EngineAction::FocusProcess { process, title } => {
                if is_down {
                    crate::simulator::system::focus_process(process.as_deref(), title.as_deref());
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
        for info in pending.values_mut() {
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
                        execute_actions(&actions, simulator, &ctx_state, true, Some(state_ref), 0);
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
    event_modifiers: u16,
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
        } else if vk_code == 0x08 {
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
                    let char_count = buf.chars().count();
                    if char_count > 30 {
                        let skip_chars = char_count - 30;
                        if let Some((byte_idx, _)) = buf.char_indices().nth(skip_chars) {
                            buf.drain(0..byte_idx);
                        }
                    }

                    let Some(ctx) = try_read_ctx(&ctx_arc) else {
                        return EventAction::PassThrough;
                    };
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

                    if matched_rule.is_some() {
                        buf.clear();
                    }
                }

                if let Some(rule) = matched_rule {
                    let backspaces = matched_sequence.chars().count().saturating_sub(1);
                    for _ in 0..backspaces {
                        let _ = simulator.send(SimulatorCommand::PressKey(0x08));
                        let _ = simulator.send(SimulatorCommand::ReleaseKey(0x08));
                    }

                    execute_actions(&rule.actions, simulator, &ctx_arc, true, state, 0);
                    execute_actions(&rule.actions, simulator, &ctx_arc, false, state, 0);

                    return EventAction::Block;
                }
            } else if let Ok(mut buf) = s.typed_buffer.lock() {
                buf.clear();
            }
        }
    }

    // Check Tap-Hold resolution FIRST
    if is_key_down {
        let mut early_trigger = Vec::new();
        if let Ok(mut pending) = PENDING_TAP_HOLDS.lock() {
            if !pending.contains_key(&vk_code) {
                for info in pending.values_mut() {
                    if !info.is_held {
                        info.is_held = true;
                        early_trigger.push(info.hold_actions.clone());
                    }
                }
            }
        }
        for actions in early_trigger {
            execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
        }

        if let Some(rules) = engine_schema.tap_hold_map.get(&vk_code) {
            let Some(ctx) = try_read_ctx(&ctx_arc) else {
                return EventAction::PassThrough;
            };
            for rule in rules {
                if check_conditions(&rule.conditions, &ctx) {
                    if let Ok(mut pending) = PENDING_TAP_HOLDS.lock() {
                        pending.insert(
                            vk_code,
                            PendingTapHold {
                                vk_code,
                                tap_actions: rule.tap_actions.clone(),
                                hold_actions: rule.hold_actions.clone(),
                                down_time: Instant::now(),
                                timeout_ms: rule.timeout_ms,
                                is_held: false,
                            },
                        );
                    }
                    return EventAction::Block;
                }
            }
        }
    } else {
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
            execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
            execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            return EventAction::Block;
        } else if let Some(actions) = hold_actions {
            execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            return EventAction::Block;
        }
    }

    // If a modifier-combo rule matched on key-down, its release must run even
    // when the user releases Ctrl/Alt/Shift/Win before the primary key. This is
    // especially important for HoldLayer actions.
    if !is_key_down {
        if let Ok(mut active) = ACTIVE_COMBO_ACTIONS.lock() {
            if let Some(actions) = active.remove(&vk_code) {
                drop(active);
                return execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            }
        }
    } else if let Ok(active) = ACTIVE_COMBO_ACTIONS.lock() {
        if active.contains_key(&vk_code) {
            return EventAction::Block;
        }
    }

    if let Some(rules) = engine_schema.keyboard_map.get(&vk_code) {
        let Some(ctx) = try_read_ctx(&ctx_arc) else {
            return EventAction::PassThrough;
        };
        for rule in rules {
            if modifiers_match(rule.required_modifiers, event_modifiers)
                && check_conditions(&rule.conditions, &ctx)
            {
                let actions = rule.actions.clone();
                let required_modifiers = rule.required_modifiers;
                drop(ctx);
                if is_key_down && required_modifiers != 0 {
                    if let Ok(mut active) = ACTIVE_COMBO_ACTIONS.lock() {
                        active.insert(vk_code, actions.clone());
                    }
                }
                return execute_actions(
                    &actions,
                    simulator,
                    &ctx_arc,
                    is_key_down,
                    state,
                    required_modifiers,
                );
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

    if let Some(rules) = engine_schema.mouse_map.get(&button) {
        let Some(ctx) = try_read_ctx(&ctx_arc) else {
            return EventAction::PassThrough;
        };
        for rule in rules {
            if check_conditions(&rule.conditions, &ctx) {
                drop(ctx);
                return execute_actions(&rule.actions, simulator, &ctx_arc, is_down, state, 0);
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
        let state = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(0x10);
        (state & 0x8000u16 as i16) != 0
    }
}

#[cfg(not(target_os = "windows"))]
fn is_shift_pressed() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn vk_to_char(vk: u8, _shift: bool) -> Option<char> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardLayout, GetKeyboardState, MapVirtualKeyW, ToUnicodeEx, MAPVK_VK_TO_VSC_EX,
    };

    unsafe {
        let mut key_state = [0u8; 256];
        if GetKeyboardState(&mut key_state).is_err() {
            return None;
        }

        let dwhkl = GetKeyboardLayout(0);
        let scan_code = MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC_EX);

        let mut buf = [0u16; 4];
        let result = ToUnicodeEx(vk as u32, scan_code, &key_state, &mut buf, 0, Some(dwhkl));

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
