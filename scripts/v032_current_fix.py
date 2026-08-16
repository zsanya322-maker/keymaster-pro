from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Baseline compatibility fixes already proven by the previous green cargo check.
# ---------------------------------------------------------------------------
p = "src-tauri/src/daemon/mouse_triggers.rs"
s = read(p)
s = s.replace(
    "use windows::Win32::UI::WindowsAndMessaging::{\n        GetDoubleClickTime, GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK,\n    };",
    "use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;\n    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK};",
)
write(p, s)

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

# ---------------------------------------------------------------------------
# Rich foreground context tracker with a real lifecycle.
# The runner-provided Arc is registered before the thread starts, the message
# queue is created before publishing the thread id, and stop posts WM_QUIT.
# ---------------------------------------------------------------------------
write(
    "src-tauri/src/trackers/context_tracker.rs",
    r'''use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::thread;
use tracing::info;

use crate::context::{AppContext, AppContextState};

static GLOBAL_CONTEXT: OnceLock<AppContextState> = OnceLock::new();
static TRACKER_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static TRACKER_THREAD_ID: AtomicU32 = AtomicU32::new(0);

pub fn init_context() -> AppContextState {
    if let Some(existing) = GLOBAL_CONTEXT.get() {
        return existing.clone();
    }
    let context = Arc::new(RwLock::new(AppContext::default()));
    let _ = GLOBAL_CONTEXT.set(context.clone());
    GLOBAL_CONTEXT.get().cloned().unwrap_or(context)
}

pub fn get_context() -> Option<AppContextState> {
    GLOBAL_CONTEXT.get().cloned()
}

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use windows::core::GUID;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::ProcessStatus::K32GetModuleBaseNameW;
    use windows::Win32::System::Threading::{
        GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows::Win32::UI::Shell::IVirtualDesktopManager;
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowRect,
        GetWindowTextW, GetWindowThreadProcessId, PeekMessageW, PostThreadMessageW,
        TranslateMessage, EVENT_SYSTEM_FOREGROUND, MSG, PM_NOREMOVE, WINEVENT_OUTOFCONTEXT,
        WM_QUIT,
    };

    const CLSID_VIRTUAL_DESKTOP_MANAGER: GUID =
        GUID::from_u128(0xaa5090865ca94c258f95589d3c07b48a);

    fn process_info(hwnd: HWND) -> (String, String) {
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return (String::new(), String::new());
            }

            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buffer = [0u16; 32768];
                let mut size = buffer.len() as u32;
                if QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    windows::core::PWSTR(buffer.as_mut_ptr()),
                    &mut size,
                )
                .is_ok()
                {
                    let path = String::from_utf16_lossy(&buffer[..size as usize]);
                    let name = std::path::Path::new(&path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    let _ = CloseHandle(handle);
                    return (name, path);
                }
                let _ = CloseHandle(handle);
            }

            if let Ok(handle) = OpenProcess(
                PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                false,
                pid,
            ) {
                let mut buffer = [0u16; 260];
                let len = K32GetModuleBaseNameW(handle, None, &mut buffer);
                let _ = CloseHandle(handle);
                if len > 0 {
                    return (
                        String::from_utf16_lossy(&buffer[..len as usize]).to_lowercase(),
                        String::new(),
                    );
                }
            }

            (String::new(), String::new())
        }
    }

    fn title(hwnd: HWND) -> String {
        unsafe {
            let mut buffer = [0u16; 1024];
            let len = GetWindowTextW(hwnd, &mut buffer);
            if len > 0 {
                String::from_utf16_lossy(&buffer[..len as usize])
            } else {
                String::new()
            }
        }
    }

    fn class_name(hwnd: HWND) -> String {
        unsafe {
            let mut buffer = [0u16; 256];
            let len = GetClassNameW(hwnd, &mut buffer);
            if len > 0 {
                String::from_utf16_lossy(&buffer[..len as usize])
            } else {
                String::new()
            }
        }
    }

    fn virtual_desktop(hwnd: HWND) -> String {
        unsafe {
            match CoCreateInstance::<_, IVirtualDesktopManager>(
                &CLSID_VIRTUAL_DESKTOP_MANAGER,
                None,
                CLSCTX_INPROC_SERVER,
            )
            .and_then(|manager| manager.GetWindowDesktopId(hwnd))
            {
                Ok(guid) => format!("{:?}", guid).to_lowercase(),
                Err(_) => String::new(),
            }
        }
    }

    fn geometry(hwnd: HWND) -> (i32, i32, bool, String) {
        unsafe {
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return (0, 0, false, String::new());
            }
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            let _ = GetMonitorInfoW(monitor, &mut info);
            let fullscreen = (rect.left - info.rcMonitor.left).abs() <= 1
                && (rect.top - info.rcMonitor.top).abs() <= 1
                && (rect.right - info.rcMonitor.right).abs() <= 1
                && (rect.bottom - info.rcMonitor.bottom).abs() <= 1;
            let monitor_id = format!(
                "{},{},{},{}",
                info.rcMonitor.left,
                info.rcMonitor.top,
                info.rcMonitor.right,
                info.rcMonitor.bottom
            );
            (
                rect.right - rect.left,
                rect.bottom - rect.top,
                fullscreen,
                monitor_id,
            )
        }
    }

    fn refresh(hwnd: HWND) {
        if hwnd.0.is_null() {
            return;
        }
        let Some(context) = get_context() else {
            return;
        };
        let (process, path) = process_info(hwnd);
        let window_title = title(hwnd);
        let window_class = class_name(hwnd);
        let (width, height, fullscreen, monitor_id) = geometry(hwnd);
        let virtual_desktop_id = virtual_desktop(hwnd);
        if let Ok(mut state) = context.write() {
            state.revision = state.revision.wrapping_add(1);
            state.active_process = process;
            state.active_process_path = path;
            state.active_window_title = window_title;
            state.active_window_class = window_class;
            state.window_width = width;
            state.window_height = height;
            state.fullscreen = fullscreen;
            state.monitor_id = monitor_id;
            state.virtual_desktop_id = virtual_desktop_id;
        }
    }

    unsafe extern "system" fn win_event_callback(
        _: HWINEVENTHOOK,
        _: u32,
        hwnd: HWND,
        _: i32,
        _: i32,
        _: u32,
        _: u32,
    ) {
        refresh(hwnd);
    }

    pub fn run() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            // PostThreadMessageW is reliable only after this thread owns a queue.
            let mut queue_probe = MSG::default();
            let _ = PeekMessageW(&mut queue_probe, None, 0, 0, PM_NOREMOVE);
            TRACKER_THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);

            refresh(GetForegroundWindow());
            let hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(win_event_callback),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );

            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }

            if !hook.is_invalid() {
                let _ = UnhookWinEvent(hook);
            }
            TRACKER_THREAD_ID.store(0, Ordering::SeqCst);
            CoUninitialize();
        }
    }

    pub fn stop() {
        let thread_id = TRACKER_THREAD_ID.load(Ordering::SeqCst);
        if thread_id == 0 {
            return;
        }
        unsafe {
            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

pub fn spawn_context_tracker(initial: AppContextState) {
    let _ = GLOBAL_CONTEXT.set(initial);
    if TRACKER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::Builder::new()
        .name("context-tracker".into())
        .spawn(|| {
            info!("Context tracker started");
            #[cfg(target_os = "windows")]
            win::run();
            #[cfg(not(target_os = "windows"))]
            while TRACKER_STARTED.load(Ordering::SeqCst) {
                thread::sleep(std::time::Duration::from_millis(250));
            }
            TRACKER_STARTED.store(false, Ordering::SeqCst);
        })
        .expect("Failed to start context tracker");
}

pub fn start_context_tracker() {
    spawn_context_tracker(init_context());
}

pub fn stop_context_tracker() {
    #[cfg(target_os = "windows")]
    win::stop();
    #[cfg(not(target_os = "windows"))]
    TRACKER_STARTED.store(false, Ordering::SeqCst);
}
''',
)

