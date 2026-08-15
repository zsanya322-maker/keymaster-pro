from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected 1 match, got {count} for {old[:80]!r}')
    write(path, text.replace(old, new, 1))

# Engine helpers are intentionally shared with the typed mouse runtime.
replace_once('src-tauri/src/daemon/engine.rs',
             'fn check_conditions(conditions: &[EngineCondition], ctx: &crate::context::AppContext) -> bool {',
             'pub(crate) fn check_conditions(conditions: &[EngineCondition], ctx: &crate::context::AppContext) -> bool {')
replace_once('src-tauri/src/daemon/engine.rs',
             'fn execute_actions(\n',
             'pub(crate) fn execute_actions(\n')

# Give movement rules stable runtime identity so cooldown/anchor state survives sorting.
replace_once('src-tauri/src/schemas/engine.rs',
             'pub struct CompiledMouseMoveRule {\n    pub priority: i32,',
             'pub struct CompiledMouseMoveRule {\n    pub rule_hash: u64,\n    pub priority: i32,')
replace_once('src-tauri/src/daemon/compiler.rs',
             '    CompiledMouseMoveRule {\n        priority: rule.priority,',
             '    CompiledMouseMoveRule {\n        rule_hash: calculate_hash(&rule.id),\n        priority: rule.priority,')

