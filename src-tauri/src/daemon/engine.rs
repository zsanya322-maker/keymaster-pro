use std::collections::HashMap;
use std::sync::{Mutex, LazyLock};
use std::time::{Instant, Duration};
use tracing::info;

use crate::daemon::state::DaemonStateRef;

/// Тип результата обработки события
#[derive(Debug)]
pub enum EventAction {
    PassThrough,
    Block,
    Replace { actions: Vec<SynthAction> },
}

/// Синтезированное действие (SendInput)
#[derive(Debug, Clone)]
pub enum SynthAction {
    KeyPress { vk: u8, scan: u16 },
    KeyRelease { vk: u8, scan: u16 },
    MouseClick { button: u8, x: i32, y: i32 },
    MouseMove { x: i32, y: i32 },
    Scroll { delta: i32 },
    Delay { ms: u64 },
    UnicodeString { text: String },
}

// Отслеживание времени кликов для Long Press и Double Press
struct KeyPressInfo {
    down_time: Instant,
    last_up_time: Option<Instant>,
}

static KEY_STATES: LazyLock<Mutex<HashMap<u8, KeyPressInfo>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn extract_combo(action_str: &str) -> &str {
    if let Some(start) = action_str.find('(') {
        if let Some(end) = action_str.rfind(')') {
            if end > start {
                return &action_str[start + 1..end];
            }
        }
    }
    action_str
}

