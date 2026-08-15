from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"pattern not found in {rel}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(rel: str, old: str, new: str, minimum: int = 1) -> int:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f"expected >= {minimum} matches in {rel}, got {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")
    return count


# ---------------------------------------------------------------------------
# Profile schema v2 migration: chord modifiers + rule tree metadata.
# ---------------------------------------------------------------------------
replace_once(
    "src-tauri/src/shared/persistence.rs",
    "pub const PROFILE_SCHEMA_VERSION: u32 = 1;",
    "pub const PROFILE_SCHEMA_VERSION: u32 = 2;",
)

replace_once(
    "src-tauri/src/shared/persistence.rs",
    '''            0 => {
                // v0 -> v1: существующие данные не преобразуются — добавляется
                // только явная версия схемы.
                object.insert("schemaVersion".to_string(), json!(1));
                version = 1;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),''',
    '''            0 => {
                // v0 -> v1: историческая миграция — только явная версия схемы.
                object.insert("schemaVersion".to_string(), json!(1));
                version = 1;
            }
            1 => {
                // v1 -> v2: rule model v2. Старые single-key правила остаются
                // семантически теми же, но получают modifiers=0 и tree metadata.
                object.entry("folders".to_string()).or_insert_with(|| json!([]));

                if let Some(rules) = object.get_mut("rules").and_then(Value::as_array_mut) {
                    for (index, rule) in rules.iter_mut().enumerate() {
                        let Some(rule_obj) = rule.as_object_mut() else { continue; };
                        rule_obj.entry("enabled".to_string()).or_insert_with(|| json!(true));
                        rule_obj.entry("folderId".to_string()).or_insert(Value::Null);
                        rule_obj.entry("order".to_string()).or_insert_with(|| json!(index as i32));

                        if let Some(trigger) = rule_obj.get_mut("trigger").and_then(Value::as_object_mut) {
                            let is_keyboard = matches!(
                                trigger.get("type").and_then(Value::as_str),
                                Some("keyDown" | "keyUp")
                            );
                            if is_keyboard {
                                trigger.entry("modifiers".to_string()).or_insert_with(|| json!(0));
                            }
                        }

                        for action_field in ["actions", "holdActions"] {
                            let Some(actions) = rule_obj.get_mut(action_field).and_then(Value::as_array_mut) else {
                                continue;
                            };
                            for action in actions {
                                let Some(action_obj) = action.as_object_mut() else { continue; };
                                if action_obj.get("type").and_then(Value::as_str) == Some("remapKey") {
                                    action_obj.entry("modifiers".to_string()).or_insert_with(|| json!(0));
                                }
                            }
                        }
                    }
                }

                object.insert("schemaVersion".to_string(), json!(2));
                version = 2;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),''',
)

replace_once(
    "src-tauri/src/shared/persistence.rs",
    '''        rules: vec![],
        layers: vec![],
    }
}''',
    '''        rules: vec![],
        layers: vec![],
        folders: vec![],
    }
}''',
)

# ---------------------------------------------------------------------------
# Router: construct v2 profiles/rules and expose daemon-side chord capture.
# ---------------------------------------------------------------------------
replace_all(
    "src-tauri/src/daemon/router.rs",
    '''                    rules: vec![],
                    layers: vec![],
                };''',
    '''                    rules: vec![],
                    layers: vec![],
                    folders: vec![],
                };''',
    minimum=2,
)

replace_once(
    "src-tauri/src/daemon/router.rs",
    '''                    use crate::schemas::frontend::{
                        FrontendAction, FrontendRule, FrontendTrigger, MacroAction, MacroStep,
                    };''',
    '''                    use crate::schemas::frontend::{
                        FrontendAction, FrontendRule, FrontendTrigger, KeyChord, MacroAction,
                        MacroStep,
                    };''',
)
replace_once(
    "src-tauri/src/daemon/router.rs",
    'trigger: FrontendTrigger::KeyDown { code: 20 }, // VK_CAPITAL (Caps Lock)',
    'trigger: FrontendTrigger::KeyDown { chord: KeyChord::single(20) }, // VK_CAPITAL',
)
replace_once(
    "src-tauri/src/daemon/router.rs",
    'actions: vec![FrontendAction::RemapKey { code: 8 }], // VK_BACK (Backspace)',
    'actions: vec![FrontendAction::RemapKey { chord: KeyChord::single(8) }], // VK_BACK',
)
replace_once(
    "src-tauri/src/daemon/router.rs",
    'trigger: FrontendTrigger::KeyDown { code: 123 }, // F12',
    'trigger: FrontendTrigger::KeyDown { chord: KeyChord::single(123) }, // F12',
)
replace_all(
    "src-tauri/src/daemon/router.rs",
    '''                            priority: 10,
                        },''',
    '''                            priority: 10,
                            enabled: true,
                            folder_id: None,
                            order: prof.rules.len() as i32,
                        },''',
    minimum=3,
)

replace_once(
    "src-tauri/src/daemon/router.rs",
    '''                if let Ok(mut captured) = s.last_captured_mouse.lock() {
                    *captured = None;
                }
                Ok(json!({ "success": true, "active": active }))''',
    '''                if let Ok(mut captured) = s.last_captured_key.lock() {
                    *captured = None;
                }
                if let Ok(mut captured) = s.last_captured_mouse.lock() {
                    *captured = None;
                }
                Ok(json!({ "success": true, "active": active }))''',
)

replace_once(
    "src-tauri/src/daemon/router.rs",
    '''        "keycapture.get_captured_mouse" => {''',
    '''        "keycapture.get_captured_key" => {
            let chord = {
                let s = state.read().map_err(|_| "Failed to lock state")?;
                if !s.key_capture_active.load(std::sync::atomic::Ordering::Relaxed) {
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

        "keycapture.get_captured_mouse" => {''',
)

# ---------------------------------------------------------------------------
# Engine: physical modifier tracker, exact/family matching, safe atomic chords.
# ---------------------------------------------------------------------------
replace_once(
    "src-tauri/src/daemon/engine.rs",
    'use std::sync::{LazyLock, Mutex, RwLockReadGuard};',
    'use std::sync::{atomic::{AtomicU16, Ordering}, LazyLock, Mutex, RwLockReadGuard};',
)
replace_once(
    "src-tauri/src/daemon/engine.rs",
    'use crate::schemas::engine::{EngineAction, EngineCondition, SimulatorCommand};',
    'use crate::schemas::engine::{EngineAction, EngineCondition, SimulatorCommand};\nuse crate::schemas::frontend::key_modifiers;',
)

replace_once(
    "src-tauri/src/daemon/engine.rs",
    '''pub static PENDING_TAP_HOLDS: LazyLock<Mutex<HashMap<u8, PendingTapHold>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn check_conditions''',
    '''pub static PENDING_TAP_HOLDS: LazyLock<Mutex<HashMap<u8, PendingTapHold>>> =
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

fn check_conditions''',
)

replace_once(
    "src-tauri/src/daemon/engine.rs",
    '''            EngineCondition::VirtualDesktop { .. } => {
                // Not implemented yet. Не расширяем функциональность в v0.3 UI/stability.
            }''',
    '''            EngineCondition::VirtualDesktop { .. } => {
                // Defensive fail-closed. The compiler currently converts legacy
                // VirtualDesktop conditions to an impossible WindowMatch too.
                return false;
            }''',
)

replace_once(
    "src-tauri/src/daemon/engine.rs",
    '''    is_down: bool,
    state: Option<&DaemonStateRef>,
) -> EventAction {''',
    '''    is_down: bool,
    state: Option<&DaemonStateRef>,
    trigger_modifiers: u16,
) -> EventAction {''',
)
replace_once(
    "src-tauri/src/daemon/engine.rs",
    '''            EngineAction::RemapKey { code } => {
                if is_down {
                    let _ = simulator.send(SimulatorCommand::PressKey(*code));
                } else {
                    let _ = simulator.send(SimulatorCommand::ReleaseKey(*code));
                }
            }''',
    '''            EngineAction::RemapKey { code, modifiers } => {
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
            }''',
)

# Add trigger_modifiers=0 to non-keyboard execution paths.
replacements = [
    (
        'execute_actions(&actions, simulator, &ctx_state, true, Some(state_ref));',
        'execute_actions(&actions, simulator, &ctx_state, true, Some(state_ref), 0);',
    ),
    (
        'execute_actions(&rule.actions, simulator, &ctx_arc, true, state);',
        'execute_actions(&rule.actions, simulator, &ctx_arc, true, state, 0);',
    ),
    (
        'execute_actions(&rule.actions, simulator, &ctx_arc, false, state);',
        'execute_actions(&rule.actions, simulator, &ctx_arc, false, state, 0);',
    ),
    (
        'execute_actions(&actions, simulator, &ctx_arc, true, state);',
        'execute_actions(&actions, simulator, &ctx_arc, true, state, 0);',
    ),
    (
        'execute_actions(&actions, simulator, &ctx_arc, false, state);',
        'execute_actions(&actions, simulator, &ctx_arc, false, state, 0);',
    ),
]
for old, new in replacements:
    replace_all("src-tauri/src/daemon/engine.rs", old, new, minimum=1)

replace_once(
    "src-tauri/src/daemon/engine.rs",
    '''    _flags: u32,
    state: Option<&DaemonStateRef>,
) -> EventAction {''',
    '''    _flags: u32,
    event_modifiers: u16,
    state: Option<&DaemonStateRef>,
) -> EventAction {''',
)

replace_once(
    "src-tauri/src/daemon/engine.rs",
    '''    if let Some(rules) = engine_schema.keyboard_map.get(&vk_code) {
        let Some(ctx) = try_read_ctx(&ctx_arc) else {
            return EventAction::PassThrough;
        };
        for rule in rules {
            if check_conditions(&rule.conditions, &ctx) {
                drop(ctx);
                return execute_actions(&rule.actions, simulator, &ctx_arc, is_key_down, state);
            }
        }
    }

    EventAction::PassThrough''',
    '''    // If a modifier-combo rule matched on key-down, its release must run even
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

    EventAction::PassThrough''',
)

# Mouse final dispatch: the broad replacements above may leave this old call.
replace_all(
    "src-tauri/src/daemon/engine.rs",
    'return execute_actions(&rule.actions, simulator, &ctx_arc, is_down, state);',
    'return execute_actions(&rule.actions, simulator, &ctx_arc, is_down, state, 0);',
    minimum=1,
)

# ---------------------------------------------------------------------------
# LL hook: update physical modifiers before capture/engine, daemon-capture chord.
# ---------------------------------------------------------------------------
replace_once(
    "src-tauri/src/daemon/hooks.rs",
    '''    let is_key_down = wparam.0 == WM_KEYDOWN as usize
        || wparam.0 == WM_SYSKEYDOWN as usize;

    tracing::debug!''',
    '''    let is_key_down = wparam.0 == WM_KEYDOWN as usize
        || wparam.0 == WM_SYSKEYDOWN as usize;
    let event_modifiers = engine::update_modifier_state(vk_code, is_key_down);

    tracing::debug!''',
)
replace_once(
    "src-tauri/src/daemon/hooks.rs",
    '''            // Режим захвата клавиши для KeyPicker: пропускаем клавишу мимо engine,
            // чтобы GUI мог её записать даже если правило её блокирует.
            // F12 (служебная клавиша записи макроса) здесь не фильтруем —
            // её перехватываем ниже как обычно.
            if s.key_capture_active.load(Ordering::Relaxed) && vk_code != 0x7B {
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }''',
    '''            // Daemon-side chord capture. We block keyboard events while listening
            // so Win/Alt combinations can be recorded without launching Windows UI or
            // switching apps before KeyPicker receives the chord.
            if s.key_capture_active.load(Ordering::Relaxed) {
                if is_key_down && !engine::is_modifier_vk(vk_code) {
                    let captured = if vk_code == 0x1B {
                        crate::schemas::frontend::KeyChord::single(0)
                    } else {
                        crate::schemas::frontend::KeyChord {
                            code: vk_code,
                            modifiers: event_modifiers,
                        }
                    };
                    if let Ok(mut slot) = s.last_captured_key.lock() {
                        *slot = Some(captured);
                    }
                }
                return LRESULT(1);
            }''',
)
replace_once(
    "src-tauri/src/daemon/hooks.rs",
    '''        flags.0,
        state_ref,
    );''',
    '''        flags.0,
        event_modifiers,
        state_ref,
    );''',
)
replace_once(
    "src-tauri/src/daemon/hooks.rs",
    '''pub fn uninstall_hooks() {
    KB_HOOK_INSTALLED.store(false, Ordering::SeqCst);
    MOUSE_HOOK_INSTALLED.store(false, Ordering::SeqCst);
    info!("Хуки деинсталлированы");
}''',
    '''pub fn uninstall_hooks() {
    KB_HOOK_INSTALLED.store(false, Ordering::SeqCst);
    MOUSE_HOOK_INSTALLED.store(false, Ordering::SeqCst);
    engine::reset_modifier_state();
    info!("Хуки деинсталлированы");
}''',
)

print("v0.3.0 core textual migration applied")