mouse_runtime = r'''use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::daemon::engine::{self, EventAction};
use crate::daemon::state::DaemonStateRef;
use crate::schemas::engine::{CompiledMouseMoveRule, CompiledRule};

#[derive(Debug, Clone, Copy)]
struct ClickState {
    at: Instant,
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Copy)]
struct MoveState {
    anchor_x: i32,
    anchor_y: i32,
    last_fired: Option<Instant>,
}

static CLICK_STATES: LazyLock<Mutex<HashMap<u8, ClickState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static MOVE_STATES: LazyLock<Mutex<HashMap<u64, MoveState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(target_os = "windows")]
static DOUBLE_CLICK_CONFIG: LazyLock<(u32, i32, i32)> = LazyLock::new(|| unsafe {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetDoubleClickTime, GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK,
    };
    (
        GetDoubleClickTime(),
        GetSystemMetrics(SM_CXDOUBLECLK).max(1),
        GetSystemMetrics(SM_CYDOUBLECLK).max(1),
    )
});

#[cfg(not(target_os = "windows"))]
static DOUBLE_CLICK_CONFIG: LazyLock<(u32, i32, i32)> = LazyLock::new(|| (500, 4, 4));

fn wheel_key(msg_type: u32, delta: i32) -> Option<i8> {
    use windows::Win32::UI::WindowsAndMessaging::{WM_MOUSEHWHEEL, WM_MOUSEWHEEL};
    if delta == 0 {
        return None;
    }
    if msg_type == WM_MOUSEWHEEL {
        Some(if delta > 0 { 1 } else { -1 })
    } else if msg_type == WM_MOUSEHWHEEL {
        Some(if delta > 0 { 2 } else { -2 })
    } else {
        None
    }
}

fn button_down_message(msg_type: u32) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN, WM_XBUTTONDOWN,
    };
    matches!(msg_type, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN)
}

fn is_double_click_candidate(previous: ClickState, now: Instant, x: i32, y: i32) -> bool {
    let (timeout_ms, width, height) = *DOUBLE_CLICK_CONFIG;
    now.duration_since(previous.at) <= Duration::from_millis(timeout_ms as u64)
        && (x - previous.x).abs() <= width / 2
        && (y - previous.y).abs() <= height / 2
}

fn detect_double_click(button: u8, x: i32, y: i32, now: Instant) -> bool {
    if !(1..=5).contains(&button) {
        return false;
    }
    let Ok(mut states) = CLICK_STATES.lock() else {
        return false;
    };
    if let Some(previous) = states.get(&button).copied() {
        if is_double_click_candidate(previous, now, x, y) {
            states.remove(&button);
            return true;
        }
    }
    states.insert(button, ClickState { at: now, x, y });
    false
}

fn movement_due(rule: &CompiledMouseMoveRule, x: i32, y: i32, now: Instant) -> bool {
    let Ok(mut states) = MOVE_STATES.lock() else {
        return false;
    };
    let state = states.entry(rule.rule_hash).or_insert(MoveState {
        anchor_x: x,
        anchor_y: y,
        last_fired: None,
    });

    let dx = i64::from(x - state.anchor_x);
    let dy = i64::from(y - state.anchor_y);
    let min = i64::from(rule.min_distance.max(1));
    if dx * dx + dy * dy < min * min {
        return false;
    }
    if let Some(last) = state.last_fired {
        if now.duration_since(last) < Duration::from_millis(rule.cooldown_ms as u64) {
            return false;
        }
    }

    state.anchor_x = x;
    state.anchor_y = y;
    state.last_fired = Some(now);
    true
}

fn first_matching_rule(
    rules: &[CompiledRule],
    ctx: &crate::context::AppContext,
) -> Option<CompiledRule> {
    rules
        .iter()
        .find(|rule| engine::check_conditions(&rule.conditions, ctx))
        .cloned()
}

fn fire_rule(rule: &CompiledRule, state: &DaemonStateRef) -> EventAction {
    let simulator = {
        let Ok(s) = state.read() else {
            return EventAction::PassThrough;
        };
        let Some(simulator) = s.simulator.clone() else {
            return EventAction::PassThrough;
        };
        simulator
    };
    let Some(ctx_arc) = crate::trackers::context_tracker::get_context() else {
        return EventAction::PassThrough;
    };
    engine::execute_actions(&rule.actions, &simulator, &ctx_arc, true, Some(state), 0);
    engine::execute_actions(&rule.actions, &simulator, &ctx_arc, false, Some(state), 0)
}

fn fire_move_rule(rule: &CompiledMouseMoveRule, state: &DaemonStateRef) {
    let simulator = {
        let Ok(s) = state.read() else { return; };
        let Some(simulator) = s.simulator.clone() else { return; };
        simulator
    };
    let Some(ctx_arc) = crate::trackers::context_tracker::get_context() else { return; };
    engine::execute_actions(&rule.actions, &simulator, &ctx_arc, true, Some(state), 0);
    engine::execute_actions(&rule.actions, &simulator, &ctx_arc, false, Some(state), 0);
}

/// Handles typed mouse primitives that are deliberately separate from ordinary
/// button-down/up lifecycle matching. Wheel rules may block the original wheel;
/// double-click and movement rules never swallow the underlying pointer event.
pub fn process_typed_mouse_event(
    msg_type: u32,
    button: u8,
    x: i32,
    y: i32,
    delta: i32,
    state: Option<&DaemonStateRef>,
) -> EventAction {
    use windows::Win32::UI::WindowsAndMessaging::WM_MOUSEMOVE;

    let Some(state) = state else {
        return EventAction::PassThrough;
    };

    let (enabled, wheel_rules, double_rules, move_rules) = {
        let Ok(s) = state.read() else {
            return EventAction::PassThrough;
        };
        if !s.mouse_hook_enabled {
            return EventAction::PassThrough;
        }
        let wheel_rules = wheel_key(msg_type, delta)
            .and_then(|key| s.engine_schema.mouse_wheel_map.get(&key).cloned())
            .unwrap_or_default();
        let double_rules = if button_down_message(msg_type) && (1..=5).contains(&button) {
            s.engine_schema
                .mouse_double_click_map
                .get(&button)
                .cloned()
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let move_rules = if msg_type == WM_MOUSEMOVE {
            s.engine_schema.mouse_move_rules.clone()
        } else {
            Vec::new()
        };
        (true, wheel_rules, double_rules, move_rules)
    };
    if !enabled {
        return EventAction::PassThrough;
    }

    let Some(ctx_arc) = crate::trackers::context_tracker::get_context() else {
        return EventAction::PassThrough;
    };

    if !wheel_rules.is_empty() {
        let matched = ctx_arc
            .read()
            .ok()
            .and_then(|ctx| first_matching_rule(&wheel_rules, &ctx));
        if let Some(rule) = matched {
            return fire_rule(&rule, state);
        }
    }

    if !double_rules.is_empty() && detect_double_click(button, x, y, Instant::now()) {
        let matched = ctx_arc
            .read()
            .ok()
            .and_then(|ctx| first_matching_rule(&double_rules, &ctx));
        if let Some(rule) = matched {
            let _ = fire_rule(&rule, state);
        }
        return EventAction::PassThrough;
    } else if button_down_message(msg_type) && (1..=5).contains(&button) {
        // Keep timing state even if this button currently has no double-click rule;
        // switching profiles between clicks must not require a blocking wait.
        let _ = detect_double_click(button, x, y, Instant::now());
    }

    if msg_type == WM_MOUSEMOVE && !move_rules.is_empty() {
        let now = Instant::now();
        for rule in move_rules {
            if !movement_due(&rule, x, y, now) {
                continue;
            }
            let conditions_ok = ctx_arc
                .read()
                .map(|ctx| engine::check_conditions(&rule.conditions, &ctx))
                .unwrap_or(false);
            if conditions_ok {
                fire_move_rule(&rule, state);
                break;
            }
        }
    }

    EventAction::PassThrough
}

pub fn reset_runtime_state() {
    if let Ok(mut clicks) = CLICK_STATES.lock() {
        clicks.clear();
    }
    if let Ok(mut movement) = MOVE_STATES.lock() {
        movement.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schemas::engine::CompiledMouseMoveRule;
    use windows::Win32::UI::WindowsAndMessaging::{WM_MOUSEHWHEEL, WM_MOUSEWHEEL};

    #[test]
    fn wheel_sign_and_axis_are_independent() {
        assert_eq!(wheel_key(WM_MOUSEWHEEL, 120), Some(1));
        assert_eq!(wheel_key(WM_MOUSEWHEEL, -120), Some(-1));
        assert_eq!(wheel_key(WM_MOUSEHWHEEL, 120), Some(2));
        assert_eq!(wheel_key(WM_MOUSEHWHEEL, -120), Some(-2));
        assert_eq!(wheel_key(WM_MOUSEWHEEL, 0), None);
    }

    #[test]
    fn movement_uses_distance_and_cooldown() {
        let rule = CompiledMouseMoveRule {
            rule_hash: 7,
            priority: 1,
            min_distance: 10,
            cooldown_ms: 100,
            conditions: vec![],
            actions: vec![],
        };
        reset_runtime_state();
        let now = Instant::now();
        assert!(!movement_due(&rule, 0, 0, now));
        assert!(!movement_due(&rule, 3, 4, now));
        assert!(movement_due(&rule, 10, 0, now));
        assert!(!movement_due(&rule, 20, 0, now + Duration::from_millis(50)));
        assert!(movement_due(&rule, 20, 0, now + Duration::from_millis(101)));
    }
}
'''
write('src-tauri/src/daemon/mouse_runtime.rs', mouse_runtime)