pub fn key_name_to_vk(key: &str) -> Option<u8> {
    let key_lower = key.to_lowercase();
    match key_lower.as_str() {
        "caps lock" | "capslock" => Some(0x14), // VK_CAPITAL
        "escape" | "esc" => Some(0x1B), // VK_ESCAPE
        "space" => Some(0x20), // VK_SPACE
        "enter" | "return" => Some(0x0D), // VK_RETURN
        "backspace" => Some(0x08), // VK_BACK
        "tab" => Some(0x09), // VK_TAB
        "delete" | "del" => Some(0x2E), // VK_DELETE
        "insert" | "ins" => Some(0x2D), // VK_INSERT
        "page up" | "pageup" | "pgup" => Some(0x21), // VK_PRIOR
        "page down" | "pagedown" | "pgdn" => Some(0x22), // VK_NEXT
        "end" => Some(0x23), // VK_END
        "home" => Some(0x24), // VK_HOME
        "left" => Some(0x25), // VK_LEFT
        "up" => Some(0x26), // VK_UP
        "right" => Some(0x27), // VK_RIGHT
        "down" => Some(0x28), // VK_DOWN
        "mute" => Some(0xAD), // VK_VOLUME_MUTE
        "volumedown" | "volume down" => Some(0xAE), // VK_VOLUME_DOWN
        "volumeup" | "volume up" => Some(0xAF), // VK_VOLUME_UP
        "lalt" | "alt" => Some(0x12), // VK_MENU
        "ralt" => Some(0xA5), // VK_RMENU
        "lctrl" | "ctrl" | "control" => Some(0x11), // VK_CONTROL
        "rctrl" => Some(0xA3), // VK_RCONTROL
        "lshift" | "shift" => Some(0x10), // VK_SHIFT
        "rshift" => Some(0xA1), // VK_RSHIFT
        "lwin" | "win" | "super" => Some(0x5B), // VK_LWIN
        "rwin" => Some(0x5C), // VK_RWIN
        "f1" => Some(0x70),
        "f2" => Some(0x71),
        "f3" => Some(0x72),
        "f4" => Some(0x73),
        "f5" => Some(0x74),
        "f6" => Some(0x75),
        "f7" => Some(0x76),
        "f8" => Some(0x77),
        "f9" => Some(0x78),
        "f10" => Some(0x79),
        "f11" => Some(0x7A),
        "f12" => Some(0x7B),
        s if s.starts_with("vk_") || s.starts_with("vk") => {
            let num_str = if s.starts_with("vk_") { &s[3..] } else { &s[2..] };
            num_str.parse::<u8>().ok()
        }
        s if s.len() == 1 => {
            let c = s.chars().next()?;
            if c >= 'a' && c <= 'z' {
                Some(c as u8 - b'a' + 0x41)
            } else if c >= 'A' && c <= 'Z' {
                Some(c as u8 - b'A' + 0x41)
            } else if c >= '0' && c <= '9' {
                Some(c as u8)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn mouse_name_to_button(btn: &str) -> Option<u8> {
    let btn_lower = btn.to_lowercase();
    match btn_lower.as_str() {
        "left" | "leftbutton" | "left button" => Some(0),
        "right" | "rightbutton" | "right button" => Some(1),
        "middle" | "middlebutton" | "middle button" => Some(2),
        "xbutton1" | "xbutton 1" | "xbutton 1 (back)" | "back" => Some(3),
        "xbutton2" | "xbutton 2" | "xbutton 2 (forward)" | "forward" => Some(4),
        _ => None,
    }
}

fn handle_special_action(action_str: &str, state: Option<&DaemonStateRef>) -> EventAction {
    let trimmed = action_str.trim();
    
    // macro(id) or macro:id
    if trimmed.starts_with("macro:") || (trimmed.starts_with("macro(") && trimmed.ends_with(')')) {
        let macro_id = if trimmed.starts_with("macro:") {
            trimmed[6..].to_string()
        } else {
            trimmed[6..trimmed.len() - 1].to_string()
        };
        if let Some(state_ref) = state {
            let state_clone = state_ref.clone();
            crate::daemon::runner::spawn_on_runtime(async move {
                let _ = crate::daemon::macros::play_macro(&macro_id, &state_clone).await;
            });
        }
        return EventAction::Block;
    }
    
    // paste(text)
    if trimmed.starts_with("paste(") && trimmed.ends_with(')') {
        let mut text = &trimmed[6..trimmed.len() - 1];
        if (text.starts_with('"') && text.ends_with('"')) || (text.starts_with('\'') && text.ends_with('\'')) {
            text = &text[1..text.len() - 1];
        }
        return EventAction::Replace {
            actions: vec![SynthAction::UnicodeString { text: text.to_string() }]
        };
    }
    
    // launch(path)
    if trimmed.starts_with("launch(") && trimmed.ends_with(')') {
        let path = &trimmed[7..trimmed.len() - 1];
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::core::HSTRING;
            use windows::Win32::UI::Shell::ShellExecuteW;
            use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
            let op = HSTRING::from("open");
            let file = HSTRING::from(path);
            let _ = ShellExecuteW(None, &op, &file, None, None, SW_SHOWNORMAL);
        }
        return EventAction::Block;
    }

    let action_clean = extract_combo(action_str).trim();
    let action_lower = action_clean.to_lowercase();
    
    match action_lower.as_str() {
        "volume_up" | "volume up" => {
            EventAction::Replace {
                actions: vec![
                    SynthAction::KeyPress { vk: 0xAF, scan: 0 },
                    SynthAction::KeyRelease { vk: 0xAF, scan: 0 },
                ]
            }
        }
        "volume_down" | "volume down" => {
            EventAction::Replace {
                actions: vec![
                    SynthAction::KeyPress { vk: 0xAE, scan: 0 },
                    SynthAction::KeyRelease { vk: 0xAE, scan: 0 },
                ]
            }
        }
        "volume_mute" | "volume mute" | "mute" => {
            EventAction::Replace {
                actions: vec![
                    SynthAction::KeyPress { vk: 0xAD, scan: 0 },
                    SynthAction::KeyRelease { vk: 0xAD, scan: 0 },
                ]
            }
        }
        "monitor_off" | "monitor off" => {
            #[cfg(target_os = "windows")]
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, HWND_BROADCAST, WM_SYSCOMMAND};
                use windows::Win32::Foundation::{WPARAM, LPARAM};
                const SC_MONITORPOWER: usize = 0xF170;
                let _ = SendMessageW(HWND_BROADCAST, WM_SYSCOMMAND, Some(WPARAM(SC_MONITORPOWER)), Some(LPARAM(2)));
            }
            EventAction::Block
        }
        "screensaver" | "screen saver" => {
            #[cfg(target_os = "windows")]
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, HWND_BROADCAST, WM_SYSCOMMAND};
                use windows::Win32::Foundation::{WPARAM, LPARAM};
                const SC_SCREENSAVE: usize = 0xF140;
                let _ = SendMessageW(HWND_BROADCAST, WM_SYSCOMMAND, Some(WPARAM(SC_SCREENSAVE)), Some(LPARAM(0)));
            }
            EventAction::Block
        }
        "close_window" | "close window" => {
            #[cfg(target_os = "windows")]
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, GetForegroundWindow, WM_CLOSE};
                use windows::Win32::Foundation::{WPARAM, LPARAM};
                let hwnd = GetForegroundWindow();
                if !hwnd.is_invalid() {
                    let _ = SendMessageW(hwnd, WM_CLOSE, Some(WPARAM(0)), Some(LPARAM(0)));
                }
            }
            EventAction::Block
        }
        "minimize_window" | "minimize window" => {
            #[cfg(target_os = "windows")]
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, GetForegroundWindow, SW_MINIMIZE};
                let hwnd = GetForegroundWindow();
                if !hwnd.is_invalid() {
                    let _ = ShowWindow(hwnd, SW_MINIMIZE);
                }
            }
            EventAction::Block
        }
        "maximize_window" | "maximize window" => {
            #[cfg(target_os = "windows")]
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, GetForegroundWindow, SW_MAXIMIZE};
                let hwnd = GetForegroundWindow();
                if !hwnd.is_invalid() {
                    let _ = ShowWindow(hwnd, SW_MAXIMIZE);
                }
            }
            EventAction::Block
        }
        "window_left" | "window left" => {
            #[cfg(target_os = "windows")]
            snap_window_left();
            EventAction::Block
        }
        "window_right" | "window right" => {
            #[cfg(target_os = "windows")]
            snap_window_right();
            EventAction::Block
        }
        "window_center" | "window center" => {
            #[cfg(target_os = "windows")]
            center_window();
            EventAction::Block
        }
        "media_play" | "media play" | "media_play_pause" => {
            EventAction::Replace {
                actions: vec![
                    SynthAction::KeyPress { vk: 0xB3, scan: 0 },
                    SynthAction::KeyRelease { vk: 0xB3, scan: 0 },
                ]
            }
        }
        "media_next" | "media next" => {
            EventAction::Replace {
                actions: vec![
                    SynthAction::KeyPress { vk: 0xB0, scan: 0 },
                    SynthAction::KeyRelease { vk: 0xB0, scan: 0 },
                ]
            }
        }
        "media_prev" | "media prev" => {
            EventAction::Replace {
                actions: vec![
                    SynthAction::KeyPress { vk: 0xB1, scan: 0 },
                    SynthAction::KeyRelease { vk: 0xB1, scan: 0 },
                ]
            }
        }
        "sleep" => {
            #[cfg(target_os = "windows")]
            unsafe {
                use windows::core::w;
                use windows::Win32::UI::Shell::ShellExecuteW;
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
            EventAction::Block
        }
        _ => {
            // Launch Action fallback
            if action_clean.starts_with("http://") || action_clean.starts_with("https://") || action_clean.contains(":\\") || action_clean.starts_with("/") {
                #[cfg(target_os = "windows")]
                unsafe {
                    use windows::core::HSTRING;
                    use windows::Win32::UI::Shell::ShellExecuteW;
                    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
                    
                    let op = HSTRING::from("open");
                    let file = HSTRING::from(action_clean);
                    let _ = ShellExecuteW(
                        None,
                        &op,
                        &file,
                        None,
                        None,
                        SW_SHOWNORMAL,
                    );
                }
                return EventAction::Block;
            }
            
            // Single key or key combination
            if let Some(dest_vk) = key_name_to_vk(action_clean) {
                return EventAction::Replace {
                    actions: vec![
                        SynthAction::KeyPress { vk: dest_vk, scan: 0 },
                        SynthAction::KeyRelease { vk: dest_vk, scan: 0 },
                    ]
                };
            }
            
            if action_clean.contains('+') {
                let parts: Vec<&str> = action_clean.split('+').map(|s| s.trim()).collect();
                let mut vks = Vec::new();
                for part in parts {
                    if let Some(vk) = key_name_to_vk(part) {
                        vks.push(vk);
                    }
                }
                if !vks.is_empty() {
                    let mut actions = Vec::new();
                    for &vk in &vks {
                        actions.push(SynthAction::KeyPress { vk, scan: 0 });
                    }
                    for &vk in vks.iter().rev() {
                        actions.push(SynthAction::KeyRelease { vk, scan: 0 });
                    }
                    return EventAction::Replace { actions };
                }
            }
            
            EventAction::PassThrough
        }
    }
}