# ---------------------------------------------------------------------------
# Profile auto-switch matcher: every structured binding field participates in
# explicit ANY/ALL semantics; empty bindings never match. Legacy linkedApps
# remain an exact process-name fallback.
# ---------------------------------------------------------------------------
write(
    "src-tauri/src/daemon/profile_runtime.rs",
    r'''use crate::context::AppContext;
use crate::daemon::state::DaemonStateRef;
use crate::schemas::frontend::FrontendConfig;
use crate::shared::types::{MatchMode, Profile, ProfileBinding};

fn contains_ci(value: &str, needle: &str) -> bool {
    value.to_lowercase().contains(&needle.to_lowercase())
}

pub fn binding_matches(binding: &ProfileBinding, ctx: &AppContext) -> bool {
    let mut checks = Vec::new();
    if let Some(value) = binding.process.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(ctx.active_process.eq_ignore_ascii_case(value.trim()));
    }
    if let Some(value) = binding.path.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(contains_ci(&ctx.active_process_path, value.trim()));
    }
    if let Some(value) = binding.title.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(contains_ci(&ctx.active_window_title, value.trim()));
    }
    if let Some(value) = binding.class_name.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(ctx.active_window_class.eq_ignore_ascii_case(value.trim()));
    }
    if let Some(value) = binding
        .virtual_desktop_id
        .as_ref()
        .filter(|v| !v.trim().is_empty())
    {
        checks.push(ctx.virtual_desktop_id.eq_ignore_ascii_case(value.trim()));
    }
    if let Some(value) = binding.monitor_id.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(ctx.monitor_id == value.trim());
    }
    if let Some(value) = binding.fullscreen {
        checks.push(ctx.fullscreen == value);
    }

    if checks.is_empty() {
        return false;
    }
    match binding.mode {
        MatchMode::Any => checks.iter().any(|value| *value),
        MatchMode::All => checks.iter().all(|value| *value),
    }
}

pub fn profile_matches(profile: &Profile, ctx: &AppContext) -> bool {
    if !profile.bindings.is_empty() {
        return profile
            .bindings
            .iter()
            .any(|binding| binding_matches(binding, ctx));
    }
    profile
        .linked_apps
        .iter()
        .any(|process| ctx.active_process.eq_ignore_ascii_case(process))
}

pub fn activate_runtime(state: &DaemonStateRef, profile: Profile) -> Result<(), String> {
    let schema = crate::daemon::compiler::compile_schema(&FrontendConfig {
        rules: profile.rules.clone(),
        layers: profile.layers.clone(),
        tap_hold_timeout_ms: 200,
    });
    let mut daemon = state
        .write()
        .map_err(|_| "Failed to lock daemon state".to_string())?;
    daemon.active_profile_id = profile.id.clone();
    daemon.engine_schema = schema;
    daemon.active_profile = Some(profile);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binding_any_and_all_cover_every_context_field() {
        let ctx = AppContext {
            active_process: "code.exe".into(),
            active_process_path: "C:\\Apps\\Code.exe".into(),
            active_window_title: "Project - Code".into(),
            active_window_class: "Chrome_WidgetWin_1".into(),
            virtual_desktop_id: "desktop-a".into(),
            monitor_id: "0,0,1920,1080".into(),
            fullscreen: true,
            ..Default::default()
        };
        let all = ProfileBinding {
            process: Some("CODE.EXE".into()),
            path: Some("apps\\code".into()),
            title: Some("project".into()),
            class_name: Some("chrome_widgetwin_1".into()),
            virtual_desktop_id: Some("DESKTOP-A".into()),
            monitor_id: Some("0,0,1920,1080".into()),
            fullscreen: Some(true),
            mode: MatchMode::All,
        };
        assert!(binding_matches(&all, &ctx));

        let mut broken_all = all.clone();
        broken_all.monitor_id = Some("wrong-monitor".into());
        assert!(!binding_matches(&broken_all, &ctx));

        broken_all.mode = MatchMode::Any;
        assert!(binding_matches(&broken_all, &ctx));
    }

    #[test]
    fn empty_structured_binding_does_not_match() {
        assert!(!binding_matches(
            &ProfileBinding::default(),
            &AppContext::default()
        ));
    }
}
''',
)