replace_once('src-tauri/src/daemon/mod.rs',
             'pub mod engine;\n',
             'pub mod engine;\npub mod mouse_runtime;\n')

replace_once('src-tauri/src/daemon/hooks.rs',
             '    let start = std::time::Instant::now();\n    let action = engine::process_mouse_event(button, x, y, delta, flags, is_mouse_down, state_ref);',
             '''    let start = std::time::Instant::now();
    let typed_action = crate::daemon::mouse_runtime::process_typed_mouse_event(
        msg_type, button, x, y, delta, state_ref,
    );
    let action = match typed_action {
        engine::EventAction::Block => engine::EventAction::Block,
        engine::EventAction::PassThrough => {
            engine::process_mouse_event(button, x, y, delta, flags, is_mouse_down, state_ref)
        }
    };''')

replace_once('src-tauri/src/daemon/hooks.rs',
             '    engine::reset_modifier_state();\n    info!("Хуки деинсталлированы");',
             '    engine::reset_modifier_state();\n    crate::daemon::mouse_runtime::reset_runtime_state();\n    info!("Хуки деинсталлированы");')

# Frontend trigger summaries and creation.
replace_once('src/pages/RulesPage.tsx',
'''    case 'mouseDown':
    case 'mouseUp':
    case 'tapHoldKeyDown':
      return vkToName(trigger.code);
    case 'typedText':
      return `“${trigger.sequence}”`;''',
'''    case 'mouseDown':
    case 'mouseUp':
    case 'mouseDoubleClick':
    case 'tapHoldKeyDown':
      return vkToName(trigger.code);
    case 'mouseWheel':
      return trigger.direction;
    case 'mouseMove':
      return `move ≥ ${trigger.minDistance}px`;
    case 'typedText':
      return `“${trigger.sequence}”`;''')
