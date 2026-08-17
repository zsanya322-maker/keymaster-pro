use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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

    // WinEvent constants intentionally kept local: windows-rs moved some of
    // these constants between feature modules across releases, while the Win32
    // ABI values are stable.
    const EVENT_OBJECT_LOCATIONCHANGE_ID: u32 = 0x800B;
    const EVENT_OBJECT_NAMECHANGE_ID: u32 = 0x800C;

    unsafe extern "system" fn win_event_callback(
        _: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        _: i32,
        _: i32,
        _: u32,
        _: u32,
    ) {
        if hwnd.0.is_null() {
            return;
        }
        let foreground = unsafe { GetForegroundWindow() };
        if event == EVENT_SYSTEM_FOREGROUND || hwnd == foreground {
            refresh(hwnd);
        }
    }

    pub fn run() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            // PostThreadMessageW is reliable only after this thread owns a queue.
            let mut queue_probe = MSG::default();
            let _ = PeekMessageW(&mut queue_probe, None, 0, 0, PM_NOREMOVE);
            TRACKER_THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);

            refresh(GetForegroundWindow());
            let foreground_hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(win_event_callback),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            let location_hook = SetWinEventHook(
                EVENT_OBJECT_LOCATIONCHANGE_ID,
                EVENT_OBJECT_LOCATIONCHANGE_ID,
                None,
                Some(win_event_callback),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            let name_hook = SetWinEventHook(
                EVENT_OBJECT_NAMECHANGE_ID,
                EVENT_OBJECT_NAMECHANGE_ID,
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

            for hook in [foreground_hook, location_hook, name_hook] {
                if !hook.is_invalid() {
                    let _ = UnhookWinEvent(hook);
                }
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