# ---------------------------------------------------------------------------
# Compiler rich condition arm (some staging anchors are intentionally optional).
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Router: make manual activation the only persisted/preferred switch path,
# add complete profile-management APIs, rich active-window response, sorting,
# and deep duplicate identity regeneration.
# ---------------------------------------------------------------------------
p = "src-tauri/src/daemon/router.rs"
s = read(p)

needle = "                    linked_apps: input.linked_apps.unwrap_or_default(),\n                    rules: vec![],"
if needle in s:
    s = s.replace(
        needle,
        "                    linked_apps: input.linked_apps.unwrap_or_default(),\n                    bindings: vec![],\n                    order: 0,\n                    rules: vec![],",
        1,
    )

helper_marker = "/// Helper function to load, modify, save, and update the active profile in DaemonState."
if "fn regenerate_profile_identity" not in s:
    helper = r'''fn remap_layer_action(
    action: &mut crate::schemas::frontend::FrontendAction,
    layer_ids: &std::collections::HashMap<String, String>,
) {
    use crate::schemas::frontend::FrontendAction;
    match action {
        FrontendAction::ToggleLayer { layer_id } | FrontendAction::HoldLayer { layer_id } => {
            if let Some(new_id) = layer_ids.get(layer_id) {
                *layer_id = new_id.clone();
            }
        }
        _ => {}
    }
}

fn regenerate_profile_identity(
    profile: &mut crate::shared::types::Profile,
    new_profile_id: String,
    new_name: String,
) {
    let mut layer_ids = std::collections::HashMap::new();
    for layer in &mut profile.layers {
        let old_id = layer.id.clone();
        let new_id = uuid::Uuid::new_v4().to_string();
        layer.id = new_id.clone();
        layer_ids.insert(old_id, new_id);
    }

    let mut folder_ids = std::collections::HashMap::new();
    for folder in &mut profile.folders {
        let old_id = folder.id.clone();
        let new_id = uuid::Uuid::new_v4().to_string();
        folder.id = new_id.clone();
        folder_ids.insert(old_id, new_id);
    }
    for folder in &mut profile.folders {
        if let Some(parent_id) = folder.parent_id.as_mut() {
            if let Some(new_id) = folder_ids.get(parent_id) {
                *parent_id = new_id.clone();
            }
        }
    }

    for rule in &mut profile.rules {
        rule.id = uuid::Uuid::new_v4().to_string();
        if let Some(folder_id) = rule.folder_id.as_mut() {
            if let Some(new_id) = folder_ids.get(folder_id) {
                *folder_id = new_id.clone();
            }
        }
        for condition in &mut rule.conditions {
            if let crate::schemas::frontend::FrontendCondition::LayerActive { layer_id } = condition {
                if let Some(new_id) = layer_ids.get(layer_id) {
                    *layer_id = new_id.clone();
                }
            }
        }
        for action in &mut rule.actions {
            remap_layer_action(action, &layer_ids);
        }
        if let Some(actions) = rule.hold_actions.as_mut() {
            for action in actions {
                remap_layer_action(action, &layer_ids);
            }
        }
    }

    profile.id = new_profile_id;
    profile.name = new_name;
    profile.is_default = false;
    profile.order = profile.order.saturating_add(1);
}

'''
    if helper_marker not in s:
        raise SystemExit("router helper marker missing")
    s = s.replace(helper_marker, helper + helper_marker, 1)

# Manual activation: persist preferred id first, then update runtime and preferred state.
activate_pattern = re.compile(
    r'        "profile\.activate" => \{.*?\n        \}\n        "profile\.create" => \{',
    re.S,
)
activate_replacement = r'''        "profile.activate" => {
            let id = params
                .as_ref()
                .and_then(|value| value.get("id"))
                .and_then(|value| value.as_str())
                .ok_or("Missing profile id")?;
            let profile = crate::shared::persistence::load_profile_checked(id)?;

            // Manual activation owns persistence. Auto-switch changes runtime only.
            let mut config = crate::shared::config::load_config()?;
            config.active_profile_id = id.to_string();
            crate::shared::config::save_config(&config)?;

            crate::daemon::profile_runtime::activate_runtime(state, profile)?;
            {
                let mut daemon = state.write().map_err(|_| "Failed to lock state")?;
                daemon.preferred_profile_id = id.to_string();
            }
            Ok(json!({ "success": true }))
        }
        "profile.create" => {'''
s, count = activate_pattern.subn(activate_replacement, s, count=1)
if count != 1:
    raise SystemExit(f"profile.activate route replacement count={count}")

