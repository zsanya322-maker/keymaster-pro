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

use std::sync::Mutex;
pub static LAST_RECORDED_MOUSE_POS: Mutex<Option<(i32, i32)>> = Mutex::new(None);
pub static LAST_RECORDED_MOUSE_TIME: Mutex<Option<std::time::Instant>> = Mutex::new(None);

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
            // Режим захвата клавиши для KeyPicker: пропускаем клавишу мимо engine,
            // чтобы GUI мог её записать даже если правило её блокирует.
            // F12 (служебная клавиша записи макроса) здесь не фильтруем —
            // её перехватываем ниже как обычно.
            if s.key_capture_active.load(Ordering::Relaxed) && vk_code != 0x7B {
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }

            // Перехват F12 для запуска / остановки записи макроса
            if vk_code == 0x7B { // F12
                if is_key_down {
                    if s.is_recording.load(Ordering::Relaxed) {
                        s.is_recording.store(false, Ordering::Relaxed);
                        crate::gui::events::broadcast_event(crate::gui::events::DaemonEvent::MacroRecordingStopped { macro_id: "".to_string() });
                        tracing::info!("Запись макроса остановлена по нажатию F12");
                    } else if s.record_ready.load(Ordering::Relaxed) {
                        s.is_recording.store(true, Ordering::Relaxed);
                        if let Ok(mut last_time) = s.last_record_time.lock() {
                            *last_time = None;
                        }
                        if let Ok(mut last_pos) = LAST_RECORDED_MOUSE_POS.lock() {
                            *last_pos = None;
                        }
                        if let Ok(mut last_mouse_time) = LAST_RECORDED_MOUSE_TIME.lock() {
                            *last_mouse_time = None;
                        }
                        tracing::info!("Запись макроса запущена по нажатию F12");
                    }
                }
                return LRESULT(1); // Блокируем F12 для системы
            }

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
            // Режим захвата кнопки мыши для KeyPicker: сохраняем код кнопки 1-5
            // при mouse down (поллинг keycapture.get_captured_mouse заберёт его),
            // затем пропускаем событие мимо engine, чтобы GUI мог записать клик
            // даже если правило его блокирует.
            // Решает проблему X1/X2: WebView2 не передаёт их в JS как mousedown.
            if s.key_capture_active.load(Ordering::Relaxed) {
                if is_mouse_down && button != 255 {
                    if let Ok(mut captured) = s.last_captured_mouse.lock() {
                        *captured = Some(button);
                        tracing::debug!("Захвачена кнопка мыши для KeyPicker: {}", button);
                    }
                }
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }

            if s.is_recording.load(Ordering::Relaxed) {
                let now = std::time::Instant::now();
                let mut steps_to_record = Vec::new();

                // Получим задержку для первого шага на этом событии
                let mut current_delay = 0u32;
                if let Ok(last_time) = s.last_record_time.lock() {
                    current_delay = match *last_time {
                        Some(last) => now.duration_since(last).as_millis() as u32,
                        None => 0,
                    };
                }

                // 1. Проверяем, нужно ли вставить координаты перед кликом/скроллом
                if button != 255 || delta != 0 {
                    let mut need_force_mouse_pos = false;
                    if let Ok(mut last_pos_guard) = LAST_RECORDED_MOUSE_POS.lock() {
                        match *last_pos_guard {
                            Some((lx, ly)) => {
                                if lx != x || ly != y {
                                    *last_pos_guard = Some((x, y));
                                    need_force_mouse_pos = true;
                                }
                            }
                            None => {
                                *last_pos_guard = Some((x, y));
                                need_force_mouse_pos = true;
                            }
                        }
                    }
                    if need_force_mouse_pos {
                        if let Ok(mut last_mouse_time) = LAST_RECORDED_MOUSE_TIME.lock() {
                            *last_mouse_time = Some(now);
                        }
                        steps_to_record.push(crate::schemas::frontend::MacroStep {
                            action: crate::schemas::frontend::MacroAction::MouseToAbsolute { x, y },
                            delay_ms: current_delay,
                        });
                        // Для последующего действия в этом же событии задержка будет 0
                        current_delay = 0;
                    }
                }

                // 2. Обрабатываем текущее действие
                let mut action_to_record = None;
                if button != 255 {
                    let action = if is_mouse_down {
                        crate::schemas::frontend::MacroAction::MouseDown { code: button }
                    } else {
                        crate::schemas::frontend::MacroAction::MouseUp { code: button }
                    };
                    action_to_record = Some(action);
                } else if delta != 0 {
                    action_to_record = Some(crate::schemas::frontend::MacroAction::MouseScroll { delta });
                } else if msg_type == WM_MOUSEMOVE as u32 {
                    let record_mouse_moves = s.record_mouse_moves.load(Ordering::Relaxed);
                    let record_mouse_drag_drop_only = s.record_mouse_drag_drop_only.load(Ordering::Relaxed);

                    let mut should_record = false;

                    if record_mouse_moves {
                        let is_drag = if record_mouse_drag_drop_only {
                            let is_left_down = (unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x01) } as u16 & 0x8000) != 0;
                            let is_right_down = (unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x02) } as u16 & 0x8000) != 0;
                            let is_middle_down = (unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x04) } as u16 & 0x8000) != 0;
                            is_left_down || is_right_down || is_middle_down
                        } else {
                            true
                        };

                        if is_drag {
                            if let Ok(mut last_pos_guard) = LAST_RECORDED_MOUSE_POS.lock() {
                                match *last_pos_guard {
                                    Some((lx, ly)) => {
                                        // Порог 15 пикселей для сглаживания мелких движений
                                        if (x - lx).abs() > 15 || (y - ly).abs() > 15 {
                                            // Троттлинг 100 мс для предотвращения генерации сотен шагов
                                            if let Ok(last_time_guard) = LAST_RECORDED_MOUSE_TIME.lock() {
                                                match *last_time_guard {
                                                    Some(last_t) => {
                                                        if now.duration_since(last_t).as_millis() >= 100 {
                                                            should_record = true;
                                                        }
                                                    }
                                                    None => {
                                                        should_record = true;
                                                    }
                                                }
                                            }
                                            if should_record {
                                                *last_pos_guard = Some((x, y));
                                            }
                                        }
                                    }
                                    None => {
                                        *last_pos_guard = Some((x, y));
                                        should_record = true;
                                    }
                                }
                            }
                        }
                    }

                    if should_record {
                        if let Ok(mut last_mouse_time) = LAST_RECORDED_MOUSE_TIME.lock() {
                            *last_mouse_time = Some(now);
                        }
                        action_to_record = Some(crate::schemas::frontend::MacroAction::MouseToAbsolute { x, y });
                    }
                }

                if let Some(action) = action_to_record {
                    steps_to_record.push(crate::schemas::frontend::MacroStep {
                        action,
                        delay_ms: current_delay,
                    });
                }

                // 3. Сохраняем шаги и обновляем глобальное время записи
                if !steps_to_record.is_empty() {
                    if let Ok(mut last_time_lock) = s.last_record_time.lock() {
                        *last_time_lock = Some(now);
                    }
                    
                    if let Ok(mut steps) = s.recorded_steps.lock() {
                        for step in &steps_to_record {
                            steps.push(step.clone());
                        }
                    }
                    for step in steps_to_record {
                        if let Ok(step_json) = serde_json::to_value(&step) {
                            crate::gui::events::broadcast_event(crate::gui::events::DaemonEvent::MacroRecordingStep {
                                step: step_json,
                            });
                        }
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
