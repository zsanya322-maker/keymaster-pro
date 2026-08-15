from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected exactly one match, got {text.count(old)}: {old!r}')
    write(path, text.replace(old, new, 1))

# windows 0.62 metadata places GetDoubleClickTime in KeyboardAndMouse.
replace_once(
    'src-tauri/src/daemon/mouse_triggers.rs',
    '''    use windows::Win32::UI::WindowsAndMessaging::{
        GetDoubleClickTime, GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK,
    };''',
    '''    use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK,
    };''',
)

# calculate_hash<T>(&T) needs a sized T; use &&str rather than T=str.
replace_once(
    'src-tauri/src/daemon/router.rs',
    'crate::shared::calculate_hash("macro-preview")',
    'crate::shared::calculate_hash(&"macro-preview")',
)

# The emergency-stop key is a runtime setting, so config sync must update it live.
replace_once(
    'src-tauri/src/daemon/runner.rs',
    '''                let changed = s.kb_hook_enabled != updated.kb_hook_enabled
                    || s.mouse_hook_enabled != updated.mouse_hook_enabled
                    || s.restore_mouse_after_macro != updated.restore_mouse_after_macro;''',
    '''                let changed = s.kb_hook_enabled != updated.kb_hook_enabled
                    || s.mouse_hook_enabled != updated.mouse_hook_enabled
                    || s.restore_mouse_after_macro != updated.restore_mouse_after_macro
                    || s.macro_emergency_stop_vk != updated.macro_emergency_stop_vk;''',
)
replace_once(
    'src-tauri/src/daemon/runner.rs',
    '''                s.kb_hook_enabled = updated.kb_hook_enabled;
                s.mouse_hook_enabled = updated.mouse_hook_enabled;
                s.restore_mouse_after_macro = updated.restore_mouse_after_macro;''',
    '''                s.kb_hook_enabled = updated.kb_hook_enabled;
                s.mouse_hook_enabled = updated.mouse_hook_enabled;
                s.restore_mouse_after_macro = updated.restore_mouse_after_macro;
                s.macro_emergency_stop_vk = updated.macro_emergency_stop_vk;''',
)
replace_once(
    'src-tauri/src/daemon/runner.rs',
    '''                        "Runtime config applied: keyboard={}, mouse={}, restore_mouse_after_macro={}",
                        s.kb_hook_enabled,
                        s.mouse_hook_enabled,
                        s.restore_mouse_after_macro''',
    '''                        "Runtime config applied: keyboard={}, mouse={}, restore_mouse_after_macro={}, macro_emergency_stop_vk={}",
                        s.kb_hook_enabled,
                        s.mouse_hook_enabled,
                        s.restore_mouse_after_macro,
                        s.macro_emergency_stop_vk''',
)

# GUI import/export schema marker must match Rust persistence schema v3.
replace_once('src/app/App.tsx', 'const PROFILE_SCHEMA_VERSION = 1', 'const PROFILE_SCHEMA_VERSION = 3')

# Keep browser/offline fallback in sync with Rust default (VK_PAUSE = 0x13).
app_store = read('src/store/appStore.ts')
if 'macroEmergencyStopVk:' not in app_store:
    app_store = app_store.replace(
        '  restoreMouseAfterMacro: true,\n',
        '  restoreMouseAfterMacro: true,\n  macroEmergencyStopVk: 0x13,\n',
        1,
    )
    write('src/store/appStore.ts', app_store)

print('v0.3.1 compile/live-config fixes applied')