# Sort the profile list by explicit order and stable name before returning it.
profile_list_at = s.find('        "profile.list" => {')
if profile_list_at < 0:
    raise SystemExit("profile.list route missing")
active_at = s.find("            let active = {", profile_list_at)
if active_at < 0:
    raise SystemExit("profile.list active marker missing")
if "list.sort_by" not in s[profile_list_at:active_at]:
    s = s[:active_at] + "            list.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));\n" + s[active_at:]

# Complete profile-management endpoints. Insert once before onboarding routes.
if '        "profile.rename" => {' not in s:
    endpoints = r'''        "profile.rename" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value.get("id").and_then(Value::as_str).ok_or("Missing id")?;
            let name = value.get("name").and_then(Value::as_str).ok_or("Missing name")?.trim();
            if name.is_empty() { return Err("Name is empty".into()); }
            let mut profile = crate::shared::persistence::load_profile_checked(id)?;
            profile.name = name.to_string();
            crate::shared::persistence::save_profile(&profile)?;
            update_active_profile_runtime(profile, state)?;
            Ok(json!({"success": true}))
        }
        "profile.duplicate" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value.get("id").and_then(Value::as_str).ok_or("Missing id")?;
            let mut profile = crate::shared::persistence::load_profile_checked(id)?;
            let new_id = value
                .get("newId")
                .and_then(Value::as_str)
                .filter(|candidate| !candidate.trim().is_empty() && *candidate != id)
                .map(str::to_string)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            if profile_exists(&new_id)? {
                return Err("Duplicate target profile id already exists".into());
            }
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{} copy", profile.name));
            regenerate_profile_identity(&mut profile, new_id, name);
            crate::shared::persistence::save_profile(&profile)?;
            serde_json::to_value(profile).map_err(|error| error.to_string())
        }
        "profile.reorder" => {
            let value = params.ok_or("Missing parameters")?;
            let ids = value.get("ids").and_then(Value::as_array).ok_or("Missing ids")?;
            for (index, id) in ids.iter().filter_map(Value::as_str).enumerate() {
                if let Ok(mut profile) = crate::shared::persistence::load_profile_checked(id) {
                    profile.order = index as i32;
                    crate::shared::persistence::save_profile(&profile)?;
                }
            }
            Ok(json!({"success": true}))
        }
        "profile.backups" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value.get("id").and_then(Value::as_str).ok_or("Missing id")?;
            Ok(json!({"backups": crate::shared::persistence::list_profile_backups(id)?}))
        }
        "profile.backup.create" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value.get("id").and_then(Value::as_str).ok_or("Missing id")?;
            Ok(json!({"name": crate::shared::persistence::create_profile_backup(id)?}))
        }
        "profile.backup.restore" => {
            let value = params.ok_or("Missing parameters")?;
            let id = value.get("id").and_then(Value::as_str).ok_or("Missing id")?;
            let name = value.get("name").and_then(Value::as_str).ok_or("Missing name")?;
            let profile = crate::shared::persistence::restore_profile_backup(id, name)?;
            update_active_profile_runtime(profile.clone(), state)?;
            serde_json::to_value(profile).map_err(|error| error.to_string())
        }
        "profile.runtime_status" => {
            let daemon = state.read().map_err(|_| "Failed to lock state")?;
            Ok(json!({
                "active": daemon.active_profile_id,
                "preferred": daemon.preferred_profile_id,
                "autoSwitch": daemon.auto_switch_profiles,
                "manualLock": daemon.manual_profile_lock
            }))
        }

'''
    anchor = '        "apply_onboarding_example" => {'
    if anchor not in s:
        raise SystemExit("router onboarding anchor missing")
    s = s.replace(anchor, endpoints + anchor, 1)

# Rich active-window response used by both condition capture and profile bindings.
window_pattern = re.compile(
    r'        "get_active_window" => \{.*?\n        \}\n\n        // System / Other',
    re.S,
)
window_replacement = r'''        "get_active_window" => {
            if let Some(context) = crate::trackers::context_tracker::get_context() {
                if let Ok(context) = context.read() {
                    return Ok(json!({
                        "process": context.active_process,
                        "path": context.active_process_path,
                        "title": context.active_window_title,
                        "className": context.active_window_class,
                        "width": context.window_width,
                        "height": context.window_height,
                        "fullscreen": context.fullscreen,
                        "monitorId": context.monitor_id,
                        "virtualDesktopId": context.virtual_desktop_id,
                    }));
                }
            }
            Ok(json!({
                "process": "", "path": "", "title": "", "className": "",
                "width": 0, "height": 0, "fullscreen": false,
                "monitorId": "", "virtualDesktopId": ""
            }))
        }

        // System / Other'''
s, count = window_pattern.subn(window_replacement, s, count=1)
if count != 1:
    raise SystemExit(f"get_active_window route replacement count={count}")

