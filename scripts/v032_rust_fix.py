from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, text): (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected one match, got {text.count(old)}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))

# GetMonitorInfoW / MONITORINFO are WinUser APIs => UI::WindowsAndMessaging in windows-rs.
path = 'src-tauri/src/trackers/context_tracker.rs'
text = read(path)
text = text.replace(
    ' use windows::Win32::Graphics::Gdi::{GetMonitorInfoW,MonitorFromWindow,MONITORINFO,MONITOR_DEFAULTTONEAREST};',
    ' use windows::Win32::UI::WindowsAndMessaging::{GetMonitorInfoW,MonitorFromWindow,MONITORINFO,MONITOR_DEFAULTTONEAREST};',
    1,
)
# Remove duplicate WindowsAndMessaging import by merging symbols into one import.
text = text.replace(
    ' use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW,GetClassNameW,GetForegroundWindow,GetMessageW,GetWindowRect,GetWindowTextW,GetWindowThreadProcessId,MSG,RECT,TranslateMessage};',
    ' use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW,GetClassNameW,GetForegroundWindow,GetMessageW,GetWindowRect,GetWindowTextW,GetWindowThreadProcessId,MSG,RECT,TranslateMessage,GetMonitorInfoW,MonitorFromWindow,MONITORINFO,MONITOR_DEFAULTTONEAREST};',
    1,
)
# If the first replacement created a second import, remove it.
text = text.replace(' use windows::Win32::UI::WindowsAndMessaging::{GetMonitorInfoW,MonitorFromWindow,MONITORINFO,MONITOR_DEFAULTTONEAREST};\n', '', 1)
# HWND is pointer-backed in windows 0.62.
text = text.replace('if hwnd.0!=0{refresh(hwnd)}', 'if !hwnd.0.is_null(){refresh(hwnd)}', 1)
# Avoid mutable-static reference warnings: hook lifetime is local to tracker thread.
text = text.replace(' static mut HOOK:Option<HWINEVENTHOOK>=None;\n', '')
old_run = ' pub fn run(){unsafe{let _=CoInitializeEx(None,COINIT_APARTMENTTHREADED);refresh(GetForegroundWindow());HOOK=SetWinEventHook(EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_FOREGROUND,None,Some(cb),0,0,WINEVENT_OUTOFCONTEXT);let mut msg=MSG::default();while GetMessageW(&mut msg,None,0,0).as_bool(){let _=TranslateMessage(&msg);DispatchMessageW(&msg);}if let Some(h)=HOOK.take(){let _=UnhookWinEvent(h);}CoUninitialize();}}'
new_run = ' pub fn run(){unsafe{let _=CoInitializeEx(None,COINIT_APARTMENTTHREADED);refresh(GetForegroundWindow());let hook=SetWinEventHook(EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_FOREGROUND,None,Some(cb),0,0,WINEVENT_OUTOFCONTEXT);let mut msg=MSG::default();while GetMessageW(&mut msg,None,0,0).as_bool(){let _=TranslateMessage(&msg);DispatchMessageW(&msg);}if let Some(h)=hook{let _=UnhookWinEvent(h);}CoUninitialize();}}'
if old_run in text:
    text = text.replace(old_run, new_run, 1)
# Clean unused imports introduced by the generated compact module.
text = text.replace('use tracing::{debug,error,info};', 'use tracing::info;', 1)
text = text.replace(' use windows::core::{GUID,HSTRING};', ' use windows::core::GUID;', 1)
text = text.replace(' use windows::Win32::Foundation::{CloseHandle,HWND,LPARAM,WPARAM};', ' use windows::Win32::Foundation::{CloseHandle,HWND};', 1)
write(path, text)

# Fully qualify compile_schema; avoids any generated-scope ambiguity.
path = 'src-tauri/src/daemon/profile_runtime.rs'
text = read(path)
text = text.replace('use crate::daemon::compiler::compile_schema;\n', '')
text = text.replace('let schema=compile_schema(&FrontendConfig', 'let schema=crate::daemon::compiler::compile_schema(&FrontendConfig', 1)
write(path, text)

# Add new Profile fields to every explicit Rust initializer that still predates schema v4.
def patch_profile_initializers(path: Path):
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines(True)
    out = []
    in_profile = False
    depth = 0
    block = []

    def flush(profile_block):
        joined = ''.join(profile_block)
        if 'linked_apps:' in joined and 'bindings:' not in joined:
            result = []
            for line in profile_block:
                result.append(line)
                if 'linked_apps:' in line:
                    indent = line[:len(line)-len(line.lstrip())]
                    result.append(f'{indent}bindings: vec![],\n')
                    result.append(f'{indent}order: 0,\n')
            return result
        return profile_block

    for line in lines:
        if not in_profile and 'Profile {' in line and not line.lstrip().startswith('pub struct Profile'):
            in_profile = True
            depth = line.count('{') - line.count('}')
            block = [line]
            if depth <= 0:
                out.extend(flush(block)); in_profile = False; block = []
            continue
        if in_profile:
            block.append(line)
            depth += line.count('{') - line.count('}')
            if depth <= 0:
                out.extend(flush(block)); in_profile = False; block = []
            continue
        out.append(line)
    if block:
        out.extend(flush(block))
    path.write_text(''.join(out), encoding='utf-8')

for root in (ROOT / 'src-tauri' / 'src', ROOT / 'src-tauri' / 'tests'):
    if root.exists():
        for file in root.rglob('*.rs'):
            patch_profile_initializers(file)

# Same treatment for explicit AppConfig initializers if they exist outside Default.
def patch_app_config_initializers(path: Path):
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines(True)
    out=[]; active=False; depth=0; block=[]
    def flush(b):
        joined=''.join(b)
        if 'restore_mouse_after_macro:' in joined and 'auto_switch_profiles:' not in joined and 'impl Default for AppConfig' not in joined:
            r=[]
            for line in b:
                r.append(line)
                if 'macro_emergency_stop_vk:' in line:
                    indent=line[:len(line)-len(line.lstrip())]
                    r.append(f'{indent}auto_switch_profiles: false,\n')
                    r.append(f'{indent}manual_profile_lock: false,\n')
            return r
        return b
    for line in lines:
        if not active and 'AppConfig {' in line and not line.lstrip().startswith('pub struct AppConfig') and not line.lstrip().startswith('impl Default'):
            active=True; depth=line.count('{')-line.count('}'); block=[line]; continue
        if active:
            block.append(line); depth+=line.count('{')-line.count('}')
            if depth<=0: out.extend(flush(block)); active=False; block=[]
            continue
        out.append(line)
    if block: out.extend(flush(block))
    path.write_text(''.join(out),encoding='utf-8')

for root in (ROOT / 'src-tauri' / 'src', ROOT / 'src-tauri' / 'tests'):
    if root.exists():
        for file in root.rglob('*.rs'):
            patch_app_config_initializers(file)

print('v0.3.2 Rust fixes applied')