pub fn process_keyboard_event(
    vk_code: u8,
    _scan_code: u16,
    is_key_down: bool,
    _flags: u32,
    state: Option<&DaemonStateRef>,
) -> EventAction {
    let state_ref = match state {
        Some(s) => s,
        None => return EventAction::PassThrough,
    };

    // Проверяем, включены ли хуки клавиатуры в состоянии
    {
        if let Ok(s) = state_ref.read() {
            if !s.kb_hook_enabled {
                return EventAction::PassThrough;
            }
        }
    }

    // Get active profile
    let active_profile = {
        let s = match state_ref.read() {
            Ok(s) => s,
            Err(_) => return EventAction::PassThrough,
        };
        s.active_profile.clone()
    };

    let profile = match active_profile {
        Some(p) => p,
        None => return EventAction::PassThrough,
    };

    // Get active process name and window title
    let (active_process, window_title) = get_active_window_info();
    
    tracing::debug!("process_keyboard_event: vk={}, is_down={}, process='{}', title='{}'", vk_code, is_key_down, active_process, window_title);
    
    // Determine active layers
    let mut active_layers = Vec::new();
    
    for layer in &profile.layers {
        if is_layer_active(layer, &active_process, &window_title) {
            active_layers.push(layer.id.clone());
        }
    }
    
    // Sort layers by priority (highest first)
    let mut layers_sorted = profile.layers.clone();
    layers_sorted.retain(|l| active_layers.contains(&l.id));
    layers_sorted.sort_by(|a, b| b.priority.cmp(&a.priority));
    
    // Create ordered search list for layers
    let mut layer_search_order: Vec<Option<String>> = layers_sorted.iter().map(|l| Some(l.id.clone())).collect();
    layer_search_order.push(None); // Base layer (None) is checked last
    layer_search_order.push(Some("".to_string())); // Or empty string
    layer_search_order.push(Some("base".to_string())); // Or "base"

    // Check macro triggers in active layers or globally
    for mac in &profile.macros {
        // Проверяем ограничение раскладки клавиатуры
        if let Some(ref layout_req) = mac.trigger_layout {
            if layout_req != "any" && !layout_req.is_empty() {
                let current_lang = get_active_layout_lang();
                if current_lang != *layout_req {
                    continue; // раскладка не совпадает
                }
            }
        }

        if check_combo_match(&mac.trigger_key, vk_code) {
            let trigger_type = mac.trigger_type.as_deref().unwrap_or("single");
            let trigger_time = mac.trigger_time.unwrap_or(if trigger_type == "long_press" { 450 } else { 300 });

            match trigger_type {
                "single" | "combo" => {
                    if is_key_down {
                        info!("Клавиатурный триггер совпал с макросом '{}' (триггер: {})", mac.name, mac.trigger_key);
                        let macro_id = mac.id.clone();
                        let state_clone = state_ref.clone();
                        crate::daemon::runner::spawn_on_runtime(async move {
                            let _ = crate::daemon::macros::play_macro(&macro_id, &state_clone).await;
                        });
                    }
                    return EventAction::Block;
                }
                "double_press" => {
                    if is_key_down {
                        let mut is_double = false;
                        if let Ok(states) = KEY_STATES.lock() {
                            if let Some(entry) = states.get(&vk_code) {
                                if let Some(up_time) = entry.last_up_time {
                                    if up_time.elapsed() < Duration::from_millis(trigger_time as u64) {
                                        is_double = true;
                                    }
                                }
                            }
                        }
                        if is_double {
                            info!("Двойное нажатие совпало с макросом '{}' (триггер: {})", mac.name, mac.trigger_key);
                            let macro_id = mac.id.clone();
                            let state_clone = state_ref.clone();
                            crate::daemon::runner::spawn_on_runtime(async move {
                                let _ = crate::daemon::macros::play_macro(&macro_id, &state_clone).await;
                            });
                            return EventAction::Block;
                        }
                    }
                }
                "long_press" => {
                    if is_key_down {
                        let start_time = Instant::now();
                        let macro_id = mac.id.clone();
                        let state_clone = state_ref.clone();
                        let key_code_val = vk_code;
                        
                        if let Ok(mut states) = KEY_STATES.lock() {
                            let entry = states.entry(vk_code).or_insert_with(|| KeyPressInfo {
                                down_time: start_time,
                                last_up_time: None,
                            });
                            entry.down_time = start_time;
                            entry.last_up_time = None;
                        }

                        let macro_name = mac.name.clone();
                        let trigger_key = mac.trigger_key.clone();

                        crate::daemon::runner::spawn_on_runtime(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(trigger_time as u64)).await;
                            
                            let mut still_held = false;
                            if let Ok(states) = KEY_STATES.lock() {
                                if let Some(entry) = states.get(&key_code_val) {
                                    if entry.down_time == start_time && entry.last_up_time.is_none() {
                                        still_held = true;
                                    }
                                }
                            }

                            if still_held {
                                info!("Удержание совпало с макросом '{}' (триггер: {})", macro_name, trigger_key);
                                let _ = crate::daemon::macros::play_macro(&macro_id, &state_clone).await;
                            }
                        });
                        
                        return EventAction::Block;
                    } else {
                        // KeyUp
                        let mut was_short_press = false;
                        if let Ok(mut states) = KEY_STATES.lock() {
                            if let Some(entry) = states.get_mut(&vk_code) {
                                let elapsed = entry.down_time.elapsed();
                                if elapsed < Duration::from_millis(trigger_time as u64) {
                                    was_short_press = true;
                                }
                                entry.last_up_time = Some(Instant::now());
                            }
                        }

                        if was_short_press {
                            crate::daemon::runner::spawn_on_runtime(async move {
                                crate::daemon::hooks::synth_key(vk_code, 0, true);
                                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                                crate::daemon::hooks::synth_key(vk_code, 0, false);
                            });
                        }
                        
                        return EventAction::Block;
                    }
                }
                _ => {}
            }
        }
    }

    // Check text expansions
    if let Some((trigger_len, raw_replacement)) = crate::daemon::text_expansions::process_key_with_expansions(
        vk_code,
        _scan_code,
        is_key_down,
        &profile.text_expansions,
    ) {
        info!("Text expansion triggered (trigger length: {})", trigger_len);
        crate::daemon::runner::spawn_on_runtime(async move {
            crate::daemon::text_expansions::execute_expansion(trigger_len, raw_replacement).await;
        });
        return EventAction::Block;
    }

    // Handle Double Press / Long Press timings
    let mut is_double = false;
    let mut is_long = false;
    {
        if let Ok(mut times) = KEY_STATES.lock() {
            let entry = times.entry(vk_code).or_insert_with(|| KeyPressInfo {
                down_time: Instant::now(),
                last_up_time: None,
            });
            
            if is_key_down {
                if let Some(up_time) = entry.last_up_time {
                    if up_time.elapsed() < Duration::from_millis(300) {
                        is_double = true;
                    }
                }
                entry.down_time = Instant::now();
            } else {
                if entry.down_time.elapsed() > Duration::from_millis(400) {
                    is_long = true;
                }
                entry.last_up_time = Some(Instant::now());
            }
        }
    }

    if is_double {
        info!("Двойной клик на vk={}", vk_code);
    }
    if is_long {
        info!("Длинный клик на vk={}", vk_code);
    }

    // Check keyboard remaps by layer priority
    for search_layer_id in &layer_search_order {
        for rule in &profile.remaps {
            if matches_layer(search_layer_id, &rule.layer_id) {
                if check_combo_match(&rule.original_key, vk_code) {
                    info!("Ремаппинг сработал [Слой: {:?}]: {} -> {}", rule.layer_id, rule.original_key, rule.mapped_key);
                    
                    // Проверяем, является ли это специальным действием
                    let is_special = rule.mapped_key.contains('(') || 
                                     rule.mapped_key.to_lowercase().contains("volume") ||
                                     rule.mapped_key.to_lowercase().contains("mute") ||
                                     rule.mapped_key.to_lowercase().contains("monitor") ||
                                     rule.mapped_key.to_lowercase().contains("sleep") ||
                                     rule.mapped_key.to_lowercase().contains("window") ||
                                     rule.mapped_key.to_lowercase().contains("media") ||
                                     rule.mapped_key.starts_with("http") ||
                                     rule.mapped_key.contains(":\\");
                    
                    if is_special {
                        if is_key_down {
                            return handle_special_action(&rule.mapped_key, state);
                        } else {
                            return EventAction::Block;
                        }
                    }

                    // Обычный ремап клавиатуры
                    if let Some(dest_vk) = key_name_to_vk(&rule.mapped_key) {
                        let action = if is_key_down {
                            SynthAction::KeyPress { vk: dest_vk, scan: 0 }
                        } else {
                            SynthAction::KeyRelease { vk: dest_vk, scan: 0 }
                        };
                        return EventAction::Replace { actions: vec![action] };
                    }
                    
                    // Комбинация (Ctrl+C и т.д.)
                    if rule.mapped_key.contains('+') {
                        if is_key_down {
                            return handle_special_action(&rule.mapped_key, state);
                        } else {
                            return EventAction::Block;
                        }
                    }
                }
            }
        }
    }

    EventAction::PassThrough
}