# Deep-duplicate regression test: nested identities and references must all move.
if "duplicate_regenerates_nested_ids_and_references" not in s:
    s += r'''

#[cfg(test)]
mod v032_profile_identity_tests {
    use super::regenerate_profile_identity;
    use crate::schemas::frontend::{
        FrontendAction, FrontendCondition, FrontendRule, FrontendTrigger, KeyChord, LayerMeta,
        RuleFolder,
    };
    use crate::shared::types::Profile;

    #[test]
    fn duplicate_regenerates_nested_ids_and_references() {
        let mut profile = Profile {
            id: "profile-old".into(),
            name: "Original".into(),
            is_default: true,
            linked_apps: vec![],
            bindings: vec![],
            order: 4,
            layers: vec![LayerMeta { id: "layer-old".into(), name: "Layer".into() }],
            folders: vec![
                RuleFolder { id: "folder-root".into(), name: "Root".into(), parent_id: None, order: 0 },
                RuleFolder { id: "folder-child".into(), name: "Child".into(), parent_id: Some("folder-root".into()), order: 1 },
            ],
            rules: vec![FrontendRule {
                id: "rule-old".into(),
                name: Some("Rule".into()),
                trigger: FrontendTrigger::KeyDown { chord: KeyChord::single(65) },
                actions: vec![FrontendAction::ToggleLayer { layer_id: "layer-old".into() }],
                hold_actions: Some(vec![FrontendAction::HoldLayer { layer_id: "layer-old".into() }]),
                conditions: vec![FrontendCondition::LayerActive { layer_id: "layer-old".into() }],
                priority: 0,
                enabled: true,
                folder_id: Some("folder-child".into()),
                order: 0,
            }],
        };

        regenerate_profile_identity(&mut profile, "profile-new".into(), "Copy".into());
        assert_eq!(profile.id, "profile-new");
        assert_eq!(profile.name, "Copy");
        assert!(!profile.is_default);
        assert_ne!(profile.layers[0].id, "layer-old");
        assert_ne!(profile.folders[0].id, "folder-root");
        assert_ne!(profile.folders[1].id, "folder-child");
        assert_eq!(profile.folders[1].parent_id.as_deref(), Some(profile.folders[0].id.as_str()));
        assert_ne!(profile.rules[0].id, "rule-old");
        assert_eq!(profile.rules[0].folder_id.as_deref(), Some(profile.folders[1].id.as_str()));

        let layer_id = profile.layers[0].id.as_str();
        assert!(matches!(&profile.rules[0].conditions[0], FrontendCondition::LayerActive { layer_id: id } if id == layer_id));
        assert!(matches!(&profile.rules[0].actions[0], FrontendAction::ToggleLayer { layer_id: id } if id == layer_id));
        assert!(matches!(&profile.rules[0].hold_actions.as_ref().unwrap()[0], FrontendAction::HoldLayer { layer_id: id } if id == layer_id));
    }
}
'''
write(p, s)

# ---------------------------------------------------------------------------
# Runner: sync switch policy live, and evaluate profile bindings only when the
# foreground revision / policy / current profile changes. No config writes here.
# ---------------------------------------------------------------------------
p = "src-tauri/src/daemon/runner.rs"
s = read(p)

# Ensure every startup Profile initializer has the schema-v4 fields.
lines = s.splitlines(True)
out = []
inside = False
depth = 0
block = []

def flush_profile(block_lines):
    joined = "".join(block_lines)
    if "linked_apps:" in joined and "bindings:" not in joined:
        result = []
        for line in block_lines:
            result.append(line)
            if "linked_apps:" in line:
                indent = line[: len(line) - len(line.lstrip())]
                result.append(f"{indent}bindings: vec![],\n")
                result.append(f"{indent}order: 0,\n")
        return result
    return block_lines

for line in lines:
    if not inside and "Profile {" in line and not line.lstrip().startswith("pub struct"):
        inside = True
        depth = line.count("{") - line.count("}")
        block = [line]
        continue
    if inside:
        block.append(line)
        depth += line.count("{") - line.count("}")
        if depth <= 0:
            out.extend(flush_profile(block))
            inside = False
            block = []
        continue
    out.append(line)
if block:
    out.extend(flush_profile(block))
s = "".join(out)

if "s.auto_switch_profiles != updated.auto_switch_profiles" not in s:
    s = s.replace(
        "                    || s.macro_emergency_stop_vk != updated.macro_emergency_stop_vk;",
        "                    || s.macro_emergency_stop_vk != updated.macro_emergency_stop_vk\n                    || s.auto_switch_profiles != updated.auto_switch_profiles\n                    || s.manual_profile_lock != updated.manual_profile_lock;",
        1,
    )
if "s.auto_switch_profiles = updated.auto_switch_profiles;" not in s:
    s = s.replace(
        "                s.macro_emergency_stop_vk = updated.macro_emergency_stop_vk;",
        "                s.macro_emergency_stop_vk = updated.macro_emergency_stop_vk;\n                s.auto_switch_profiles = updated.auto_switch_profiles;\n                s.manual_profile_lock = updated.manual_profile_lock;",
        1,
    )

# Replace the old disabled-roadmap comment with a revision-gated runtime task.
comment_pattern = re.compile(
    r'    // NOTE: Автопереключение профилей.*?    // при включённой опции и без явного ручного выбора пользователя\.\n',
    re.S,
)
auto_task = r'''    // Profile auto-switch is runtime-only. The persisted/preferred id changes only
    // through profile.activate. Disk/profile evaluation is gated by foreground revision.
    let profile_switch_state = state.clone();
    tokio_rt.spawn(async move {
        let mut last_revision = u64::MAX;
        let mut last_signature: Option<(bool, bool, String, String)> = None;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(75)).await;
            let (running, auto_switch, manual_lock, preferred, current) =
                match profile_switch_state.read() {
                    Ok(daemon) => (
                        daemon.running,
                        daemon.auto_switch_profiles,
                        daemon.manual_profile_lock,
                        daemon.preferred_profile_id.clone(),
                        daemon.active_profile_id.clone(),
                    ),
                    Err(_) => continue,
                };
            if !running {
                break;
            }

            let context = crate::trackers::context_tracker::get_context()
                .and_then(|context| context.read().ok().map(|value| value.clone()))
                .unwrap_or_default();
            let signature = (auto_switch, manual_lock, preferred.clone(), current.clone());
            if last_revision == context.revision && last_signature.as_ref() == Some(&signature) {
                continue;
            }
            last_revision = context.revision;
            last_signature = Some(signature);

            let target = if auto_switch && !manual_lock {
                let mut profiles = crate::shared::persistence::list_profiles()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|id| crate::shared::persistence::load_profile_checked(&id).ok())
                    .collect::<Vec<_>>();
                profiles.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
                profiles
                    .into_iter()
                    .find(|profile| crate::daemon::profile_runtime::profile_matches(profile, &context))
                    .or_else(|| crate::shared::persistence::load_profile_checked(&preferred).ok())
            } else {
                crate::shared::persistence::load_profile_checked(&preferred).ok()
            };

            if let Some(profile) = target {
                if profile.id != current {
                    if let Err(error) = crate::daemon::profile_runtime::activate_runtime(&profile_switch_state, profile) {
                        warn!("Profile auto-switch failed: {}", error);
                    }
                }
            }
        }
    });

'''
s, count = comment_pattern.subn(auto_task, s, count=1)
if count != 1 and "let profile_switch_state = state.clone();" not in s:
    raise SystemExit(f"runner auto-switch insertion count={count}")
