use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, RwLock};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextExpansion {
    pub id: String,
    #[serde(rename = "profileId")]
    pub profile_id: String,
    pub trigger: String,
    pub replacement: String,
    pub enabled: bool,
}

// Глобальный буфер ввода для отслеживания набора текста
static INPUT_BUFFER: LazyLock<RwLock<String>> = LazyLock::new(|| RwLock::new(String::new()));
// Флаг зажатого Shift
static SHIFT_HELD: LazyLock<RwLock<bool>> = LazyLock::new(|| RwLock::new(false));

/// Преобразовать виртуальный код клавиши в символ с учетом Shift
#[cfg(target_os = "windows")]
fn vk_to_char(vk: u8, scan_code: u16) -> Option<char> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardLayout, GetKeyState, GetAsyncKeyState, ToUnicodeEx,
        VK_SHIFT, VK_CAPITAL, VK_CONTROL, VK_MENU
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        let thread_id = GetWindowThreadProcessId(hwnd, None);
        let hkl = GetKeyboardLayout(thread_id);

        let mut key_state = [0u8; 256];

        // Shift key
        if GetAsyncKeyState(VK_SHIFT.0 as i32) < 0 {
            key_state[VK_SHIFT.0 as usize] = 0x80;
        }

        // Caps Lock toggle
        if (GetKeyState(VK_CAPITAL.0 as i32) & 1) != 0 {
            key_state[VK_CAPITAL.0 as usize] = 0x01;
        }

        // Control key
        if GetAsyncKeyState(VK_CONTROL.0 as i32) < 0 {
            key_state[VK_CONTROL.0 as usize] = 0x80;
        }

        // Menu key (Alt)
        if GetAsyncKeyState(VK_MENU.0 as i32) < 0 {
            key_state[VK_MENU.0 as usize] = 0x80;
        }

        let mut buf = [0u16; 4];
        let len = ToUnicodeEx(
            vk as u32,
            scan_code as u32,
            &key_state,
            &mut buf,
            0,
            Some(hkl),
        );

        if len > 0 {
            let text = String::from_utf16_lossy(&buf[..len as usize]);
            text.chars().next()
        } else {
            None
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn vk_to_char(vk: u8, _scan_code: u16) -> Option<char> {
    let shift = SHIFT_HELD.read().map(|guard| *guard).unwrap_or(false);
    match vk {
        // Буквы A-Z
        0x41..=0x5A => {
            let base = if shift { 'A' } else { 'a' };
            Some((base as u8 + (vk - 0x41)) as char)
        }
        // Цифры 0-9
        0x30..=0x39 => {
            if shift {
                match vk {
                    0x31 => Some('!'),
                    0x32 => Some('@'),
                    0x33 => Some('#'),
                    0x34 => Some('$'),
                    0x35 => Some('%'),
                    0x36 => Some('^'),
                    0x37 => Some('&'),
                    0x38 => Some('*'),
                    0x39 => Some('('),
                    0x30 => Some(')'),
                    _ => None,
                }
            } else {
                Some(('0' as u8 + (vk - 0x30)) as char)
            }
        }
        // Пробел
        0x20 => Some(' '),
        // OEM знаки препинания
        0xBD => Some(if shift { '_' } else { '-' }),
        0xBB => Some(if shift { '+' } else { '=' }),
        0xDB => Some(if shift { '{' } else { '[' }),
        0xDD => Some(if shift { '}' } else { ']' }),
        0xDC => Some(if shift { '|' } else { '\\' }),
        0xBA => Some(if shift { ':' } else { ';' }),
        0xDE => Some(if shift { '"' } else { '\'' }),
        0xBC => Some(if shift { '<' } else { ',' }),
        0xBE => Some(if shift { '>' } else { '.' }),
        0xBF => Some(if shift { '?' } else { '/' }),
        0xC0 => Some(if shift { '~' } else { '`' }),
        _ => None,
    }
}

/// Получить текущую дату в формате YYYY-MM-DD
fn chrono_date_now() -> String {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        let st = unsafe { GetLocalTime() };
        format!("{:04}-{:02}-{:02}", st.wYear, st.wMonth, st.wDay)
    }
    #[cfg(not(target_os = "windows"))]
    {
        "2026-06-12".to_string()
    }
}

/// Получить текущее время в формате HH:MM:SS
fn chrono_time_now() -> String {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        let st = unsafe { GetLocalTime() };
        format!("{:02}:{:02}:{:02}", st.wHour, st.wMinute, st.wSecond)
    }
    #[cfg(not(target_os = "windows"))]
    {
        "12:00:00".to_string()
    }
}

/// Get text from Windows clipboard
#[cfg(target_os = "windows")]
fn get_clipboard_text() -> Result<String, String> {
    use windows::Win32::System::DataExchange::{OpenClipboard, CloseClipboard, GetClipboardData};
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    unsafe {
        if !OpenClipboard(None).is_ok() {
            return Err("Failed to open clipboard".to_string());
        }
        let handle = match GetClipboardData(13) { // CF_UNICODETEXT
            Ok(h) => h,
            Err(_) => {
                let _ = CloseClipboard();
                return Err("Failed to get clipboard data".to_string());
            }
        };
        let h_data = handle.0;
        if h_data.is_null() {
            let _ = CloseClipboard();
            return Ok("".to_string());
        }
        let ptr = GlobalLock(windows::Win32::Foundation::HGLOBAL(h_data));
        if ptr.is_null() {
            let _ = CloseClipboard();
            return Err("GlobalLock failed".to_string());
        }
        let slice = std::slice::from_raw_parts(ptr as *const u16, 2048);
        let len = slice.iter().position(|&c| c == 0).unwrap_or(2048);
        let text = String::from_utf16_lossy(&slice[..len]);
        let _ = GlobalUnlock(windows::Win32::Foundation::HGLOBAL(h_data));
        let _ = CloseClipboard();
        Ok(text)
    }
}

