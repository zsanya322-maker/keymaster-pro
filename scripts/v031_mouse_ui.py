from pathlib import Path
import json

p = Path('src/pages/RulesPage.tsx')
s = p.read_text(encoding='utf-8')

old = '''    case 'mouseDown':
    case 'mouseUp':
    case 'tapHoldKeyDown':
      return vkToName(trigger.code);
    case 'typedText':
      return `“${trigger.sequence}”`;
'''
new = '''    case 'mouseDown':
    case 'mouseUp':
    case 'tapHoldKeyDown':
      return vkToName(trigger.code);
    case 'mouseWheel': {
      const arrow = { up: '↑', down: '↓', left: '←', right: '→' }[trigger.direction];
      return `Wheel ${arrow}`;
    }
    case 'mouseDoubleClick':
      return `2× ${vkToName(trigger.code)}`;
    case 'mouseMove':
      return 'Mouse move';
    case 'typedText':
      return `“${trigger.sequence}”`;
'''
if old not in s:
    raise SystemExit('formatTriggerKey marker not found')
s = s.replace(old, new, 1)

old = '''    case 'mouseDown': return t('rules.trigger_mouse_down');
    case 'mouseUp': return t('rules.trigger_mouse_up');
    case 'tapHoldKeyDown': return t('rules.trigger_tap_hold');
'''
new = '''    case 'mouseDown': return t('rules.trigger_mouse_down');
    case 'mouseUp': return t('rules.trigger_mouse_up');
    case 'mouseWheel': return t('ruleBuilder.trigger_types.mouseWheel');
    case 'mouseDoubleClick': return t('ruleBuilder.trigger_types.mouseDoubleClick');
    case 'mouseMove': return t('ruleBuilder.trigger_types.mouseMove');
    case 'tapHoldKeyDown': return t('rules.trigger_tap_hold');
'''
if old not in s:
    raise SystemExit('formatTriggerType marker not found')
s = s.replace(old, new, 1)

old = '''  if (type === 'mouseDown') return { ...rule, trigger: { type: 'mouseDown', code: 1 } };
  return { ...rule, trigger: { type: 'mouseUp', code: 1 } };
'''
new = '''  if (type === 'mouseDown') return { ...rule, trigger: { type: 'mouseDown', code: 1 } };
  if (type === 'mouseUp') return { ...rule, trigger: { type: 'mouseUp', code: 1 } };
  if (type === 'mouseWheel') return { ...rule, trigger: { type: 'mouseWheel', direction: 'up' } };
  if (type === 'mouseDoubleClick') return { ...rule, trigger: { type: 'mouseDoubleClick', code: 1 } };
  return { ...rule, trigger: { type: 'mouseMove', minDistance: 24, cooldownMs: 120 } };
'''
if old not in s:
    raise SystemExit('changeTriggerType marker not found')
s = s.replace(old, new, 1)

old = '''                      <option value="mouseDown">{t('ruleBuilder.trigger_types.mouseDown')}</option>
                      <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                      <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>
'''
new = '''                      <option value="mouseDown">{t('ruleBuilder.trigger_types.mouseDown')}</option>
                      <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                      <option value="mouseWheel">{t('ruleBuilder.trigger_types.mouseWheel')}</option>
                      <option value="mouseDoubleClick">{t('ruleBuilder.trigger_types.mouseDoubleClick')}</option>
                      <option value="mouseMove">{t('ruleBuilder.trigger_types.mouseMove')}</option>
                      <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>
'''
if old not in s:
    raise SystemExit('trigger dropdown marker not found')
s = s.replace(old, new, 1)