write(p, s)

# ---------------------------------------------------------------------------
# TypeScript profile binding model and compact full-field editor.
# ---------------------------------------------------------------------------
p = "src/lib/types.ts"
s = read(p)
s = s.replace(
    "export interface ProfileBinding { process?: string; path?: string; title?: string; className?: string; mode: MatchMode }",
    "export interface ProfileBinding { process?: string; path?: string; title?: string; className?: string; virtualDesktopId?: string; monitorId?: string; fullscreen?: boolean; mode: MatchMode }",
)
write(p, s)

write(
    "src/components/ProfileAutomationPanel.tsx",
    r'''import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ArrowDown, ArrowUp, Copy, RotateCcw, Save } from 'lucide-react'
import { useProfileStore } from '../store/profileStore'
import { useAppStore } from '../store/appStore'
import type { ProfileBinding } from '../lib/types'

type CapturedContext = {
  process: string
  path: string
  title: string
  className: string
  virtualDesktopId: string
  monitorId: string
  fullscreen: boolean
}

const fieldClass = 'h-6 min-w-0 border border-app-border bg-app-bg px-1'

export const ProfileAutomationPanel: React.FC = () => {
  const { profiles, activeProfileId, saveProfile, renameProfile, duplicateProfile, reorderProfiles } = useProfileStore()
  const { config, setConfig } = useAppStore()
  const active = profiles.find((profile) => profile.id === activeProfileId)
  const [backups, setBackups] = useState<string[]>([])

  const loadBackups = async () => {
    if (!active) return
    const result = await invoke<{ backups: string[] }>('ipc_call', {
      method: 'profile.backups',
      params: { id: active.id },
    })
    setBackups(result.backups)
  }

  useEffect(() => {
    void loadBackups()
  }, [activeProfileId])

  if (!active) return null

  const bindings = active.bindings || []
  const setBindings = (next: ProfileBinding[]) => void saveProfile({ ...active, bindings: next })
  const updateBinding = (index: number, patch: Partial<ProfileBinding>) => {
    const next = [...bindings]
    next[index] = { ...next[index], ...patch }
    setBindings(next)
  }
  const capture = async () => {
    const context = await invoke<CapturedContext>('ipc_call', { method: 'get_active_window' })
    setBindings([
      ...bindings,
      {
        process: context.process,
        path: context.path,
        title: context.title,
        className: context.className,
        virtualDesktopId: context.virtualDesktopId,
        monitorId: context.monitorId,
        fullscreen: context.fullscreen,
        mode: 'all',
      },
    ])
  }
  const move = async (delta: number) => {
    const ids = profiles.map((profile) => profile.id)
    const from = ids.indexOf(active.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    await reorderProfiles(ids)
  }

  return (
    <div className="space-y-2 text-[10px]">
      <div className="flex flex-wrap gap-1">
        <button className="h-7 px-2 border border-app-border" onClick={() => {
          const name = prompt('Profile name', active.name)
          if (name?.trim()) void renameProfile(active.id, name.trim())
        }}>Rename</button>
        <button className="h-7 px-2 border border-app-border flex items-center gap-1" onClick={() => void duplicateProfile(active.id, `${active.name} copy`)}><Copy size={10} /> Duplicate</button>
        <button onClick={() => void move(-1)} className="h-7 w-7 border border-app-border"><ArrowUp size={11} /></button>
        <button onClick={() => void move(1)} className="h-7 w-7 border border-app-border"><ArrowDown size={11} /></button>
      </div>

      <label className="flex gap-2 items-center"><input type="checkbox" checked={Boolean(config.autoSwitchProfiles)} onChange={(event) => setConfig({ autoSwitchProfiles: event.target.checked })} />Auto-switch profiles</label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={Boolean(config.manualProfileLock)} onChange={(event) => setConfig({ manualProfileLock: event.target.checked })} />Manual profile lock</label>

      <div className="border border-app-border p-2 space-y-1">
        <div className="flex justify-between gap-2"><b>App/window bindings</b><button onClick={() => void capture()} className="border border-app-border px-2 h-6">Capture active context</button></div>
        {bindings.map((binding, index) => (
          <div key={index} className="border border-app-border/60 p-1 grid grid-cols-2 gap-1">
            <input className={fieldClass} placeholder="process.exe" value={binding.process || ''} onChange={(event) => updateBinding(index, { process: event.target.value || undefined })} />
            <input className={fieldClass} placeholder="path contains" value={binding.path || ''} onChange={(event) => updateBinding(index, { path: event.target.value || undefined })} />
            <input className={fieldClass} placeholder="title contains" value={binding.title || ''} onChange={(event) => updateBinding(index, { title: event.target.value || undefined })} />
            <input className={fieldClass} placeholder="window class" value={binding.className || ''} onChange={(event) => updateBinding(index, { className: event.target.value || undefined })} />
            <input className={fieldClass} placeholder="virtual desktop GUID" value={binding.virtualDesktopId || ''} onChange={(event) => updateBinding(index, { virtualDesktopId: event.target.value || undefined })} />
            <input className={fieldClass} placeholder="monitor id" value={binding.monitorId || ''} onChange={(event) => updateBinding(index, { monitorId: event.target.value || undefined })} />
            <select className={fieldClass} value={binding.fullscreen === undefined ? 'any' : binding.fullscreen ? 'true' : 'false'} onChange={(event) => updateBinding(index, { fullscreen: event.target.value === 'any' ? undefined : event.target.value === 'true' })}>
              <option value="any">Window mode: any</option><option value="true">Fullscreen</option><option value="false">Windowed</option>
            </select>
            <div className="flex gap-1">
              <select className={`${fieldClass} flex-1`} value={binding.mode || 'any'} onChange={(event) => updateBinding(index, { mode: event.target.value as 'any' | 'all' })}><option value="any">ANY</option><option value="all">ALL</option></select>
              <button className="h-6 px-2 border border-app-border" onClick={() => setBindings(bindings.filter((_, item) => item !== index))}>×</button>
            </div>
          </div>
        ))}
      </div>

      <div className="border border-app-border p-2">
        <button onClick={async () => { await invoke('ipc_call', { method: 'profile.backup.create', params: { id: active.id } }); await loadBackups() }} className="h-6 px-2 border border-app-border flex items-center gap-1"><Save size={10} /> Backup</button>
        {backups.slice(0, 5).map((name) => <div key={name} className="flex justify-between mt-1 gap-2"><span className="truncate">{name}</span><button title="Restore" onClick={async () => { await invoke('ipc_call', { method: 'profile.backup.restore', params: { id: active.id, name } }); await useProfileStore.getState().loadProfiles() }}><RotateCcw size={10} /></button></div>)}
      </div>
    </div>
  )
}
''',
)

