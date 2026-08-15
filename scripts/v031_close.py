from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, text): (ROOT / path).write_text(text, encoding='utf-8')
def rep(path, old, new):
    text = read(path)
    if old not in text:
        raise RuntimeError(f'{path}: anchor not found: {old[:100]!r}')
    write(path, text.replace(old, new, 1))

def set_nested(obj, keys, value):
    cur = obj
    for key in keys[:-1]: cur = cur.setdefault(key, {})
    cur[keys[-1]] = value

# windows 0.62 exports GetDoubleClickTime from KeyboardAndMouse.
text = read('src-tauri/src/daemon/mouse_triggers.rs')
old = '''    use windows::Win32::UI::WindowsAndMessaging::{
        GetDoubleClickTime, GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK,
    };'''
if old in text:
    text = text.replace(old, '''    use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK,
    };''', 1)
    write('src-tauri/src/daemon/mouse_triggers.rs', text)

# GUI export/import schema marker follows persistence v3.
text = read('src/app/App.tsx')
text = text.replace('const PROFILE_SCHEMA_VERSION = 1', 'const PROFILE_SCHEMA_VERSION = 3', 1)
write('src/app/App.tsx', text)

# Browser/offline fallback must mirror Rust's default emergency key (Pause).
text = read('src/store/appStore.ts')
if 'macroEmergencyStopVk:' not in text:
    text = text.replace('  restoreMouseAfterMacro: true,\n', '  restoreMouseAfterMacro: true,\n  macroEmergencyStopVk: 0x13,\n', 1)
    write('src/store/appStore.ts', text)

# Compact playback controls live with the macro editor wrapper; production preview uses existing IPC.
path = 'src/components/ruleBuilder/ActionEditor.tsx'
text = read(path)
text = text.replace("import { Crosshair, FolderOpen, Trash2 } from 'lucide-react';", "import { Crosshair, FolderOpen, Play, Square, Trash2 } from 'lucide-react';", 1)
old_block = '''      {action.type === 'runMacro' && (
        <div className="border-t border-app-border/70 p-1.5">
          <MacroEditor
            steps={action.steps || []}
            onChange={(steps) => onChange({ ...action, steps })}
          />
        </div>
      )}'''
if old_block in text:
    new_block = '''      {action.type === 'runMacro' && (
        <div className="border-t border-app-border/70 p-1.5 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 border border-app-border bg-app-surface/20 p-1.5 text-[10px]">
            <span className="text-app-muted">{t('macro.playback_speed')}</span>
            <input
              type="number" min={0.1} max={10} step={0.1}
              value={action.playback?.speed ?? 1}
              onChange={(event) => onChange({ ...action, playback: { ...(action.playback ?? { speed: 1, repeatCount: 1, repeatWhileHeld: false }), speed: Math.max(0.1, Math.min(10, Number(event.target.value) || 1)) } })}
              className={`${controlClass} w-16 font-mono`}
            />
            <span className="text-app-muted">{t('macro.repeat_count')}</span>
            <input
              type="number" min={1} max={10000}
              disabled={Boolean(action.playback?.repeatWhileHeld)}
              value={action.playback?.repeatCount ?? 1}
              onChange={(event) => onChange({ ...action, playback: { ...(action.playback ?? { speed: 1, repeatCount: 1, repeatWhileHeld: false }), repeatCount: Math.max(1, Math.min(10000, Number.parseInt(event.target.value, 10) || 1)) } })}
              className={`${controlClass} w-20 font-mono disabled:opacity-45`}
            />
            <label className="inline-flex items-center gap-1 text-app-muted select-none">
              <input
                type="checkbox"
                checked={Boolean(action.playback?.repeatWhileHeld)}
                onChange={(event) => onChange({ ...action, playback: { ...(action.playback ?? { speed: 1, repeatCount: 1, repeatWhileHeld: false }), repeatWhileHeld: event.target.checked } })}
              />
              {t('macro.repeat_while_held')}
            </label>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => void invoke('ipc_call', { method: 'macro.preview', params: { steps: action.steps, playback: action.playback ?? { speed: 1, repeatCount: 1, repeatWhileHeld: false } } })}
                className="h-6 px-2 inline-flex items-center gap-1 border border-app-border hover:bg-app-surface"
              ><Play size={10} />{t('macro.preview')}</button>
              <button
                type="button"
                onClick={() => void invoke('ipc_call', { method: 'macro.stop_playback' })}
                className="h-6 px-2 inline-flex items-center gap-1 border border-app-border hover:bg-app-surface"
              ><Square size={10} />{t('macro.stop_playback')}</button>
            </div>
          </div>
          <MacroEditor steps={action.steps || []} onChange={(steps) => onChange({ ...action, steps })} />
        </div>
      )}'''
    text = text.replace(old_block, new_block, 1)
