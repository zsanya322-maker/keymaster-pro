/// Keyboard & Mouse Low-Level Hooks (SetWindowsHookEx)
///
/// Устанавливает WH_KEYBOARD_LL и WH_MOUSE_LL хуки.
/// Хук-поток владеет message loop — без него Windows не вызывает callback.
///
/// Anti-recursion: фильтруем LLKHF_INJECTED (наши же SendInput).
/// Каждый callback делегирует обработку в engine.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tracing::{error, info};

use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
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

    if let Some(s_ref) = state_ref {
        if let Ok(s) = s_ref.read() {
            if s.is_recording.load(Ordering::Relaxed) {
                if let Ok(mut last_time_lock) = s.last_record_time.lock() {
                    let now = std::time::Instant::now();
                    let delay_ms = match *last_time_lock {
                        Some(last) => now.duration_since(last).as_millis() as u32,
                        None => 0,
                    };
                    *last_time_lock = Some(now);

                    let action = if is_key_down {
                        crate::schemas::frontend::MacroAction::KeyDown { code: vk_code }
                    } else {
                        crate::schemas::frontend::MacroAction::KeyUp { code: vk_code }
                    };

                    let step = crate::schemas::frontend::MacroStep {
                        action,
                        delay_ms,
                    };
                    if let Ok(mut steps) = s.recorded_steps.lock() {
                        steps.push(step.clone());
                    }
                    if let Ok(step_json) = serde_json::to_value(&step) {
                        crate::gui::events::broadcast_event(crate::gui::events::DaemonEvent::MacroRecordingStep {
                            step: step_json,
                        });
                    }
                }
            }
        }
    }

    let _start = std::time::Instant::now();
    let start = std::time::Instant::now();
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
    // 1=Left, 2=Right, 3=Middle, 4=X1, 5=X2
    let button = match msg_type {
        wm if wm == WM_LBUTTONDOWN as u32 || wm == WM_LBUTTONUP as u32 => 1u8,
        wm if wm == WM_RBUTTONDOWN as u32 || wm == WM_RBUTTONUP as u32 => 2u8,
        wm if wm == WM_MBUTTONDOWN as u32 || wm == WM_MBUTTONUP as u32 => 3u8,
        wm if wm == WM_XBUTTONDOWN as u32 || wm == WM_XBUTTONUP as u32 => {
            let xbutton = ((ms_struct.mouseData >> 16) & 0xFFFF) as u8;
            if xbutton == 1 { 4 } else { 5 }
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

    // Логируем только значимые события мыши (клики/скролл),
    // но НЕ каждый WM_MOUSEMOVE — иначе лог раздувается до сотен МБ.
    if button != 255 || is_mouse_down || delta != 0 {
        tracing::debug!("Хук мыши: msg_type={}, button={}, x={}, y={}, delta={}, is_mouse_down={}", msg_type, button, x, y, delta, is_mouse_down);
    }

    let state_ref = GLOBAL_STATE.get();

    if let Some(s_ref) = state_ref {
        if let Ok(s) = s_ref.read() {
            if s.is_recording.load(Ordering::Relaxed) && button != 255 {
                if let Ok(mut last_time_lock) = s.last_record_time.lock() {
                    let now = std::time::Instant::now();
                    let delay_ms = match *last_time_lock {
                        Some(last) => now.duration_since(last).as_millis() as u32,
                        None => 0,
                    };
                    *last_time_lock = Some(now);

                    let action = if is_mouse_down {
                        crate::schemas::frontend::MacroAction::MouseDown { code: button }
                    } else {
                        crate::schemas::frontend::MacroAction::MouseUp { code: button }
                    };

                    let step = crate::schemas::frontend::MacroStep {
                        action,
                        delay_ms,
                    };
                    if let Ok(mut steps) = s.recorded_steps.lock() {
                        steps.push(step.clone());
                    }
                    if let Ok(step_json) = serde_json::to_value(&step) {
                        crate::gui::events::broadcast_event(crate::gui::events::DaemonEvent::MacroRecordingStep {
                            step: step_json,
                        });
                    }
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
    }
}