replace_once('src/pages/RulesPage.tsx',
'''    case 'mouseDown': return t('rules.trigger_mouse_down');
    case 'mouseUp': return t('rules.trigger_mouse_up');
    case 'tapHoldKeyDown': return t('rules.trigger_tap_hold');''',
'''    case 'mouseDown': return t('rules.trigger_mouse_down');
    case 'mouseUp': return t('rules.trigger_mouse_up');
    case 'mouseWheel': return t('ruleBuilder.trigger_types.mouseWheel', { defaultValue: 'Колесо мыши' });
    case 'mouseDoubleClick': return t('ruleBuilder.trigger_types.mouseDoubleClick', { defaultValue: 'Двойной клик' });
    case 'mouseMove': return t('ruleBuilder.trigger_types.mouseMove', { defaultValue: 'Движение мыши' });
    case 'tapHoldKeyDown': return t('rules.trigger_tap_hold');''')
replace_once('src/pages/RulesPage.tsx',
'''  if (type === 'mouseDown') return { ...rule, trigger: { type: 'mouseDown', code: 1 } };
  return { ...rule, trigger: { type: 'mouseUp', code: 1 } };''',
'''  if (type === 'mouseDown') return { ...rule, trigger: { type: 'mouseDown', code: 1 } };
  if (type === 'mouseUp') return { ...rule, trigger: { type: 'mouseUp', code: 1 } };
  if (type === 'mouseWheel') return { ...rule, trigger: { type: 'mouseWheel', direction: 'up' } };
  if (type === 'mouseDoubleClick') return { ...rule, trigger: { type: 'mouseDoubleClick', code: 1 } };
  return { ...rule, trigger: { type: 'mouseMove', minDistance: 24, cooldownMs: 120 } };''')
replace_once('src/pages/RulesPage.tsx',
'''                      <option value="mouseDown">{t('ruleBuilder.trigger_types.mouseDown')}</option>
                      <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                      <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>''',
'''                      <option value="mouseDown">{t('ruleBuilder.trigger_types.mouseDown')}</option>
                      <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                      <option value="mouseWheel">{t('ruleBuilder.trigger_types.mouseWheel', { defaultValue: 'Колесо мыши' })}</option>
                      <option value="mouseDoubleClick">{t('ruleBuilder.trigger_types.mouseDoubleClick', { defaultValue: 'Двойной клик' })}</option>
                      <option value="mouseMove">{t('ruleBuilder.trigger_types.mouseMove', { defaultValue: 'Движение мыши' })}</option>
                      <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>''')
replace_once('src/pages/RulesPage.tsx',
'''                    {(draftRule.trigger.type === 'mouseDown' || draftRule.trigger.type === 'mouseUp') && (
                      <select''',
'''                    {(draftRule.trigger.type === 'mouseDown' || draftRule.trigger.type === 'mouseUp' || draftRule.trigger.type === 'mouseDoubleClick') && (
                      <select''')
replace_once('src/pages/RulesPage.tsx',
'''                          trigger: {
                            type: draftRule.trigger.type === 'mouseUp' ? 'mouseUp' : 'mouseDown',
                            code: Number.parseInt(event.target.value, 10) || 1,
                          },''',
'''                          trigger: {
                            type: draftRule.trigger.type === 'mouseUp'
                              ? 'mouseUp'
                              : draftRule.trigger.type === 'mouseDoubleClick'
                                ? 'mouseDoubleClick'
                                : 'mouseDown',
                            code: Number.parseInt(event.target.value, 10) || 1,
                          },''')

needle = '''                    )}
                  </div>
                </EditorSection>'''
