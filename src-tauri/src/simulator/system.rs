#[cfg(target_os = "windows")]
use windows::core::{w, HSTRING};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{LPARAM, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, SetWindowPos, GetSystemMetrics, GetWindowRect,
    SendMessageW, ShowWindow, HWND_BROADCAST, WM_SYSCOMMAND, WM_CLOSE,
    SW_MINIMIZE, SW_MAXIMIZE, SW_SHOWNORMAL, SWP_NOZORDER, SWP_NOACTIVATE,
    SM_CXSCREEN, SM_CYSCREEN,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::ShellExecuteW;

pub fn execute_window_action(action: &str) {
    #[cfg(target_os = "windows")]
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return;
        }

        match action {
            "snap_left" => {
                let screen_width = GetSystemMetrics(SM_CXSCREEN);
                let screen_height = GetSystemMetrics(SM_CYSCREEN);
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    screen_width / 2,
                    screen_height,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
            "snap_right" => {
                let screen_width = GetSystemMetrics(SM_CXSCREEN);
                let screen_height = GetSystemMetrics(SM_CYSCREEN);
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    screen_width / 2,
                    0,
                    screen_width / 2,
                    screen_height,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
            "snap_center" => {
                let screen_width = GetSystemMetrics(SM_CXSCREEN);
                let screen_height = GetSystemMetrics(SM_CYSCREEN);
                let mut rect = windows::Win32::Foundation::RECT::default();
                if GetWindowRect(hwnd, &mut rect).is_ok() {
                    let win_width = rect.right - rect.left;
                    let win_height = rect.bottom - rect.top;
                    let x = (screen_width - win_width) / 2;
                    let y = (screen_height - win_height) / 2;
                    let _ = SetWindowPos(
                        hwnd,
                        None,
                        x,
                        y,
                        win_width,
                        win_height,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                }
            }
            "minimize" => {
                let _ = ShowWindow(hwnd, SW_MINIMIZE);
            }
            "maximize" => {
                let _ = ShowWindow(hwnd, SW_MAXIMIZE);
            }
            "close" => {
                let _ = SendMessageW(hwnd, WM_CLOSE, Some(WPARAM(0)), Some(LPARAM(0)));
            }
            _ => {}
        }
    }
}

pub fn launch_app(path: &str) {
    #[cfg(target_os = "windows")]
    unsafe {
        let op = HSTRING::from("open");
        let file = HSTRING::from(path);
        let _ = ShellExecuteW(None, &op, &file, None, None, SW_SHOWNORMAL);
    }
}

pub fn sleep_pc() {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
        let _ = ShellExecuteW(
            None,
            w!("open"),
            w!("rundll32.exe"),
            w!("powrprof.dll,SetSuspendState 0,1,0"),
            None,
            SW_HIDE,
        );
    }
}

pub fn monitor_off() {
    #[cfg(target_os = "windows")]
    unsafe {
        const SC_MONITORPOWER: usize = 0xF170;
        let _ = SendMessageW(
            HWND_BROADCAST,
            WM_SYSCOMMAND,
            Some(WPARAM(SC_MONITORPOWER)),
            Some(LPARAM(2)),
        );
    }
}