#[cfg(not(target_os = "windows"))]
fn get_clipboard_text() -> Result<String, String> {
    Ok("".to_string())
}

/// Write text to Windows clipboard
#[cfg(target_os = "windows")]
fn set_clipboard_text(text: &str) {
    use windows::Win32::System::DataExchange::{OpenClipboard, EmptyClipboard, CloseClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    
    let u16_data: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let size = u16_data.len() * 2;
    
    unsafe {
        if !OpenClipboard(None).is_ok() { return; }
        let _ = EmptyClipboard();
        
        if let Ok(h_mem) = GlobalAlloc(GMEM_MOVEABLE, size) {
            let ptr = GlobalLock(h_mem);
            if !ptr.is_null() {
                std::ptr::copy_nonoverlapping(u16_data.as_ptr(), ptr as *mut u16, u16_data.len());
                let _ = GlobalUnlock(h_mem);
                let _ = SetClipboardData(13, Some(windows::Win32::Foundation::HANDLE(h_mem.0)));
            }
        }
        let _ = CloseClipboard();
    }
}

#[cfg(not(target_os = "windows"))]
fn set_clipboard_text(_text: &str) {}

/// Get selected text by simulating Ctrl+C
fn get_selected_text_via_clipboard() -> Result<String, String> {
    // Save current clipboard content
    let old_clip = get_clipboard_text().unwrap_or_default();
    
    // Simulate Ctrl+C
    crate::daemon::hooks::synth_key(0x11, 0, true); // Ctrl down
    crate::daemon::hooks::synth_key(0x43, 0, true); // C down
    crate::daemon::hooks::synth_key(0x43, 0, false); // C up
    crate::daemon::hooks::synth_key(0x11, 0, false); // Ctrl up
    
    // Wait for clipboard to update
    std::thread::sleep(std::time::Duration::from_millis(150));
    
    // Read the copied text
    let selected = get_clipboard_text().unwrap_or_default();
    
    // Restore original clipboard content
    set_clipboard_text(&old_clip);
    
    Ok(selected)
}

/// Reset input buffer
pub fn clear_buffer() {
    if let Ok(mut buf) = INPUT_BUFFER.write() {
        buf.clear();
    }
}

/// Asynchronously execute expansion in background thread
pub async fn execute_expansion(trigger_len: usize, raw_replacement: String) {
    // Resolve templates
    let mut replacement = raw_replacement;
    if replacement.contains("%date%") {
        replacement = replacement.replace("%date%", &chrono_date_now());
    }
    if replacement.contains("%time%") {
        replacement = replacement.replace("%time%", &chrono_time_now());
    }
    if replacement.contains("%clipboard%") {
        replacement = replacement.replace("%clipboard%", &get_clipboard_text().unwrap_or_default());
    }
    if replacement.contains("%selected_text%") {
        replacement = replacement.replace("%selected_text%", &get_selected_text_via_clipboard().unwrap_or_default());
    }

    // Erase trigger using backspaces
    for _ in 0..trigger_len {
        crate::daemon::hooks::synth_key(0x08, 0, true);  // Backspace down
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        crate::daemon::hooks::synth_key(0x08, 0, false); // Backspace up
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }

    // Synthesize replacement text
    crate::daemon::hooks::synth_unicode_string(&replacement);
}

/// Обработать событие нажатия клавиши в буфере с использованием переданного списка автотекстов.
pub fn process_key_with_expansions(
    vk: u8,
    scan_code: u16,
    is_down: bool,
    expansions: &[crate::shared::types::TextExpansion],
) -> Option<(usize, String)> {
    // Отслеживаем состояние Shift (VK_SHIFT, VK_LSHIFT, VK_RSHIFT)
    if vk == 0x10 || vk == 0xA0 || vk == 0xA1 {
        if let Ok(mut shift) = SHIFT_HELD.write() {
            *shift = is_down;
        }
        return None;
    }

    if !is_down {
        return None;
    }

    // Обработка Backspace (стираем символ из буфера)
    if vk == 0x08 {
        if let Ok(mut buf) = INPUT_BUFFER.write() {
            buf.pop();
        }
        return None;
    }

    // Клавиши сброса буфера (Enter, Escape, Tab, Ctrl/Alt команды)
    if vk == 0x0D || vk == 0x1B || vk == 0x09 {
        if let Ok(mut buf) = INPUT_BUFFER.write() {
            buf.clear();
        }
        return None;
    }

    if let Some(ch) = vk_to_char(vk, scan_code) {
        let mut buf_clone = String::new();
        if let Ok(mut buf) = INPUT_BUFFER.write() {
            buf.push(ch);
            if buf.len() > 50 {
                buf.remove(0);
            }
            buf_clone = buf.clone();
        }

        // Проверяем буфер на совпадение с триггерами
        for te in expansions {
            if te.enabled && buf_clone.ends_with(&te.trigger) {
                // Очищаем буфер
                if let Ok(mut buf) = INPUT_BUFFER.write() {
                    buf.clear();
                }
                
                info!("Текстовый триггер автозамены сработал: '{}'", te.trigger);
                return Some((te.trigger.len(), te.replacement.clone()));
            }
        }
    }

    None
}
