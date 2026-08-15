from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one marker, got {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# ActionEditor: bounded preview/stop + rare playback options under disclosure.
p = Path('src/components/ruleBuilder/ActionEditor.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace(
    "import { Crosshair, FolderOpen, Trash2 } from 'lucide-react';",
    "import { Crosshair, FolderOpen, Play, Square, Trash2 } from 'lucide-react';",
    1,
)
old = '''      {action.type === 'runMacro' && (\n        <div className="border-t border-app-border/70 p-1.5">\n          <MacroEditor\n            steps={action.steps || []}\n            onChange={(steps) => onChange({ ...action, steps })}\n          />\n        </div>\n      )}\n'''
new = '''      {action.type === 'runMacro' && (\n        <div className="border-t border-app-border/70 p-1.5">\n          <div className="mb-1.5 flex items-center justify-end gap-1">\n            <button\n              type="button"\n              disabled={action.steps.length === 0}\n              onClick={() => {\n                void invoke('ipc_call', {\n                  method: 'macro.preview',\n                  params: { steps: action.steps, playback: action.playback },\n                }).catch((error) => console.error('Macro preview failed', error));\n              }}\n              className="h-6 px-2 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface disabled:opacity-35"\n            >\n              <Play size={10} />\n              {t('macro.preview', { defaultValue: 'Тест' })}\n            </button>\n            <button\n              type="button"\n              onClick={() => {\n                void invoke('ipc_call', { method: 'macro.stop_playback' })\n                  .catch((error) => console.error('Macro stop failed', error));\n              }}\n              className="h-6 px-2 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface"\n            >\n              <Square size={9} />\n              {t('macro.stop_playback', { defaultValue: 'Стоп' })}\n            </button>\n            <details className="relative">\n              <summary className="list-none h-6 px-2 inline-flex items-center border border-app-border bg-app-bg text-[9px] text-app-muted hover:bg-app-surface cursor-pointer">\n                {t('common.advanced', { defaultValue: 'Доп.' })}\n              </summary>\n              <div className="absolute z-40 right-0 top-7 w-60 border border-app-border bg-app-bg shadow-lg p-2 space-y-2">\n                <label className="block">\n                  <span className="block mb-1 text-[9px] text-app-muted">{t('macro.playback_speed', { defaultValue: 'Скорость' })}</span>\n                  <select\n                    value={action.playback.speed}\n                    onChange={(event) => onChange({\n                      ...action,\n                      playback: { ...action.playback, speed: Number.parseFloat(event.target.value) || 1 },\n                    })}\n                    className={`${selectClass} w-full`}\n                  >\n                    <option value="0.5">0.5×</option>\n                    <option value="0.75">0.75×</option>\n                    <option value="1">1×</option>\n                    <option value="1.25">1.25×</option>\n                    <option value="1.5">1.5×</option>\n                    <option value="2">2×</option>\n                    <option value="3">3×</option>\n                    <option value="5">5×</option>\n                  </select>\n                </label>\n                <label className="block">\n                  <span className="block mb-1 text-[9px] text-app-muted">{t('macro.repeat_count', { defaultValue: 'Повторов' })}</span>\n                  <input\n                    type="number"\n                    min={1}\n                    max={10000}\n                    value={action.playback.repeatCount}\n                    disabled={action.playback.repeatWhileHeld}\n                    onChange={(event) => onChange({\n                      ...action,\n                      playback: {\n                        ...action.playback,\n                        repeatCount: Math.max(1, Math.min(10000, Number.parseInt(event.target.value, 10) || 1)),\n                      },\n                    })}\n                    className={`${controlClass} w-full font-mono disabled:opacity-40`}\n                  />\n                </label>\n                <label className="flex items-center gap-2 text-[10px] text-app-text cursor-pointer">\n                  <input\n                    type="checkbox"\n                    checked={action.playback.repeatWhileHeld}\n                    onChange={(event) => onChange({\n                      ...action,\n                      playback: { ...action.playback, repeatWhileHeld: event.target.checked },\n                    })}\n                  />\n                  {t('macro.repeat_while_held', { defaultValue: 'Повторять, пока удерживается триггер' })}\n                </label>\n              </div>\n            </details>\n          </div>\n          <MacroEditor\n            steps={action.steps || []}\n            onChange={(steps) => onChange({ ...action, steps })}\n          />\n        </div>\n      )}\n'''
if old not in s:
    raise RuntimeError('ActionEditor macro body marker not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')

# MacroEditor: native drag/drop with existing arrow buttons retained.
p = Path('src/components/ruleBuilder/MacroEditor.tsx')
s = p.read_text(encoding='utf-8')
old = '''          return (\n            <div key={index} className="flex items-center gap-1 border border-app-border bg-app-bg p-1">\n'''
new = '''          return (\n            <div\n              key={index}\n              draggable={!isRecording}\n              onDragStart={(event) => {\n                event.dataTransfer.effectAllowed = 'move';\n                event.dataTransfer.setData('text/plain', String(index));\n              }}\n              onDragOver={(event) => {\n                if (!isRecording) {\n                  event.preventDefault();\n                  event.dataTransfer.dropEffect = 'move';\n                }\n              }}\n              onDrop={(event) => {\n                if (isRecording) return;\n                event.preventDefault();\n                const from = Number.parseInt(event.dataTransfer.getData('text/plain'), 10);\n                if (Number.isInteger(from) && from !== index) moveStep(from, index);\n              }}\n              className={`flex items-center gap-1 border border-app-border bg-app-bg p-1 ${isRecording ? '' : 'cursor-move'}`}\n              title={isRecording ? undefined : t('macro.drag_reorder', { defaultValue: 'Перетащите для изменения порядка' })}\n            >\n'''
if old not in s:
    raise RuntimeError('MacroEditor step row marker not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')

# Settings: emergency key stays hidden in a collapsed advanced block.
p = Path('src/pages/SettingsPage.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace(
    "import { triggerToast } from '../lib/toast';\n",
    "import { triggerToast } from '../lib/toast';\nimport { KeyPicker } from '../components/ruleBuilder/KeyPicker';\n",
    1,
)
marker = '''              <Section title={t('settings.language')}>\n'''
advanced = '''              <details className="border border-app-border bg-app-bg">\n                <summary className="h-8 px-3 flex items-center cursor-pointer select-none bg-app-surface/35 text-[11px] font-semibold text-app-text">\n                  {t('settings.advanced', { defaultValue: 'Расширенные настройки' })}\n                  <span className="ml-auto text-[9px] font-normal text-app-muted">{t('common.advanced', { defaultValue: 'Доп.' })}</span>\n                </summary>\n                <div className="border-t border-app-border">\n                  <SettingRow\n                    title={t('settings.macro_emergency_stop', { defaultValue: 'Аварийный стоп макросов' })}\n                    description={t('settings.macro_emergency_stop_desc', { defaultValue: 'Останавливает текущий и все ожидающие макросы. По умолчанию Pause.' })}\n                  >\n                    <KeyPicker\n                      value={{ code: config.macroEmergencyStopVk ?? 0x13, modifiers: 0 }}\n                      allowModifiers={false}\n                      onChange={(chord) => setConfig({ macroEmergencyStopVk: chord.code })}\n                      className="w-full text-left"\n                    />\n                  </SettingRow>\n                </div>\n              </details>\n\n              <Section title={t('settings.language')}>\n'''
if marker not in s:
    raise RuntimeError('Settings language section marker not found')
p.write_text(s.replace(marker, advanced, 1), encoding='utf-8')

# Localized labels, including the horizontal macro wheel added earlier.
for lang, values in {
    'ru': {
        'macro': {
            'preview': 'Тест',
            'stop_playback': 'Стоп',
            'playback_speed': 'Скорость',
            'repeat_count': 'Повторов',
            'repeat_while_held': 'Повторять, пока удерживается триггер',
            'drag_reorder': 'Перетащите для изменения порядка',
        },
        'settings': {
            'advanced': 'Расширенные настройки',
            'macro_emergency_stop': 'Аварийный стоп макросов',
            'macro_emergency_stop_desc': 'Останавливает текущий и все ожидающие макросы. По умолчанию Pause.',
        },
    },
    'en': {
        'macro': {
            'preview': 'Test',
            'stop_playback': 'Stop',
            'playback_speed': 'Speed',
            'repeat_count': 'Repeats',
            'repeat_while_held': 'Repeat while trigger is held',
            'drag_reorder': 'Drag to reorder',
        },
        'settings': {
            'advanced': 'Advanced settings',
            'macro_emergency_stop': 'Macro emergency stop',
            'macro_emergency_stop_desc': 'Stops the running macro and queued macros. Pause by default.',
        },
    },
}.items():
    path = Path(f'src/i18n/locales/{lang}.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    data.setdefault('macro', {}).update(values['macro'])
    data.setdefault('settings', {}).update(values['settings'])
    data.setdefault('macro', {}).setdefault('step_types', {})['mouseHScroll'] = 'Гориз. колесо' if lang == 'ru' else 'Horizontal wheel'
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('compact macro UI staged')