extra = '''                    )}

                    {draftRule.trigger.type === 'mouseWheel' && (
                      <select
                        value={draftRule.trigger.direction}
                        disabled={saving}
                        onChange={(event) => setDraftRule({
                          ...draftRule,
                          trigger: { type: 'mouseWheel', direction: event.target.value as 'up' | 'down' | 'left' | 'right' },
                        })}
                        className={`${selectClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      >
                        <option value="up">{t('ruleBuilder.mouse.wheel_up', { defaultValue: 'Колесо вверх' })}</option>
                        <option value="down">{t('ruleBuilder.mouse.wheel_down', { defaultValue: 'Колесо вниз' })}</option>
                        <option value="left">{t('ruleBuilder.mouse.wheel_left', { defaultValue: 'Горизонтально влево' })}</option>
                        <option value="right">{t('ruleBuilder.mouse.wheel_right', { defaultValue: 'Горизонтально вправо' })}</option>
                      </select>
                    )}

                    {draftRule.trigger.type === 'mouseMove' && (
                      <div className="flex flex-1 min-w-0 max-w-[520px] items-center gap-1.5">
                        <span className="text-[9px] text-app-muted">px</span>
                        <input
                          type="number"
                          min={1}
                          value={draftRule.trigger.minDistance}
                          disabled={saving}
                          onChange={(event) => setDraftRule({
                            ...draftRule,
                            trigger: {
                              ...draftRule.trigger,
                              minDistance: Math.max(1, Number.parseInt(event.target.value, 10) || 24),
                            },
                          })}
                          className={`${inputClass} w-24 font-mono disabled:opacity-50`}
                        />
                        <span className="text-[9px] text-app-muted">cooldown ms</span>
                        <input
                          type="number"
                          min={0}
                          value={draftRule.trigger.cooldownMs}
                          disabled={saving}
                          onChange={(event) => setDraftRule({
                            ...draftRule,
                            trigger: {
                              ...draftRule.trigger,
                              cooldownMs: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                            },
                          })}
                          className={`${inputClass} w-24 font-mono disabled:opacity-50`}
                        />
                      </div>
                    )}
                  </div>
                </EditorSection>'''
# Replace the first trigger-section closing occurrence after the mouse selector.
text = read('src/pages/RulesPage.tsx')
pos = text.find("{(draftRule.trigger.type === 'mouseDown'")
if pos < 0:
    raise RuntimeError('RulesPage mouse selector anchor not found')
end = text.find(needle, pos)
if end < 0:
    raise RuntimeError('RulesPage trigger section end not found')
text = text[:end] + extra + text[end + len(needle):]
write('src/pages/RulesPage.tsx', text)

# Add matching RU/EN labels while preserving existing JSON formatting/order.
def set_nested(obj, keys, value):
    cur = obj
    for key in keys[:-1]:
        cur = cur.setdefault(key, {})
    cur[keys[-1]] = value

for locale, values in {
    'ru': {
        'mouseWheel': 'Колесо мыши',
        'mouseDoubleClick': 'Двойной клик',
        'mouseMove': 'Движение мыши',
        'wheel_up': 'Колесо вверх',
        'wheel_down': 'Колесо вниз',
        'wheel_left': 'Горизонтально влево',
        'wheel_right': 'Горизонтально вправо',
    },
    'en': {
        'mouseWheel': 'Mouse wheel',
        'mouseDoubleClick': 'Double click',
        'mouseMove': 'Mouse movement',
        'wheel_up': 'Wheel up',
        'wheel_down': 'Wheel down',
        'wheel_left': 'Horizontal left',
        'wheel_right': 'Horizontal right',
    },
}.items():
    path = ROOT / f'src/i18n/locales/{locale}.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    for key in ('mouseWheel', 'mouseDoubleClick', 'mouseMove'):
        set_nested(data, ['ruleBuilder', 'trigger_types', key], values[key])
    for key in ('wheel_up', 'wheel_down', 'wheel_left', 'wheel_right'):
        set_nested(data, ['ruleBuilder', 'mouse', key], values[key])
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('0.3.1 mouse runtime patch applied')