pub fn process_mouse_event(
    button: u8,
    _x: i32,
    _y: i32,
    delta: i32,
    _flags: u32,
    is_down: bool,
    state: Option<&DaemonStateRef>,
) -> EventAction {
    let state_ref = match state {
        Some(s) => s,
        None => return EventAction::PassThrough,
    };

    // Проверяем, включены ли хуки мыши
    {
        if let Ok(s) = state_ref.read() {
            if !s.mouse_hook_enabled {
                return EventAction::PassThrough;
            }
        }
    }

    // Clear text expansion buffer on mouse click
    if is_down && button != 255 {
        crate::daemon::text_expansions::clear_buffer();
    }

    // Get active profile
    let active_profile = {
        let s = match state_ref.read() {
            Ok(s) => s,
            Err(_) => return EventAction::PassThrough,
        };
        s.active_profile.clone()
    };

    let profile = match active_profile {
        Some(p) => p,
        None => return EventAction::PassThrough,
    };

    // Проверяем макросы, привязанные к кнопкам мыши как триггеры
    if is_down && button != 255 {
        for mac in &profile.macros {
            if check_mouse_combo_match(&mac.trigger_key, button) {
                // Предотвращаем случайное блокирование левой кнопки мыши без модификаторов
                if button == 0 && !mac.trigger_key.contains('+') {
                    tracing::warn!("Защита: чистый клик левой кнопкой мыши не может быть триггером макроса во избежание блокировки мыши");
                    continue;
                }

                info!("Мышиный триггер совпал с макросом '{}' (триггер: {})", mac.name, mac.trigger_key);
                let macro_id = mac.id.clone();
                let state_clone = state_ref.clone();
                crate::daemon::runner::spawn_on_runtime(async move {
                    let _ = crate::daemon::macros::play_macro(&macro_id, &state_clone).await;
                });
                return EventAction::Block;
            }
        }
    }

    // Get active process name and window title
    let (active_process, window_title) = get_active_window_info();
    
    tracing::debug!("process_mouse_event: button={}, is_down={}, process='{}', title='{}'", button, is_down, active_process, window_title);
    
    // Determine active layers
    let mut active_layers = Vec::new();
    
    for layer in &profile.layers {
        if is_layer_active(layer, &active_process, &window_title) {
            active_layers.push(layer.id.clone());
        }
    }
    
    let mut layers_sorted = profile.layers.clone();
    layers_sorted.retain(|l| active_layers.contains(&l.id));
    layers_sorted.sort_by(|a, b| b.priority.cmp(&a.priority));
    
    let mut layer_search_order: Vec<Option<String>> = layers_sorted.iter().map(|l| Some(l.id.clone())).collect();
    layer_search_order.push(None);
    layer_search_order.push(Some("".to_string()));
    layer_search_order.push(Some("base".to_string()));

    // Скролл колесика мыши (если delta != 0)
    if delta != 0 {
        for search_layer_id in &layer_search_order {
            for rule in &profile.mouse_remaps {
            if matches_layer(search_layer_id, &rule.layer_id) {
                    let is_scroll_rule = rule.original_button.to_lowercase().contains("scroll");
                    if is_scroll_rule {
                        let is_up = delta > 0;
                        let trigger_matches = (is_up && rule.original_button.to_lowercase().contains("up")) ||
                                              (!is_up && rule.original_button.to_lowercase().contains("down"));
                        if trigger_matches {
                            info!("Скролл ремап: {} -> {}", rule.original_button, rule.mapped_action);
                            return handle_special_action(&rule.mapped_action, state);
                        }
                    }
                }
            }
        }
        return EventAction::PassThrough;
    }

    // Check mouse button remaps by layer priority
    for search_layer_id in &layer_search_order {
        for rule in &profile.mouse_remaps {
            if matches_layer(search_layer_id, &rule.layer_id) {
                if let Some(orig_btn) = mouse_name_to_button(&rule.original_button) {
                    if orig_btn == button {
                        info!("Ремаппинг мыши сработал: {} -> {}", rule.original_button, rule.mapped_action);
                        return handle_special_action(&rule.mapped_action, state);
                    }
                }
            }
        }
    }

    EventAction::PassThrough
}

