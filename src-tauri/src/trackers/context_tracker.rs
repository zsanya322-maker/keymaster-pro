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

                    // Инициализируем текущее активное окно сразу при запуске
                    let fg_window = windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
                    if !fg_window.is_invalid() {
                        update_active_window(fg_window);
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
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

#[cfg(target_os = "windows")]
unsafe fn get_process_name_by_toolhelp32(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()? };
    let mut entry = PROCESSENTRY32W::default();
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

    let mut result = None;
    if unsafe { Process32FirstW(snapshot, &mut entry).is_ok() } {
        loop {
            if entry.th32ProcessID == pid {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let exe_name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                result = Some(exe_name);
                break;
            }
            if unsafe { Process32NextW(snapshot, &mut entry).is_err() } {
                break;
            }
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };
    result
}

#[cfg(target_os = "windows")]
unsafe fn get_process_name_from_handle(process_handle: windows::Win32::Foundation::HANDLE) -> Option<String> {
    use windows::Win32::System::Threading::QueryFullProcessImageNameW;
    use windows::Win32::Foundation::MAX_PATH;
    use std::path::Path;

    let mut path_buf = [0u16; MAX_PATH as usize];
    let mut size = path_buf.len() as u32;
    
    let res = unsafe {
        QueryFullProcessImageNameW(
            process_handle,
            windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(path_buf.as_mut_ptr()),
            &mut size,
        )
    };

    if res.is_ok() && size > 0 {
        let path_str = String::from_utf16_lossy(&path_buf[..size as usize]);
        return Path::new(&path_str)
            .file_name()
            .map(|s| s.to_string_lossy().to_string());
    }

    use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
    let mut path_buf = [0u16; MAX_PATH as usize];
    let len = unsafe { GetProcessImageFileNameW(process_handle, &mut path_buf) };
    if len > 0 {
        let path_str = String::from_utf16_lossy(&path_buf[..len as usize]);
        return Path::new(&path_str)
            .file_name()
            .map(|s| s.to_string_lossy().to_string());
    }

    None
}

#[cfg(target_os = "windows")]
unsafe fn get_process_name_by_pid(pid: u32) -> String {
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::Foundation::CloseHandle;

    if let Ok(process_handle) = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        let name_opt = unsafe { get_process_name_from_handle(process_handle) };
        let _ = unsafe { CloseHandle(process_handle) };
        if let Some(name) = name_opt {
            return name;
        }
    }

    if let Some(name) = unsafe { get_process_name_by_toolhelp32(pid) } {
        return name;
    }

    String::new()
}

#[cfg(target_os = "windows")]
pub unsafe fn update_active_window(hwnd: HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, GetWindowTextW};
    
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    if process_id == 0 {
        return;
    }

    let process_name = unsafe { get_process_name_by_pid(process_id) };

    let mut title_buf = [0u16; 512];
    let title_len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
    let title = if title_len > 0 {
        String::from_utf16_lossy(&title_buf[..title_len as usize])
    } else {
        String::new()
    };

    if let Some(ctx_arc) = CONTEXT_STATE.get() {
        if let Ok(mut ctx) = ctx_arc.write() {
            ctx.active_process = crate::shared::clean_process_name(&process_name);
            ctx.active_window_title = title;
        }
    }
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
    unsafe { update_active_window(hwnd) };
}