old = '''                    {(draftRule.trigger.type === 'mouseDown' || draftRule.trigger.type === 'mouseUp') && (
                      <select
                        value={draftRule.trigger.code}
                        disabled={saving}
                        onChange={(event) => setDraftRule({
                          ...draftRule,
                          trigger: {
                            type: draftRule.trigger.type === 'mouseUp' ? 'mouseUp' : 'mouseDown',
                            code: Number.parseInt(event.target.value, 10) || 1,
                          },
                        })}
                        className={`${selectClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      >
                        <option value="1">{t('ruleBuilder.action_options.mouse_left')}</option>
                        <option value="2">{t('ruleBuilder.action_options.mouse_right')}</option>
                        <option value="3">{t('ruleBuilder.action_options.mouse_middle')}</option>
                        <option value="4">{t('ruleBuilder.action_options.mouse_x1')}</option>
                        <option value="5">{t('ruleBuilder.action_options.mouse_x2')}</option>
                      </select>
                    )}
'''
new = '''                    {(draftRule.trigger.type === 'mouseDown' || draftRule.trigger.type === 'mouseUp' || draftRule.trigger.type === 'mouseDoubleClick') && (
                      <select
                        value={draftRule.trigger.code}
                        disabled={saving}
                        onChange={(event) => {
                          const code = Number.parseInt(event.target.value, 10) || 1;
                          const type = draftRule.trigger.type;
                          setDraftRule({
                            ...draftRule,
                            trigger: type === 'mouseUp'
                              ? { type: 'mouseUp', code }
                              : type === 'mouseDoubleClick'
                                ? { type: 'mouseDoubleClick', code }
                                : { type: 'mouseDown', code },
                          });
                        }}
                        className={`${selectClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      >
                        <option value="1">{t('ruleBuilder.action_options.mouse_left')}</option>
                        <option value="2">{t('ruleBuilder.action_options.mouse_right')}</option>
                        <option value="3">{t('ruleBuilder.action_options.mouse_middle')}</option>
                        <option value="4">{t('ruleBuilder.action_options.mouse_x1')}</option>
                        <option value="5">{t('ruleBuilder.action_options.mouse_x2')}</option>
                      </select>
                    )}

                    {draftRule.trigger.type === 'mouseWheel' && (
                      <select
                        value={draftRule.trigger.direction}
                        disabled={saving}
                        onChange={(event) => setDraftRule({
                          ...draftRule,
                          trigger: {
                            type: 'mouseWheel',
                            direction: event.target.value as 'up' | 'down' | 'left' | 'right',
                          },
                        })}
                        className={`${selectClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      >
                        <option value="up">{t('ruleBuilder.mouse_options.wheel_up')}</option>
                        <option value="down">{t('ruleBuilder.mouse_options.wheel_down')}</option>
                        <option value="left">{t('ruleBuilder.mouse_options.wheel_left')}</option>
                        <option value="right">{t('ruleBuilder.mouse_options.wheel_right')}</option>
                      </select>
                    )}

                    {draftRule.trigger.type === 'mouseMove' && (
                      <>
                        <div className="h-7 flex-1 min-w-0 max-w-[420px] px-2 inline-flex items-center border border-app-border bg-app-surface/20 text-[10px] text-app-muted">
                          {t('ruleBuilder.mouse_options.move_hint')}
                        </div>
                        <details className="relative shrink-0">
                          <summary className="list-none h-7 px-2 inline-flex items-center border border-app-border bg-app-bg text-[9px] text-app-muted hover:bg-app-surface cursor-pointer">
                            {t('common.advanced', { defaultValue: 'Доп.' })}
                          </summary>
                          <div className="absolute z-30 right-0 top-8 w-52 border border-app-border bg-app-bg shadow-lg p-2 space-y-2">
                            <label className="block">
                              <span className="block mb-1 text-[9px] text-app-muted">{t('ruleBuilder.mouse_options.move_distance')}</span>
                              <input
                                type="number"
                                min={1}
                                max={2000}
                                value={draftRule.trigger.minDistance}
                                disabled={saving}
                                onChange={(event) => {
                                  const minDistance = Math.max(1, Number.parseInt(event.target.value, 10) || 24);
                                  setDraftRule((current) => current?.trigger.type === 'mouseMove'
                                    ? { ...current, trigger: { ...current.trigger, minDistance } }
                                    : current);
                                }}
                                className={`${inputClass} w-full font-mono disabled:opacity-50`}
                              />
                            </label>
                            <label className="block">
                              <span className="block mb-1 text-[9px] text-app-muted">{t('ruleBuilder.mouse_options.move_cooldown')}</span>
                              <input
                                type="number"
                                min={0}
                                max={60000}
                                value={draftRule.trigger.cooldownMs}
                                disabled={saving}
                                onChange={(event) => {
                                  const cooldownMs = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
                                  setDraftRule((current) => current?.trigger.type === 'mouseMove'
                                    ? { ...current, trigger: { ...current.trigger, cooldownMs } }
                                    : current);
                                }}
                                className={`${inputClass} w-full font-mono disabled:opacity-50`}
                              />
                            </label>
                          </div>
                        </details>
                      </>
                    )}
'''
if old not in s:
    raise SystemExit('mouse editor block marker not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

translations = {
    'ru': {
        'trigger_types': {
            'mouseWheel': 'Колесо мыши',
            'mouseDoubleClick': 'Двойной клик',
            'mouseMove': 'Движение мыши',
        },
        'mouse_options': {
            'wheel_up': 'Колесо вверх',
            'wheel_down': 'Колесо вниз',
            'wheel_left': 'Горизонтально влево',
            'wheel_right': 'Горизонтально вправо',
            'move_hint': 'Срабатывает при заметном движении указателя',
            'move_distance': 'Порог движения, px',
            'move_cooldown': 'Пауза между срабатываниями, мс',
        },
    },
    'en': {
        'trigger_types': {
            'mouseWheel': 'Mouse wheel',
            'mouseDoubleClick': 'Double click',
            'mouseMove': 'Mouse movement',
        },
        'mouse_options': {
            'wheel_up': 'Wheel up',
            'wheel_down': 'Wheel down',
            'wheel_left': 'Horizontal left',
            'wheel_right': 'Horizontal right',
            'move_hint': 'Triggers after meaningful pointer movement',
            'move_distance': 'Movement threshold, px',
            'move_cooldown': 'Trigger cooldown, ms',
        },
    },
}
for lang, additions in translations.items():
    path = Path(f'src/i18n/locales/{lang}.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    rb = data['ruleBuilder']
    rb['trigger_types'].update(additions['trigger_types'])
    rb['mouse_options'] = additions['mouse_options']
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