#[cfg(target_os = "windows")]
fn snap_window_left() {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetWindowPos, GetSystemMetrics, SWP_NOZORDER, SWP_NOACTIVATE, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let hwnd = GetForegroundWindow();
        if !hwnd.is_invalid() {
            let screen_width = GetSystemMetrics(SM_CXSCREEN);
            let screen_height = GetSystemMetrics(SM_CYSCREEN);
            let _ = SetWindowPos(hwnd, None, 0, 0, screen_width / 2, screen_height, SWP_NOZORDER | SWP_NOACTIVATE);
        }
    }
}

#[cfg(target_os = "windows")]
fn snap_window_right() {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetWindowPos, GetSystemMetrics, SWP_NOZORDER, SWP_NOACTIVATE, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let hwnd = GetForegroundWindow();
        if !hwnd.is_invalid() {
            let screen_width = GetSystemMetrics(SM_CXSCREEN);
            let screen_height = GetSystemMetrics(SM_CYSCREEN);
            let _ = SetWindowPos(hwnd, None, screen_width / 2, 0, screen_width / 2, screen_height, SWP_NOZORDER | SWP_NOACTIVATE);
        }
    }
}

#[cfg(target_os = "windows")]
fn center_window() {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetWindowPos, GetSystemMetrics, GetWindowRect, SWP_NOZORDER, SWP_NOACTIVATE, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let hwnd = GetForegroundWindow();
        if !hwnd.is_invalid() {
            let screen_width = GetSystemMetrics(SM_CXSCREEN);
            let screen_height = GetSystemMetrics(SM_CYSCREEN);
            let mut rect = windows::Win32::Foundation::RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok() {
                let win_width = rect.right - rect.left;
                let win_height = rect.bottom - rect.top;
                let x = (screen_width - win_width) / 2;
                let y = (screen_height - win_height) / 2;
                let _ = SetWindowPos(hwnd, None, x, y, win_width, win_height, SWP_NOZORDER | SWP_NOACTIVATE);
            }
        }
    }
}