# Expand the generated ContextMatch editor to every context field.
p = "src/components/ruleBuilder/ConditionEditor.tsx"
s = read(p)
context_editor_pattern = re.compile(
    r"            \{condition\.type === 'contextMatch' && \(.*?\n            \)\}\n(?=            \{condition\.type === 'windowMatch')",
    re.S,
)
context_editor = r'''            {condition.type === 'contextMatch' && (
              <div className="flex-1 min-w-0 grid grid-cols-2 gap-1">
                <input className={controlClass} placeholder="process.exe" value={condition.process || ''} onChange={(e) => onChange({ ...condition, process: e.target.value || undefined })} />
                <input className={controlClass} placeholder="path contains" value={condition.path || ''} onChange={(e) => onChange({ ...condition, path: e.target.value || undefined })} />
                <input className={controlClass} placeholder="title contains" value={condition.title || ''} onChange={(e) => onChange({ ...condition, title: e.target.value || undefined })} />
                <input className={controlClass} placeholder="window class" value={condition.className || ''} onChange={(e) => onChange({ ...condition, className: e.target.value || undefined })} />
                <input className={controlClass} placeholder="virtual desktop GUID" value={condition.virtualDesktopId || ''} onChange={(e) => onChange({ ...condition, virtualDesktopId: e.target.value || undefined })} />
                <input className={controlClass} placeholder="monitor id" value={condition.monitorId || ''} onChange={(e) => onChange({ ...condition, monitorId: e.target.value || undefined })} />
                <input className={controlClass} type="number" placeholder="min width" value={condition.minWidth ?? ''} onChange={(e) => onChange({ ...condition, minWidth: e.target.value ? Number(e.target.value) : undefined })} />
                <input className={controlClass} type="number" placeholder="max width" value={condition.maxWidth ?? ''} onChange={(e) => onChange({ ...condition, maxWidth: e.target.value ? Number(e.target.value) : undefined })} />
                <input className={controlClass} type="number" placeholder="min height" value={condition.minHeight ?? ''} onChange={(e) => onChange({ ...condition, minHeight: e.target.value ? Number(e.target.value) : undefined })} />
                <input className={controlClass} type="number" placeholder="max height" value={condition.maxHeight ?? ''} onChange={(e) => onChange({ ...condition, maxHeight: e.target.value ? Number(e.target.value) : undefined })} />
                <select className={selectClass} value={condition.fullscreen === undefined ? 'any' : condition.fullscreen ? 'true' : 'false'} onChange={(e) => onChange({ ...condition, fullscreen: e.target.value === 'any' ? undefined : e.target.value === 'true' })}><option value="any">Window mode: any</option><option value="true">Fullscreen</option><option value="false">Windowed</option></select>
                <select className={selectClass} value={condition.mode} onChange={(e) => onChange({ ...condition, mode: e.target.value as 'any' | 'all' })}><option value="all">ALL</option><option value="any">ANY</option></select>
                <button type="button" className="h-7 px-2 border border-app-border col-span-2" onClick={async () => { const c = await invoke<any>('ipc_call', { method: 'get_active_window' }); onChange({ ...condition, process: c.process, path: c.path, title: c.title, className: c.className, virtualDesktopId: c.virtualDesktopId, monitorId: c.monitorId, fullscreen: c.fullscreen }) }}>Capture active context</button>
              </div>
            )}
'''
s, count = context_editor_pattern.subn(context_editor, s, count=1)
if count != 1:
    raise SystemExit(f"ContextMatch editor replacement count={count}")
