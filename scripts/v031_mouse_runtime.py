from pathlib import Path

# Compiler: stable runtime ID for per-rule movement gates.
p = Path('src-tauri/src/daemon/compiler.rs')
s = p.read_text(encoding='utf-8')
old = '''    CompiledMouseMoveRule {
        priority: rule.priority,'''
new = '''    CompiledMouseMoveRule {
        rule_id_hash: calculate_hash(&rule.id),
        priority: rule.priority,'''
if old not in s:
    raise SystemExit('compiler movement rule marker not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')

p = Path('src-tauri/src/daemon/engine.rs')
s = p.read_text(encoding='utf-8')
s = s.replace('use std::time::Instant;', 'use std::time::{Duration, Instant};', 1)
import_marker = '''use crate::daemon::chord_output::{
    build_atomic_chord_commands, isolate_macro_commands, modifier_vks,
    release_modifier_commands, shell_mask_commands,
};
'''
import_repl = import_marker + '''use crate::daemon::mouse_triggers::{
    system_double_click_limits, wheel_key, DoubleClickDetector, MoveGate,
};
'''
if import_marker not in s:
    raise SystemExit('engine import marker not found')
s = s.replace(import_marker, import_repl, 1)

static_marker = '''static PENDING_MOUSE_UP_ACTIONS: LazyLock<Mutex<HashMap<u8, Vec<EngineAction>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
'''
static_repl = static_marker + '''static DOUBLE_CLICK_DETECTOR: LazyLock<Mutex<DoubleClickDetector>> =
    LazyLock::new(|| Mutex::new(DoubleClickDetector::default()));
static MOUSE_MOVE_GATES: LazyLock<Mutex<HashMap<u64, MoveGate>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
'''
if static_marker not in s:
    raise SystemExit('engine mouse static marker not found')
s = s.replace(static_marker, static_repl, 1)

reset_marker = '''    if let Ok(mut pending) = PENDING_MOUSE_UP_ACTIONS.lock() {
        pending.clear();
    }
}'''
reset_repl = '''    if let Ok(mut pending) = PENDING_MOUSE_UP_ACTIONS.lock() {
        pending.clear();
    }
    if let Ok(mut detector) = DOUBLE_CLICK_DETECTOR.lock() {
        detector.clear();
    }
    if let Ok(mut gates) = MOUSE_MOVE_GATES.lock() {
        gates.clear();
    }
}'''
if reset_marker not in s:
    raise SystemExit('engine reset marker not found')
s = s.replace(reset_marker, reset_repl, 1)