pub fn get_active_window_info() -> (String, String) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        use windows::Win32::Foundation::{CloseHandle};
        
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return (String::new(), String::new());
            }
            
            let mut buffer = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buffer);
            let title = if len > 0 {
                String::from_utf16_lossy(&buffer[..len as usize])
            } else {
                String::new()
            };
            
            let mut process_id = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));
            
            let mut process_name = String::new();
            if process_id != 0 {
                if let Ok(process_handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) {
                    use windows::Win32::System::Threading::QueryFullProcessImageNameW;
                    let mut path_buffer = [0u16; 260];
                    let mut size = path_buffer.len() as u32;
                    if QueryFullProcessImageNameW(process_handle, windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0), windows::core::PWSTR(path_buffer.as_mut_ptr()), &mut size).is_ok() {
                        let full_path = String::from_utf16_lossy(&path_buffer[..size as usize]);
                        if let Some(filename) = full_path.split('\\').last() {
                            process_name = filename.to_string();
                        }
                    }
                    let _ = CloseHandle(process_handle);
                }
            }
            
            (process_name, title)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        (String::new(), String::new())
    }
}

fn matches_layer(search_layer_id: &Option<String>, rule_layer_id: &Option<String>) -> bool {
    match (search_layer_id, rule_layer_id) {
        (None, None) => true,
        (None, Some(lid)) => lid.is_empty() || lid == "base",
        (Some(slid), None) => slid == "base" || slid.is_empty(),
        (Some(slid), Some(rlid)) => rlid == slid || (slid == "base" && rlid.is_empty()) || (rlid == "base" && slid.is_empty()),
    }
}

