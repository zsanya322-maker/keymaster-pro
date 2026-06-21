#[cfg(target_os = "windows")]
use windows::core::{w, HSTRING, BOOL};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{LPARAM, WPARAM, HWND};
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

/// Поднять окно указанного процесса поверх всех окон.
///
/// `process` — очищенное имя процесса (без .exe, lowercase). Сравнение case-insensitive
/// через clean_process_name. Ищет первое видимое top-level окно, принадлежащее этому процессу,
/// восстанавливает его (если свёрнуто) и поднимает в foreground.
///
/// Использует SetForegroundWindow + AllowSetForegroundWindow, что покрывает большинство
/// обычных приложений. Для некоторых UWP/защищённых процессов может потребоваться UAC.
pub fn focus_process(process: &str) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, IsWindowVisible, GetWindowThreadProcessId, ShowWindow,
            SetForegroundWindow, AllowSetForegroundWindow, SW_RESTORE,
        };

        let target = crate::shared::clean_process_name(process);
        if target.is_empty() {
            return;
        }

        // PID целевого процесса. Берём первый подходящий — в системе может быть
        // несколько процессов с одним именем (например, несколько chrome.exe);
        // поднимаем окно первого найденного.
        //
        // EnumWindows принимает fn pointer (не замыкание), поэтому передаём target
        // и накопленный результат через thread_local.
        thread_local! {
            static TARGET_PROCESS: std::cell::RefCell<String> = std::cell::RefCell::new(String::new());
            static FOUND: std::cell::RefCell<Option<HWND>> = const { std::cell::RefCell::new(None) };
        }

        FOUND.with(|f| *f.borrow_mut() = None);
        TARGET_PROCESS.with(|t| *t.borrow_mut() = target.clone());

        // Callback для EnumWindows — без захвата, как требует WinAPI.
        unsafe extern "system" fn enum_callback(hwnd: HWND, _: LPARAM) -> BOOL {
            unsafe {
                if !IsWindowVisible(hwnd).as_bool() {
                    return BOOL(1); // пропускаем невидимые
                }
                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid == 0 {
                    return BOOL(1);
                }
                let matched = TARGET_PROCESS.with(|t| {
                    let target = t.borrow();
                    if let Some(name) = process_name_by_pid(pid) {
                        crate::shared::clean_process_name(&name) == *target
                    } else {
                        false
                    }
                });
                if matched {
                    FOUND.with(|f| *f.borrow_mut() = Some(hwnd));
                    BOOL(0) // нашли — стоп
                } else {
                    BOOL(1) // продолжаем
                }
            }
        }

        let _ = EnumWindows(Some(enum_callback), LPARAM(0));

        if let Some(hwnd) = FOUND.with(|f| *f.borrow()) {
            // Снимаем свёрнутое состояние, если окно было minimize.
            let _ = ShowWindow(hwnd, SW_RESTORE);
            // Разрешаем foreground-переключение из текущего контекста.
            let _ = AllowSetForegroundWindow(0xFFFFFFFF);
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

/// Получить имя исполняемого файла процесса по PID (без пути, с .exe).
#[cfg(target_os = "windows")]
fn process_name_by_pid(pid: u32) -> Option<String> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::Foundation::CloseHandle;

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut result = None;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32ProcessID == pid {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    result = Some(String::from_utf16_lossy(&entry.szExeFile[..len]));
                    break;
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        result
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
