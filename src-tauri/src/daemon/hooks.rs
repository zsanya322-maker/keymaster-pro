/// Keyboard & Mouse Low-Level Hooks (SetWindowsHookEx)
///
/// Устанавливает WH_KEYBOARD_LL и WH_MOUSE_LL хуки.
/// Хук-поток владеет message loop — без него Windows не вызывает callback.
///
/// Anti-recursion: фильтруем LLKHF_INJECTED (наши же SendInput).
/// Каждый callback делегирует обработку в engine.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tracing::{error, info, warn};

use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::daemon::engine;
use crate::daemon::state::DaemonStateRef;

/// Глобальные флаги для связи с hook callback
static KB_HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);
static MOUSE_HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);

/// Глобальная ссылка на состояние Daemon
static GLOBAL_STATE: OnceLock<DaemonStateRef> = OnceLock::new();

/// Результат установки хуков
#[derive(Debug)]
pub struct HookHandles {
    pub kb_thread_id: u32,
    pub mouse_thread_id: u32,
}

/// Установить keyboard и mouse hooks на отдельных потоках
pub fn install_hooks(state: DaemonStateRef) -> Result<HookHandles, String> {
    let _ = GLOBAL_STATE.set(state.clone());
    let state_kb = state.clone();
    let state_mouse = state;

    // Keyboard hook thread
    let _kb_handle = std::thread::Builder::new()
        .name("km-kb-hook".to_string())
        .spawn(move || {
            run_keyboard_hook(state_kb);
        })
        .map_err(|e| format!("Не удалось создать поток kb-hook: {}", e))?;

    // Mouse hook thread
    let _mouse_handle = std::thread::Builder::new()
        .name("km-mouse-hook".to_string())
        .spawn(move || {
            run_mouse_hook(state_mouse);
        })
        .map_err(|e| format!("Не удалось создать поток mouse-hook: {}", e))?;

    // Ждём пока хуки установятся (с таймаутом)
    let timeout = std::time::Instant::now();
    loop {
        if KB_HOOK_INSTALLED.load(Ordering::SeqCst)
            && MOUSE_HOOK_INSTALLED.load(Ordering::SeqCst)
        {
            break;
        }
        if timeout.elapsed() > std::time::Duration::from_secs(5) {
            return Err("Таймаут установки хуков (5с)".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    info!("Хуки keyboard + mouse установлены");

    Ok(HookHandles {
        kb_thread_id: 0,
        mouse_thread_id: 0,
    })
}

/// Деинсталлировать все хуки (установить флаги остановки)
pub fn uninstall_hooks() {
    KB_HOOK_INSTALLED.store(false, Ordering::SeqCst);
    MOUSE_HOOK_INSTALLED.store(false, Ordering::SeqCst);
    info!("Хуки деинсталлированы");
}

/// Поток keyboard hook
fn run_keyboard_hook(_state: DaemonStateRef) {
    let thread_id = unsafe { GetCurrentThreadId() };
    info!("KB hook thread: {}", thread_id);

    // Устанавливаем WH_KEYBOARD_LL
    let hook = unsafe {
        SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard_hook_callback),
            None,
            0,
        )
    };

    match hook {
        Ok(h) => {
            KB_HOOK_INSTALLED.store(true, Ordering::SeqCst);
            info!("WH_KEYBOARD_LL установлен");

            // Message loop — необходим для работы hook callback
            run_message_loop("kb");

            // Снимаем хук при выходе
            unsafe {
                let _ = UnhookWindowsHookEx(h);
            }
            info!("WH_KEYBOARD_LL снят");
        }
        Err(e) => {
            error!("Ошибка установки WH_KEYBOARD_LL: {}", e);
        }
    }
}

/// Поток mouse hook
fn run_mouse_hook(_state: DaemonStateRef) {
    let thread_id = unsafe { GetCurrentThreadId() };
    info!("Mouse hook thread: {}", thread_id);

    let hook = unsafe {
        SetWindowsHookExW(
            WH_MOUSE_LL,
            Some(mouse_hook_callback),
            None,
            0,
        )
    };

    match hook {
        Ok(h) => {
            MOUSE_HOOK_INSTALLED.store(true, Ordering::SeqCst);
            info!("WH_MOUSE_LL установлен");

            run_message_loop("mouse");

            unsafe {
                let _ = UnhookWindowsHookEx(h);
            }
            info!("WH_MOUSE_LL снят");
        }
        Err(e) => {
            error!("Ошибка установки WH_MOUSE_LL: {}", e);
        }
    }
}

/// Простой message loop для hook thread
fn run_message_loop(name: &str) {
    let mut msg = MSG::default();
    while KB_HOOK_INSTALLED.load(Ordering::SeqCst)
        || MOUSE_HOOK_INSTALLED.load(Ordering::SeqCst)
    {
        unsafe {
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE);
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    info!("{} message loop завершён", name);
}

/// Keyboard Low-Level Hook callback
extern "system" fn keyboard_hook_callback(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code < 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let kb_struct = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
    let flags = kb_struct.flags;

    // Anti-recursion: пропускаем наши же инъекции
    if (flags.0 & LLKHF_INJECTED.0) != 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let vk_code = kb_struct.vkCode as u8;
    let scan_code = kb_struct.scanCode as u16;
    let is_key_down = wparam.0 == WM_KEYDOWN as usize
        || wparam.0 == WM_SYSKEYDOWN as usize;

    tracing::debug!("Keyboard hook: vkCode={}, scanCode={}, is_key_down={}", vk_code, scan_code, is_key_down);

    let state_ref = GLOBAL_STATE.get();
    let start = std::time::Instant::now();

    // Check F12 toggle key (VK_F12 is 0x7B)
    static F12_DOWN: AtomicBool = AtomicBool::new(false);
    if vk_code == 0x7B {
        if is_key_down {
            if !F12_DOWN.swap(true, Ordering::SeqCst) {
                if let Some(s_ref) = state_ref {
                    let _ = toggle_recording(s_ref);
                }
            }
            return LRESULT(1); // Block F12 down key
        } else if wparam.0 == WM_KEYUP as usize || wparam.0 == WM_SYSKEYUP as usize {
            F12_DOWN.store(false, Ordering::SeqCst);
            return LRESULT(1); // Block F12 up key
        }
    }

    // If recording is active, capture key events (except F12 itself)
    let mut recording_active = false;
    let mut last_time = None;
    if let Some(s_ref) = state_ref {
        if let Ok(s) = s_ref.read() {
            if s.recording_macro_id.is_some() {
                recording_active = true;
                last_time = s.record_last_event_time;
            }
        }
    }

    if recording_active && vk_code != 0x7B {
        let now = std::time::Instant::now();
        let delay_ms = if let Some(last) = last_time {
            let duration = now.duration_since(last);
            duration.as_millis() as u64
        } else {
            0
        };

        if let Some(s_ref) = state_ref {
            if let Ok(mut s) = s_ref.write() {
                if delay_ms > 5 && !s.recorded_steps.is_empty() {
                    s.recorded_steps.push(crate::shared::types::MacroStep {
                        id: format!("delay_{}", uuid::Uuid::new_v4()),
                        action_type: "delay".to_string(),
                        value: serde_json::json!(delay_ms),
                    });
                }

                let action_type = if is_key_down { "key_down" } else { "key_up" };
                let key_name = vk_to_key_name(vk_code);
                info!("Macro recording: captured {} (key: {}, delay: {}ms)", action_type, key_name, delay_ms);
                s.recorded_steps.push(crate::shared::types::MacroStep {
                    id: format!("{}_{}", action_type, uuid::Uuid::new_v4()),
                    action_type: action_type.to_string(),
                    value: serde_json::json!(key_name),
                });
                s.record_last_event_time = Some(now);
            }
        }
    }

    // Delegate processing to the engine
    let action = engine::process_keyboard_event(
        vk_code,
        scan_code,
        is_key_down,
        flags.0,
        state_ref,
    );

    let elapsed = start.elapsed().as_micros() as u64;
    if let Some(s_ref) = state_ref {
        if let Ok(s) = s_ref.read() {
            s.last_latency_us.store(elapsed, Ordering::Relaxed);
            if is_key_down {
                s.keystrokes_processed.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    match action {
        engine::EventAction::PassThrough => {
            unsafe { CallNextHookEx(None, code, wparam, lparam) }
        }
        engine::EventAction::Block => {
            LRESULT(1)
        }
        engine::EventAction::Replace { actions } => {
            execute_synth_actions(&actions);
            LRESULT(1)
        }
    }
}

/// Mouse Low-Level Hook callback
extern "system" fn mouse_hook_callback(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code < 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let ms_struct = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
    let flags = ms_struct.flags;

    // Anti-recursion
    if (flags & LLMHF_INJECTED) != 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let msg_type = wparam.0 as u32;

    // Определяем кнопку
    // 0=Left, 1=Right, 2=Middle, 3=X1, 4=X2
    let button = match msg_type {
        wm if wm == WM_LBUTTONDOWN as u32 || wm == WM_LBUTTONUP as u32 => 0u8,
        wm if wm == WM_RBUTTONDOWN as u32 || wm == WM_RBUTTONUP as u32 => 1u8,
        wm if wm == WM_MBUTTONDOWN as u32 || wm == WM_MBUTTONUP as u32 => 2u8,
        wm if wm == WM_XBUTTONDOWN as u32 || wm == WM_XBUTTONUP as u32 => {
            let xbutton = ((ms_struct.mouseData >> 16) & 0xFFFF) as u8;
            if xbutton == 1 { 3 } else { 4 }
        }
        _ => 255u8, // Движение или скролл
    };

    let x = ms_struct.pt.x;
    let y = ms_struct.pt.y;
    let delta = if msg_type == WM_MOUSEWHEEL as u32 || msg_type == WM_MOUSEHWHEEL as u32 {
        ((ms_struct.mouseData >> 16) & 0xFFFF) as i16 as i32
    } else {
        0
    };

    let is_mouse_down = msg_type == WM_LBUTTONDOWN as u32
        || msg_type == WM_RBUTTONDOWN as u32
        || msg_type == WM_MBUTTONDOWN as u32
        || msg_type == WM_XBUTTONDOWN as u32;

    tracing::debug!("Хук мыши: msg_type={}, button={}, x={}, y={}, delta={}, is_mouse_down={}", msg_type, button, x, y, delta, is_mouse_down);

    let state_ref = GLOBAL_STATE.get();

    if is_mouse_down {
        let mut recording_active = false;
        let mut last_time = None;
        if let Some(s_ref) = state_ref {
            if let Ok(s) = s_ref.read() {
                if s.recording_macro_id.is_some() {
                    recording_active = true;
                    last_time = s.record_last_event_time;
                }
            }
        }

        if recording_active {
            let now = std::time::Instant::now();
            let delay_ms = if let Some(last) = last_time {
                let duration = now.duration_since(last);
                duration.as_millis() as u64
            } else {
                0
            };

            let btn_str = match msg_type {
                wm if wm == WM_LBUTTONDOWN as u32 => "Left",
                wm if wm == WM_RBUTTONDOWN as u32 => "Right",
                wm if wm == WM_MBUTTONDOWN as u32 => "Middle",
                wm if wm == WM_XBUTTONDOWN as u32 => {
                    let xbutton = ((ms_struct.mouseData >> 16) & 0xFFFF) as u8;
                    if xbutton == 1 { "XButton1" } else { "XButton2" }
                }
                _ => "Left",
            };

            if let Some(s_ref) = state_ref {
                if let Ok(mut s) = s_ref.write() {
                    if delay_ms > 5 && !s.recorded_steps.is_empty() {
                        s.recorded_steps.push(crate::shared::types::MacroStep {
                            id: format!("delay_{}", uuid::Uuid::new_v4()),
                            action_type: "delay".to_string(),
                            value: serde_json::json!(delay_ms),
                        });
                    }

                    s.recorded_steps.push(crate::shared::types::MacroStep {
                        id: format!("mousemove_{}", uuid::Uuid::new_v4()),
                        action_type: "mouse_move".to_string(),
                        value: serde_json::json!(format!("{},{}", x, y)),
                    });

                    s.recorded_steps.push(crate::shared::types::MacroStep {
                        id: format!("mouseclick_{}", uuid::Uuid::new_v4()),
                        action_type: "mouse_click".to_string(),
                        value: serde_json::json!(btn_str),
                    });

                    s.record_last_event_time = Some(now);
                }
            }
        }
    }

    let start = std::time::Instant::now();
    let action = engine::process_mouse_event(button, x, y, delta, flags, is_mouse_down, state_ref);

    let elapsed = start.elapsed().as_micros() as u64;
    if let Some(s_ref) = state_ref {
        if let Ok(s) = s_ref.read() {
            s.last_latency_us.store(elapsed, Ordering::Relaxed);
        }
    }

    match action {
        engine::EventAction::PassThrough => {
            unsafe { CallNextHookEx(None, code, wparam, lparam) }
        }
        engine::EventAction::Block => {
            LRESULT(1)
        }
        engine::EventAction::Replace { actions } => {
            execute_synth_actions(&actions);
            LRESULT(1)
        }
    }
}

/// Выполнить сгенерированные действия
fn execute_synth_actions(actions: &[engine::SynthAction]) {
    for synth in actions {
        match synth {
            engine::SynthAction::KeyPress { vk, scan } => {
                synth_key(*vk, *scan, true);
            }
            engine::SynthAction::KeyRelease { vk, scan } => {
                synth_key(*vk, *scan, false);
            }
            engine::SynthAction::UnicodeString { text } => {
                synth_unicode_string(text);
            }
            engine::SynthAction::MouseClick { button, x, y } => {
                synth_mouse_click(*button, *x, *y);
            }
            engine::SynthAction::MouseMove { x, y } => {
                synth_mouse_move(*x, *y);
            }
            engine::SynthAction::Scroll { delta } => {
                synth_mouse_scroll(*delta);
            }
            engine::SynthAction::Delay { ms } => {
                std::thread::sleep(std::time::Duration::from_millis(*ms));
            }
        }
    }
}

/// Синтезировать клавиатурное событие через SendInput
pub fn synth_key(vk: u8, scan: u16, is_key_down: bool) {
    let flags = if is_key_down { 0u32 } else { KEYEVENTF_KEYUP.0 as u32 };

    let input = INPUT {
        r#type: INPUT_TYPE(1), // INPUT_KEYBOARD
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk as u16),
                wScan: scan,
                dwFlags: KEYBD_EVENT_FLAGS(flags),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe {
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

/// Синтезировать текстовую строку через SendInput в режиме Unicode
pub fn synth_unicode_string(text: &str) {
    for c in text.encode_utf16() {
        let input_down = INPUT {
            r#type: INPUT_TYPE(1), // INPUT_KEYBOARD
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: c,
                    dwFlags: KEYBD_EVENT_FLAGS(KEYEVENTF_UNICODE.0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let input_up = INPUT {
            r#type: INPUT_TYPE(1), // INPUT_KEYBOARD
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: c,
                    dwFlags: KEYBD_EVENT_FLAGS(KEYEVENTF_UNICODE.0 | KEYEVENTF_KEYUP.0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        unsafe {
            let _ = SendInput(&[input_down, input_up], std::mem::size_of::<INPUT>() as i32);
        }
    }
}

/// Синтез клика мыши
pub fn synth_mouse_click(button: u8, x: i32, y: i32) {
    if x != 0 || y != 0 {
        unsafe {
            let _ = SetCursorPos(x, y);
        }
    }
    let (down_flags, up_flags) = match button {
        0 => (0x0002, 0x0004), // LEFTDOWN, LEFTUP
        1 => (0x0008, 0x0010), // RIGHTDOWN, RIGHTUP
        2 => (0x0020, 0x0040), // MIDDLEDOWN, MIDDLEUP
        3 => (0x0080, 0x0100), // XDOWN, XUP with mouseData = 1
        4 => (0x0080, 0x0100), // XDOWN, XUP with mouseData = 2
        _ => (0, 0)
    };
    let mouse_data = match button {
        3 => 1,
        4 => 2,
        _ => 0
    };
    if down_flags != 0 {
        synth_mouse_raw(down_flags, mouse_data);
        std::thread::sleep(std::time::Duration::from_millis(10));
        synth_mouse_raw(up_flags, mouse_data);
    }
}

/// Синтез движения мыши
pub fn synth_mouse_move(x: i32, y: i32) {
    unsafe {
        let _ = SetCursorPos(x, y);
    }
}

/// Синтез скролла колеса мыши
pub fn synth_mouse_scroll(delta: i32) {
    synth_mouse_raw(0x0800, delta as u32); // MOUSEEVENTF_WHEEL
}

fn synth_mouse_raw(flags: u32, mouse_data: u32) {
    let input = INPUT {
        r#type: INPUT_TYPE(0), // INPUT_MOUSE
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
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

fn toggle_recording(state_ref: &DaemonStateRef) -> bool {
    let mut state = match state_ref.write() {
        Ok(s) => s,
        Err(_) => return false,
    };

    if let Some(ref rec_id) = state.recording_macro_id {
        // Stop recording
        let macro_id = rec_id.clone();
        state.recording_macro_id = None;
        state.record_start_time = None;
        state.record_last_event_time = None;
        let steps = std::mem::take(&mut state.recorded_steps);
        drop(state); // drop lock before writing to persistence

        // Save recorded steps to persistence
        if let Err(e) = save_recorded_macro_internal(&macro_id, steps, state_ref) {
            error!("Error saving recorded macro: {}", e);
        }
        info!("Macro recording stopped for macro: {}", macro_id);
        true
    } else if let Some(sel_id) = state.selected_macro_id.clone() {
        // Start recording
        state.recording_macro_id = Some(sel_id.clone());
        state.record_start_time = Some(std::time::Instant::now());
        state.record_last_event_time = Some(std::time::Instant::now());
        state.recorded_steps = Vec::new();
        info!("Macro recording started for macro: {}", sel_id);
        true
    } else {
        // Try to find the first macro in active profile if none is selected
        if let Some(ref prof) = state.active_profile {
            if let Some(first_mac) = prof.macros.first() {
                let first_id = first_mac.id.clone();
                state.recording_macro_id = Some(first_id.clone());
                state.record_start_time = Some(std::time::Instant::now());
                state.record_last_event_time = Some(std::time::Instant::now());
                state.recorded_steps = Vec::new();
                info!("Macro recording started for first macro in profile: {}", first_id);
                return true;
            }
        }
        warn!("F12 pressed but no macro selected and active profile has no macros");
        false
    }
}

fn save_recorded_macro_internal(macro_id: &str, steps: Vec<crate::shared::types::MacroStep>, state_ref: &DaemonStateRef) -> Result<(), String> {
    let active_profile_id = {
        let s = state_ref.read().map_err(|_| "Failed to lock state")?;
        s.active_profile_id.clone()
    };

    let mut profile = crate::shared::persistence::load_profile(&active_profile_id)?;
    if let Some(m) = profile.macros.iter_mut().find(|mac| mac.id == macro_id) {
        m.steps = steps;
    } else {
        return Err(format!("Macro {} not found in profile {}", macro_id, active_profile_id));
    }

    crate::shared::persistence::save_profile(&profile)?;

    if let Ok(mut s) = state_ref.write() {
        if s.active_profile_id == active_profile_id {
            s.active_profile = Some(profile);
        }
    }
    Ok(())
}

fn vk_to_key_name(vk: u8) -> String {
    match vk {
        0x14 => "CapsLock".to_string(),
        0x1B => "Escape".to_string(),
        0x20 => "Space".to_string(),
        0x0D => "Enter".to_string(),
        0x08 => "Backspace".to_string(),
        0x09 => "Tab".to_string(),
        0x2E => "Delete".to_string(),
        0x2D => "Insert".to_string(),
        0x21 => "PageUp".to_string(),
        0x22 => "PageDown".to_string(),
        0x23 => "End".to_string(),
        0x24 => "Home".to_string(),
        0x25 => "Left".to_string(),
        0x26 => "Up".to_string(),
        0x27 => "Right".to_string(),
        0x28 => "Down".to_string(),
        0xAD => "VolumeMute".to_string(),
        0xAE => "VolumeDown".to_string(),
        0xAF => "VolumeUp".to_string(),
        0x12 | 0xA4 | 0xA5 => "Alt".to_string(),
        0x11 | 0xA2 | 0xA3 => "Ctrl".to_string(),
        0x10 | 0xA0 | 0xA1 => "Shift".to_string(),
        0x5B | 0x5C => "Win".to_string(),
        0x70 => "F1".to_string(),
        0x71 => "F2".to_string(),
        0x72 => "F3".to_string(),
        0x73 => "F4".to_string(),
        0x74 => "F5".to_string(),
        0x75 => "F6".to_string(),
        0x76 => "F7".to_string(),
        0x77 => "F8".to_string(),
        0x78 => "F9".to_string(),
        0x79 => "F10".to_string(),
        0x7A => "F11".to_string(),
        0x7B => "F12".to_string(),
        val @ 0x41..=0x5A => ((val - 0x41 + b'A') as char).to_string(),
        val @ 0x30..=0x39 => ((val - 0x30 + b'0') as char).to_string(),
        other => format!("VK_{}", other),
    }
}