#[cfg(target_os = "windows")]
fn get_active_layout_lang() -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyboardLayout;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return "any".to_string();
        }
        let thread_id = GetWindowThreadProcessId(hwnd, None);
        if thread_id == 0 {
            return "any".to_string();
        }
        let hkl = GetKeyboardLayout(thread_id);
        let lang_id = (hkl.0 as usize) & 0xFFFF;
        match lang_id {
            0x0419 => "ru".to_string(),
            0x0409 => "en".to_string(),
            _ => "any".to_string(),
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn get_active_layout_lang() -> String {
    "any".to_string()
}

fn check_mouse_combo_match(combo_str: &str, current_button: u8) -> bool {
    let parts: Vec<&str> = combo_str.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return false;
    }
    
    let Some(base_btn_str) = parts.last() else {
        return false;
    };
    let base_btn = match mouse_name_to_button(base_btn_str) {
        Some(btn) => btn,
        None => return false,
    };
    
    if base_btn != current_button {
        return false;
    }
    
    let has_modifiers = parts.len() > 1;
    if !has_modifiers {
        return true;
    }
    
    let mut req_ctrl = false;
    let mut req_shift = false;
    let mut req_alt = false;
    let mut req_win = false;
    
    for &part in &parts[..parts.len() - 1] {
        let part_lower = part.to_lowercase();
        if part_lower == "ctrl" || part_lower == "lctrl" || part_lower == "rctrl" {
            req_ctrl = true;
        } else if part_lower == "shift" || part_lower == "lshift" || part_lower == "rshift" {
            req_shift = true;
        } else if part_lower == "alt" || part_lower == "lalt" || part_lower == "ralt" {
            req_alt = true;
        } else if part_lower == "win" || part_lower == "lwin" || part_lower == "rwin" {
            req_win = true;
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN};
        unsafe {
            let ctrl_pressed = (GetKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0;
            let shift_pressed = (GetKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0;
            let alt_pressed = (GetKeyState(VK_MENU.0 as i32) as u16 & 0x8000) != 0;
            let win_pressed = (GetKeyState(VK_LWIN.0 as i32) as u16 & 0x8000) != 0 || (GetKeyState(VK_RWIN.0 as i32) as u16 & 0x8000) != 0;
            
            ctrl_pressed == req_ctrl &&
            shift_pressed == req_shift &&
            alt_pressed == req_alt &&
            win_pressed == req_win
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

fn check_combo_match(combo_str: &str, current_vk: u8) -> bool {
    let parts: Vec<&str> = combo_str.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return false;
    }
    
    let Some(base_key_str) = parts.last() else {
        return false;
    };
    let base_vk = match key_name_to_vk(base_key_str) {
        Some(vk) => vk,
        None => return false,
    };
    
    if base_vk != current_vk {
        return false;
    }
    
    let has_modifiers = parts.len() > 1;
    if !has_modifiers {
        return true;
    }
    
    let mut req_ctrl = false;
    let mut req_shift = false;
    let mut req_alt = false;
    let mut req_win = false;
    
    for &part in &parts[..parts.len() - 1] {
        let part_lower = part.to_lowercase();
        if part_lower == "ctrl" || part_lower == "lctrl" || part_lower == "rctrl" {
            req_ctrl = true;
        } else if part_lower == "shift" || part_lower == "lshift" || part_lower == "rshift" {
            req_shift = true;
        } else if part_lower == "alt" || part_lower == "lalt" || part_lower == "ralt" {
            req_alt = true;
        } else if part_lower == "win" || part_lower == "lwin" || part_lower == "rwin" {
            req_win = true;
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN};
        unsafe {
            let ctrl_pressed = (GetKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0;
            let shift_pressed = (GetKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0;
            let alt_pressed = (GetKeyState(VK_MENU.0 as i32) as u16 & 0x8000) != 0;
            let win_pressed = (GetKeyState(VK_LWIN.0 as i32) as u16 & 0x8000) != 0 || (GetKeyState(VK_RWIN.0 as i32) as u16 & 0x8000) != 0;
            
            ctrl_pressed == req_ctrl &&
            shift_pressed == req_shift &&
            alt_pressed == req_alt &&
            win_pressed == req_win
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

fn is_layer_active(layer: &crate::shared::types::Layer, active_process: &str, window_title: &str) -> bool {
    match layer.trigger_type.as_str() {
        "none" => true,
        "process" => {
            !layer.trigger_value.is_empty() && 
            active_process.to_lowercase().contains(&layer.trigger_value.to_lowercase())
        }
        "window_title" => {
            !layer.trigger_value.is_empty() && 
            window_title.to_lowercase().contains(&layer.trigger_value.to_lowercase())
        }
        "hotkey" => {
            if let Some(vk) = key_name_to_vk(&layer.trigger_value) {
                #[cfg(target_os = "windows")]
                unsafe {
                    use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState;
                    (GetKeyState(vk as i32) as u16 & 0x8000) != 0
                }
                #[cfg(not(target_os = "windows"))]
                {
                    false
                }
            } else {
                false
            }
        }
        _ => false,
    }
}