write(path, text)

# Native drag/drop reordering; arrow buttons remain as accessible fallback.
path = 'src/components/ruleBuilder/MacroEditor.tsx'
text = read(path)
if 'const [dragIndex, setDragIndex]' not in text:
    text = text.replace('  const [recordMouseDragDropOnly, setRecordMouseDragDropOnly] = useState(true);', '  const [recordMouseDragDropOnly, setRecordMouseDragDropOnly] = useState(true);\n  const [dragIndex, setDragIndex] = useState<number | null>(null);', 1)
    old_row = '''            <div
              key={index}
              className="min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20"
            >'''
    new_row = '''            <div
              key={index}
              draggable={!isRecording}
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex === null || dragIndex === index) return;
                const next = [...steps];
                const [moving] = next.splice(dragIndex, 1);
                next.splice(index, 0, moving);
                onChange(next);
                setDragIndex(null);
              }}
              className={`min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20 ${dragIndex === index ? 'opacity-50' : ''}`}
            >'''
    if old_row not in text: raise RuntimeError('MacroEditor row anchor not found')
    text = text.replace(old_row, new_row, 1)
write(path, text)

# Configurable emergency stop is visible in Settings and persists via existing app store.
path = 'src/pages/SettingsPage.tsx'
text = read(path)
if "../components/ruleBuilder/KeyPicker" not in text:
    text = text.replace("import { triggerToast } from '../lib/toast';", "import { triggerToast } from '../lib/toast';\nimport { KeyPicker } from '../components/ruleBuilder/KeyPicker';", 1)
anchor = '''                <SettingRow title={t('settings.restore_mouse')} description={t('settings.restore_mouse_desc')}>
                  <div className="flex justify-end"><Toggle checked={Boolean(config.restoreMouseAfterMacro)} onChange={() => void handleToggle('restoreMouseAfterMacro')} /></div>
                </SettingRow>'''
if 'settings.macro_emergency_stop' not in text:
    text = text.replace(anchor, anchor + '''
                <SettingRow title={t('settings.macro_emergency_stop')} description={t('settings.macro_emergency_stop_desc')}>
                  <KeyPicker
                    value={{ code: config.macroEmergencyStopVk ?? 0x13, modifiers: 0 }}
                    allowModifiers={false}
                    onChange={(chord) => setConfig({ macroEmergencyStopVk: chord.code || 0x13 })}
                    className="w-full"
                  />
                </SettingRow>''', 1)
write(path, text)

# Locales remain strictly paired.
values = {
  'ru': {'playback_speed':'Скорость','repeat_count':'Повторы','repeat_while_held':'Пока удерживается','preview':'Тест','stop_playback':'Стоп','macro_emergency_stop':'Аварийная остановка макросов','macro_emergency_stop_desc':'Нажатие этой клавиши немедленно отменяет текущий и все ожидающие макросы.'},
  'en': {'playback_speed':'Speed','repeat_count':'Repeats','repeat_while_held':'While held','preview':'Test','stop_playback':'Stop','macro_emergency_stop':'Macro emergency stop','macro_emergency_stop_desc':'Pressing this key immediately cancels the current and all queued macros.'},
}
for locale, v in values.items():
    p = ROOT / f'src/i18n/locales/{locale}.json'
    data = json.loads(p.read_text(encoding='utf-8'))
    for key in ('playback_speed','repeat_count','repeat_while_held','preview','stop_playback'):
        set_nested(data, ['macro', key], v[key])
    for key in ('macro_emergency_stop','macro_emergency_stop_desc'):
        set_nested(data, ['settings', key], v[key])
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Version sources for packaged checkpoint.
for path in ('package.json', 'src-tauri/tauri.conf.json'):
    text = read(path).replace('"version": "0.3.0"', '"version": "0.3.1"', 1)
    write(path, text)
text = read('src-tauri/Cargo.toml').replace('version = "0.3.0"', 'version = "0.3.1"', 1)
write('src-tauri/Cargo.toml', text)

print('v0.3.1 current-head close patch applied')