write(p, s)

# ---------------------------------------------------------------------------
# Actual Tauri 2 tray implementation: previous/next are dynamic and call the
# exact same profile.activate IPC API as the GUI.
# ---------------------------------------------------------------------------
write(
    "src-tauri/src/gui/tray.rs",
    r'''/// System Tray setup
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    App, Emitter, Manager,
};

pub const MENU_SHOW: &str = "show";
pub const MENU_RESTART_ADMIN: &str = "restart_admin";
pub const MENU_PROFILE_PREV: &str = "profile_prev";
pub const MENU_PROFILE_NEXT: &str = "profile_next";
pub const MENU_QUIT: &str = "quit";

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn switch_profile(direction: isize) {
    tauri::async_runtime::spawn(async move {
        let Ok(value) = crate::daemon::ipc_client::call("profile.list", None).await else {
            return;
        };
        let Some(profiles) = value.get("profiles").and_then(|value| value.as_array()) else {
            return;
        };
        if profiles.is_empty() {
            return;
        }
        let active = value.get("active").and_then(|value| value.as_str()).unwrap_or("");
        let current = profiles
            .iter()
            .position(|profile| profile.get("id").and_then(|value| value.as_str()) == Some(active))
            .unwrap_or(0) as isize;
        let target = (current + direction).rem_euclid(profiles.len() as isize) as usize;
        let target_id = profiles[target]
            .get("id")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        if let Some(id) = target_id {
            let _ = crate::daemon::ipc_client::call(
                "profile.activate",
                Some(serde_json::json!({ "id": id })),
            )
            .await;
        }
    });
}

pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let is_elevated = {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::Security::{
                GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
            };
            use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
            unsafe {
                let mut token = windows::Win32::Foundation::HANDLE::default();
                if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_ok() {
                    let mut elevation = TOKEN_ELEVATION::default();
                    let mut size = 0;
                    let elevated = GetTokenInformation(
                        token,
                        TokenElevation,
                        Some(&mut elevation as *mut _ as *mut _),
                        std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                        &mut size,
                    )
                    .is_ok()
                        && elevation.TokenIsElevated != 0;
                    let _ = windows::Win32::Foundation::CloseHandle(token);
                    elevated
                } else {
                    false
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    };

    let mut menu_builder = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id(MENU_SHOW, "Показать KeyMaster Pro").build(app)?);

    if !is_elevated {
        menu_builder = menu_builder.item(
            &MenuItemBuilder::with_id(MENU_RESTART_ADMIN, "🛡️ Перезапустить от Администратора")
                .build(app)?,
        );
    } else {
        menu_builder = menu_builder.item(
            &MenuItemBuilder::with_id(MENU_RESTART_ADMIN, "🛡️ Запущено как Администратор")
                .enabled(false)
                .build(app)?,
        );
    }

    let menu = menu_builder
        .separator()
        .item(&MenuItemBuilder::with_id(MENU_PROFILE_PREV, "← Предыдущий профиль").build(app)?)
        .item(&MenuItemBuilder::with_id(MENU_PROFILE_NEXT, "Следующий профиль →").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id(MENU_QUIT, "Выйти").build(app)?)
        .build()?;

    let icon = match app.default_window_icon() {
        Some(icon) => icon.clone(),
        None => {
            tracing::warn!("Default window icon not found");
            return Err("Default window icon not found".into());
        }
    };

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("KeyMaster Pro - active")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_RESTART_ADMIN => {
                show_main_window(app);
                let _ = app.emit("app-restart-admin-requested", ());
            }
            MENU_PROFILE_PREV => switch_profile(-1),
            MENU_PROFILE_NEXT => switch_profile(1),
            MENU_QUIT => {
                show_main_window(app);
                let _ = app.emit("app-exit-requested", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == tauri::tray::MouseButton::Left
                    && button_state == tauri::tray::MouseButtonState::Up
                {
                    show_main_window(tray.app_handle());
                }
            }
        })
        .build(app)?;

    app.manage(tray);
    Ok(())
}
''',
)

# ---------------------------------------------------------------------------
# v0.3.2 schema is 4. These tests continue to verify v2/v3 macro semantics; the
# only changed expectation is the migrated/exported schema version.
# ---------------------------------------------------------------------------
p = "src-tauri/tests/profile_schema_v3.rs"
s = read(p)
s = s.replace("assert_eq!(PROFILE_SCHEMA_VERSION, 3);", "assert_eq!(PROFILE_SCHEMA_VERSION, 4);")
s = s.replace('assert_eq!(exported["schemaVersion"], 3);', 'assert_eq!(exported["schemaVersion"], 4);')
write(p, s)

# GUI export marker and product metadata.
p = "src/app/App.tsx"
s = read(p).replace("const PROFILE_SCHEMA_VERSION = 1", "const PROFILE_SCHEMA_VERSION = 4").replace(
    "const PROFILE_SCHEMA_VERSION = 3", "const PROFILE_SCHEMA_VERSION = 4"
)
write(p, s)
for p in ("package.json", "src-tauri/tauri.conf.json"):
    s = read(p).replace('"version": "0.3.1"', '"version": "0.3.2"')
    write(p, s)
p = "src-tauri/Cargo.toml"
s = read(p).replace('version = "0.3.1"', 'version = "0.3.2"')
write(p, s)

print("v0.3.2 current-head compatibility + functional audit fixes applied")