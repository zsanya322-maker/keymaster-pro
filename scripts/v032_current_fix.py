from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


# v0.3.1 mouse API ownership in windows 0.62.
p = "src-tauri/src/daemon/mouse_triggers.rs"
s = read(p)
s = s.replace(
    "use windows::Win32::UI::WindowsAndMessaging::{\n        GetDoubleClickTime, GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK,\n    };",
    "use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;\n    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK};",
)
write(p, s)

# The historical rich-context staging predates the monotonic revision field that
# exists on the current branch. Preserve it after the staging script rewrites
# context.rs so auto-switch can react only to real foreground-context changes.
p = "src-tauri/src/context.rs"
s = read(p)
if "pub revision: u64," not in s:
    anchor = "pub struct AppContext {\n"
    if anchor not in s:
        raise SystemExit("AppContext struct anchor missing")
    s = s.replace(
        anchor,
        anchor + "    /// Monotonic foreground-context revision. Layer changes do not increment it.\n    pub revision: u64,\n",
        1,
    )
write(p, s)

# Correct windows-rs 0.62 module ownership in the recovered rich tracker.
p = "src-tauri/src/trackers/context_tracker.rs"
s = read(p)
s = s.replace(
    "use windows::Win32::Foundation::{CloseHandle,HWND};",
    "use windows::Win32::Foundation::{CloseHandle,HWND,RECT};",
)
s = s.replace(
    "use windows::Win32::UI::Accessibility::{SetWinEventHook,UnhookWinEvent,HWINEVENTHOOK,EVENT_SYSTEM_FOREGROUND,WINEVENT_OUTOFCONTEXT};",
    "use windows::Win32::UI::Accessibility::{SetWinEventHook,UnhookWinEvent,HWINEVENTHOOK};",
)
s = s.replace(
    "use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW,GetClassNameW,GetForegroundWindow,GetMessageW,GetWindowRect,GetWindowTextW,GetWindowThreadProcessId,MSG,RECT,TranslateMessage,GetMonitorInfoW,MonitorFromWindow,MONITORINFO,MONITOR_DEFAULTTONEAREST};",
    "use windows::Win32::Graphics::Gdi::{GetMonitorInfoW,MonitorFromWindow,MONITORINFO,MONITOR_DEFAULTTONEAREST};\n use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW,GetClassNameW,GetForegroundWindow,GetMessageW,GetWindowRect,GetWindowTextW,GetWindowThreadProcessId,MSG,TranslateMessage,EVENT_SYSTEM_FOREGROUND,WINEVENT_OUTOFCONTEXT};",
)
s = s.replace(
    "if let Some(h)=hook{let _=UnhookWinEvent(h);}",
    "if !hook.is_invalid(){let _=UnhookWinEvent(hook);}",
)
# Preserve the runner lifecycle API while the foreground tracker owns its thread.
if "pub fn spawn_context_tracker" not in s:
    s += (
        "\n// Compatibility with the daemon runner lifecycle.\n"
        "pub fn spawn_context_tracker(_initial: AppContextState) { start_context_tracker(); }\n"
        "pub fn stop_context_tracker() {}\n"
    )
# Context revision drives event-based profile re-evaluation rather than disk-write polling.
old = "x.active_process=process;x.active_process_path=path;x.active_window_title=t;x.active_window_class=c;x.window_width=w;x.window_height=h;x.fullscreen=full;x.monitor_id=monitor;x.virtual_desktop_id=vd;"
new = "x.revision=x.revision.wrapping_add(1);x.active_process=process;x.active_process_path=path;x.active_window_title=t;x.active_window_class=c;x.window_width=w;x.window_height=h;x.fullscreen=full;x.monitor_id=monitor;x.virtual_desktop_id=vd;"
s = s.replace(old, new)
write(p, s)

# Guarantee the rich condition compiler arm even if an old staging anchor missed it.
p = "src-tauri/src/daemon/compiler.rs"
s = read(p)
if "FrontendCondition::ContextMatch" not in s:
    anchor = "        FrontendCondition::WindowMatch { process, title } => EngineCondition::WindowMatch {"
    lines = [
        "        FrontendCondition::ContextMatch { process, path, title, class_name, virtual_desktop_id, monitor_id, min_width, max_width, min_height, max_height, fullscreen, mode } => EngineCondition::ContextMatch {",
        "            process: process.as_ref().filter(|v| !v.trim().is_empty()).map(|v| v.trim().to_lowercase()),",
        "            path: path.as_ref().filter(|v| !v.trim().is_empty()).map(|v| v.trim().to_lowercase()),",
        "            title: title.as_ref().filter(|v| !v.trim().is_empty()).map(|v| v.trim().to_lowercase()),",
        "            class_name: class_name.as_ref().filter(|v| !v.trim().is_empty()).map(|v| v.trim().to_lowercase()),",
        "            virtual_desktop_id: virtual_desktop_id.clone(), monitor_id: monitor_id.clone(),",
        "            min_width: *min_width, max_width: *max_width, min_height: *min_height, max_height: *max_height,",
        "            fullscreen: *fullscreen, mode: *mode,",
        "        },",
        "",
    ]
    if anchor not in s:
        raise SystemExit("compiler WindowMatch anchor missing")
    s = s.replace(anchor, "\n".join(lines) + anchor, 1)
write(p, s)

# Current profile.create constructor uses user-supplied linkedApps rather than vec![].
p = "src-tauri/src/daemon/router.rs"
s = read(p)
needle = "                    linked_apps: input.linked_apps.unwrap_or_default(),\n                    rules: vec![],"
if needle in s:
    s = s.replace(
        needle,
        "                    linked_apps: input.linked_apps.unwrap_or_default(),\n                    bindings: vec![],\n                    order: 0,\n                    rules: vec![],",
        1,
    )
write(p, s)

# Keep all product version sources aligned.
for p in ("package.json", "src-tauri/tauri.conf.json"):
    s = read(p).replace('"version": "0.3.1"', '"version": "0.3.2"')
    write(p, s)
p = "src-tauri/Cargo.toml"
s = read(p).replace('version = "0.3.1"', 'version = "0.3.2"')
write(p, s)

print("v0.3.2 current-head compatibility fixes applied")