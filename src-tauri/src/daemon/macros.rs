use std::time::Duration;
use tokio::time::sleep;
use tracing::{info, warn};

use crate::daemon::state::DaemonStateRef;

#[cfg(target_os = "windows")]
fn synth_mouse_event(flags: u32, dx: i32, dy: i32, mouse_data: u32) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_TYPE, MOUSEINPUT, MOUSE_EVENT_FLAGS};
    let input = INPUT {
        r#type: INPUT_TYPE(0), // INPUT_MOUSE
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: mouse_data,
                dwFlags: MOUSE_EVENT_FLAGS(flags),
                time: 0,
                dwExtraInfo: 0,
            }
        }
    };
    unsafe {
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn synth_mouse_event(_flags: u32, _dx: i32, _dy: i32, _mouse_data: u32) {}

#[cfg(target_os = "windows")]
fn activate_process_window(target_process: &str) {
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE};
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};

    let mut target_pid = None;
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if let Ok(h) = snapshot {
            let mut pe = PROCESSENTRY32W::default();
            pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(h, &mut pe).is_ok() {
                loop {
                    let name = String::from_utf16_lossy(&pe.szExeFile);
                    let clean_name = name.trim_matches('\0').to_lowercase();
                    if clean_name == target_process.to_lowercase() {
                        target_pid = Some(pe.th32ProcessID);
                        break;
                    }
                    if Process32NextW(h, &mut pe).is_err() {
                        break;
                    }
                }
            }
            let _ = windows::Win32::Foundation::CloseHandle(h);
        }
    }

    if let Some(pid) = target_pid {
        struct EnumData {
            pid: u32,
            hwnd: Option<HWND>,
        }
        
        unsafe extern "system" fn enum_window_callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
            unsafe {
                let data = &mut *(lparam.0 as *mut EnumData);
                let mut window_pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
                if window_pid == data.pid && IsWindowVisible(hwnd).as_bool() {
                    data.hwnd = Some(hwnd);
                    return false.into();
                }
                true.into()
            }
        }

        let mut data = EnumData { pid, hwnd: None };
        unsafe {
            let _ = EnumWindows(Some(enum_window_callback), LPARAM(&mut data as *mut EnumData as isize));
            if let Some(hwnd) = data.hwnd {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn activate_process_window(_target_process: &str) {}

/// Capture the current mouse cursor position (for restoring it after playback).
#[cfg(target_os = "windows")]
fn get_cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT { x: 0, y: 0 };
    unsafe {
        if GetCursorPos(&mut pt).is_ok() {
            Some((pt.x, pt.y))
        } else {
            None
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn get_cursor_pos() -> Option<(i32, i32)> {
    None
}

/// Асинхронный движок воспроизведения макроса
pub async fn play_macro(macro_id: &str, state: &DaemonStateRef) -> Result<(), String> {
    // Find macro in active profile + read the mouse-restore setting up front
    let (m, restore_mouse) = {
        let s = state.read().map_err(|_| "Failed to lock state")?;
        let m = s.active_profile.as_ref()
            .and_then(|p| p.macros.iter().find(|m| m.id == macro_id).cloned());
        (m, s.restore_mouse_after_macro)
    };

    if let Some(m) = m {
        info!("Play macro: {}", m.name);

        // Run macro execution in separate task to avoid blocking the daemon
        tokio::spawn(async move {
            // Snapshot cursor position before any playback (even before target-app switch)
            let saved_cursor = get_cursor_pos();

            if let Some(ref target) = m.target_app {
                if !target.is_empty() {
                    info!("Activating target process before playback: {}", target);
                    activate_process_window(target);
                    sleep(Duration::from_millis(300)).await;
                }
            }

            for step in m.steps {
                match step.action_type.as_str() {
                    "delay" => {
                        let ms = if step.value.is_number() {
                            step.value.as_u64().unwrap_or(0)
                        } else if step.value.is_string() {
                            step.value.as_str().unwrap_or("0").parse::<u64>().unwrap_or(0)
                        } else {
                            0
                        };
                        if ms > 0 {
                            info!("  ⏳ Пауза {} мс", ms);
                            sleep(Duration::from_millis(ms)).await;
                        }
                    }
                    "key_down" => {
                        let key = step.value.as_str().unwrap_or("?");
                        info!("  ↓ Нажатие клавиши: {}", key);
                        if let Some(vk) = crate::daemon::engine::key_name_to_vk(key) {
                            crate::daemon::hooks::synth_key(vk, 0, true);
                        }
                    }
                    "key_up" => {
                        let key = step.value.as_str().unwrap_or("?");
                        info!("  ↑ Отпускание клавиши: {}", key);
                        if let Some(vk) = crate::daemon::engine::key_name_to_vk(key) {
                            crate::daemon::hooks::synth_key(vk, 0, false);
                        }
                    }
                    "mouse_click" => {
                        let btn = step.value.as_str().unwrap_or("?");
                        info!("  🖱 Клик мышью: {}", btn);
                        let (down_flag, up_flag, mouse_data) = match btn.to_lowercase().as_str() {
                            "left" => (0x0002, 0x0004, 0), // MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP
                            "right" => (0x0008, 0x0010, 0), // MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP
                            "middle" => (0x0020, 0x0040, 0), // MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEDOWN
                            "xbutton1" | "back" => (0x0080, 0x0100, 1), // MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP with mouseData = 1
                            "xbutton2" | "forward" => (0x0080, 0x0100, 2), // MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP with mouseData = 2
                            _ => (0, 0, 0)
                        };
                        if down_flag != 0 {
                            synth_mouse_event(down_flag, 0, 0, mouse_data);
                            sleep(Duration::from_millis(10)).await;
                            synth_mouse_event(up_flag, 0, 0, mouse_data);
                        }
                    }
                    "mouse_move" => {
                        let val = step.value.as_str().unwrap_or("0,0");
                        info!("  🖱 Перемещение мыши: {}", val);
                        let parts: Vec<&str> = val.split(',').collect();
                        if parts.len() == 2 {
                            let x = parts[0].trim().parse::<i32>().unwrap_or(0);
                            let y = parts[1].trim().parse::<i32>().unwrap_or(0);
                            #[cfg(target_os = "windows")]
                            unsafe {
                                let _ = windows::Win32::UI::WindowsAndMessaging::SetCursorPos(x, y);
                            }
                        }
                    }
                    _ => warn!("Неизвестный шаг макроса: {}", step.action_type),
                }
            }
            
            // Safety measure: release modifier keys to prevent them from getting stuck
            crate::daemon::hooks::synth_key(0x11, 0, false); // VK_CONTROL
            crate::daemon::hooks::synth_key(0x12, 0, false); // VK_MENU (Alt)
            crate::daemon::hooks::synth_key(0x10, 0, false); // VK_SHIFT
            crate::daemon::hooks::synth_key(0x5B, 0, false); // VK_LWIN

            // Restore cursor to where it was before the macro ran (so the mouse doesn't
            // stay on whatever the last mouse_move/click step left it on).
            if restore_mouse {
                if let Some((x, y)) = saved_cursor {
                    #[cfg(target_os = "windows")]
                    unsafe {
                        let _ = windows::Win32::UI::WindowsAndMessaging::SetCursorPos(x, y);
                    }
                    info!("🖱 Курсор восстановлен в позицию ({}, {})", x, y);
                }
            }

            info!("⏹ Макрос {} завершен", m.name);
        });
        Ok(())
    } else {
        Err("Макрос не найден".to_string())
    }
}