start = s.index('pub fn process_mouse_event(')
end = s.index('pub fn vk_to_key_name', start)
new_fn = r'''pub fn process_mouse_event(
    button: u8,
    x: i32,
    y: i32,
    delta: i32,
    horizontal_wheel: bool,
    is_move: bool,
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

    // Wheel/hwheel are standalone source events, so matched wheel rules can be
    // consumed immediately without creating a down/up lifecycle.
    if delta != 0 {
        if let Some(key) = wheel_key(delta, horizontal_wheel) {
            if let Some(rules) = engine_schema.mouse_wheel_map.get(&key) {
                let Some(ctx) = try_read_ctx(&ctx_arc) else {
                    return EventAction::PassThrough;
                };
                for rule in rules {
                    if !check_conditions(&rule.conditions, &ctx) {
                        continue;
                    }
                    let actions = rule.actions.clone();
                    drop(ctx);
                    execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                    execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
                    return EventAction::Block;
                }
            }
        }
        return EventAction::PassThrough;
    }

    // Movement triggers are additive. Blocking WM_MOUSEMOVE would freeze the
    // pointer; no waiting or platform query happens in this hot path.
    if is_move {
        if !engine_schema.mouse_move_rules.is_empty() {
            let Some(ctx) = try_read_ctx(&ctx_arc) else {
                return EventAction::PassThrough;
            };
            let now = Instant::now();
            for rule in &engine_schema.mouse_move_rules {
                if !check_conditions(&rule.conditions, &ctx) {
                    continue;
                }
                let should_fire = MOUSE_MOVE_GATES
                    .lock()
                    .map(|mut gates| {
                        gates.entry(rule.rule_id_hash).or_default().should_fire(
                            x,
                            y,
                            now,
                            rule.min_distance,
                            Duration::from_millis(u64::from(rule.cooldown_ms)),
                        )
                    })
                    .unwrap_or(false);
                if should_fire {
                    let actions = rule.actions.clone();
                    drop(ctx);
                    execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                    execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
                    break;
                }
            }
        }
        return EventAction::PassThrough;
    }

    // Double-click detection is also additive: the first click is never delayed
    // while waiting for a possible second click.
    if is_down && button != 255 {
        if let Some(rules) = engine_schema.mouse_double_click_map.get(&button) {
            let (interval, max_dx, max_dy) = system_double_click_limits();
            let is_double = DOUBLE_CLICK_DETECTOR
                .lock()
                .map(|mut detector| {
                    detector.register_down(
                        button,
                        x,
                        y,
                        Instant::now(),
                        interval,
                        max_dx,
                        max_dy,
                    )
                })
                .unwrap_or(false);
            if is_double {
                if let Some(ctx) = try_read_ctx(&ctx_arc) {
                    for rule in rules {
                        if !check_conditions(&rule.conditions, &ctx) {
                            continue;
                        }
                        let actions = rule.actions.clone();
                        drop(ctx);
                        execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                        execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
                        break;
                    }
                }
            }
        }
    }

    // Ordinary button down/up lifecycle stays exactly as before.
    if !is_down {
        if let Ok(mut pending) = PENDING_MOUSE_UP_ACTIONS.lock() {
            if let Some(actions) = pending.remove(&button) {
                drop(pending);
                execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                return execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            }
        }
        if let Ok(mut active) = ACTIVE_MOUSE_DOWN_ACTIONS.lock() {
            if let Some(actions) = active.remove(&button) {
                drop(active);
                return execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            }
        }
    } else {
        if ACTIVE_MOUSE_DOWN_ACTIONS
            .lock()
            .map(|active| active.contains_key(&button))
            .unwrap_or(false)
            || PENDING_MOUSE_UP_ACTIONS
                .lock()
                .map(|pending| pending.contains_key(&button))
                .unwrap_or(false)
        {
            return EventAction::Block;
        }

        if let Some(rules) = engine_schema.mouse_map.get(&button) {
            let Some(ctx) = try_read_ctx(&ctx_arc) else {
                return EventAction::PassThrough;
            };
            for rule in rules {
                if !check_conditions(&rule.conditions, &ctx) {
                    continue;
                }
                let actions = rule.actions.clone();
                let trigger_on_down = rule.trigger_on_down;
                drop(ctx);
                if trigger_on_down {
                    if let Ok(mut active) = ACTIVE_MOUSE_DOWN_ACTIONS.lock() {
                        active.insert(button, actions.clone());
                    }
                    return execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                }
                if let Ok(mut pending) = PENDING_MOUSE_UP_ACTIONS.lock() {
                    pending.insert(button, actions);
                }
                return EventAction::Block;
            }
        }
    }

    EventAction::PassThrough
}

'''
s = s[:start] + new_fn + s[end:]
p.write_text(s, encoding='utf-8')

p = Path('src-tauri/src/daemon/hooks.rs')
s = p.read_text(encoding='utf-8')
old = 'let action = engine::process_mouse_event(button, x, y, delta, flags, is_mouse_down, state_ref);'
new = '''let action = engine::process_mouse_event(
        button,
        x,
        y,
        delta,
        msg_type == WM_MOUSEHWHEEL as u32,
        msg_type == WM_MOUSEMOVE as u32,
        flags,
        is_mouse_down,
        state_ref,
    );'''
if old not in s:
    raise SystemExit('mouse hook call marker not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
