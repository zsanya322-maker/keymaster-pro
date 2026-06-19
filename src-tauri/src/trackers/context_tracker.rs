use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tracing::{info, error, warn};

use crate::context::AppContextState;

#[cfg(target_os = "windows")]
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, TranslateMessage, DispatchMessageW, EVENT_SYSTEM_FOREGROUND,
    WINEVENT_OUTOFCONTEXT, MSG,
};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;

static TRACKER_RUNNING: AtomicBool = AtomicBool::new(false);
static CONTEXT_STATE: OnceLock<AppContextState> = OnceLock::new();

pub fn spawn_context_tracker(ctx: AppContextState) {
    if TRACKER_RUNNING.swap(true, Ordering::SeqCst) {
        warn!("Context tracker is already running.");
        return;
    }

    CONTEXT_STATE.set(ctx).unwrap();

    std::thread::Builder::new()
        .name("km-context-tracker".to_string())
        .spawn(|| {
            info!("Context tracker thread started.");
            
            #[cfg(target_os = "windows")]
            {
                unsafe {
                    let hook = SetWinEventHook(
                        EVENT_SYSTEM_FOREGROUND,
                        EVENT_SYSTEM_FOREGROUND,
                        None,
                        Some(win_event_proc),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    );

                    if hook.is_invalid() {
                        error!("Failed to register SetWinEventHook");
                        TRACKER_RUNNING.store(false, Ordering::SeqCst);
                        return;
                    }

                    // Windows Message Loop is REQUIRED for out-of-context WinEvent hooks.
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).into() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                        
                        if !TRACKER_RUNNING.load(Ordering::SeqCst) {
                            break;
                        }
                    }

                    let _ = UnhookWinEvent(hook);
                }
            }
            
            #[cfg(not(target_os = "windows"))]
            {
                while TRACKER_RUNNING.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
            
            info!("Context tracker thread stopped.");
        })
        .expect("Failed to spawn context tracker thread");
}

pub fn stop_context_tracker() {
    TRACKER_RUNNING.store(false, Ordering::SeqCst);
}

pub fn get_context() -> Option<AppContextState> {
    CONTEXT_STATE.get().cloned()
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn win_event_proc(
    _h_win_event_hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _id_event_thread: u32,
    _dwms_event_time: u32,
) {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, GetWindowTextW};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
    use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
    use std::path::Path;

    let mut process_id = 0;
    let process_handle = unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) {
            Ok(h) => h,
            Err(_) => return,
        }
    };

    let mut path_buf = [0u16; MAX_PATH as usize];
    let len = unsafe { GetProcessImageFileNameW(process_handle, &mut path_buf) };
    unsafe { let _ = CloseHandle(process_handle); }

    let process_name = if len > 0 {
        let path_str = String::from_utf16_lossy(&path_buf[..len as usize]);
        Path::new(&path_str)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    let mut title_buf = [0u16; 512];
    let title_len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
    let title = if title_len > 0 {
        String::from_utf16_lossy(&title_buf[..title_len as usize])
    } else {
        String::new()
    };

    if let Some(ctx_arc) = CONTEXT_STATE.get() {
        if let Ok(mut ctx) = ctx_arc.write() {
            ctx.active_process = process_name.to_lowercase();
            ctx.active_window_title = title;
            // info!("Active window updated: {} ({})", ctx.active_window_title, ctx.active_process);
        }
    }
}
