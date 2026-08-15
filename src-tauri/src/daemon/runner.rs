/// Daemon main loop
///
/// Точка входа daemon-процесса. Запускает IPC сервер, hook manager,
/// layer watcher, persistence thread.
///
/// Архитектура потоков:
/// - Main Thread: Windows Message Loop (для SetWindowsHookEx)
/// - Tokio Runtime: IPC Server, Persistence, Layer Watcher
/// - State: Arc<RwLock<DaemonState>>

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::OnceLock;

use tracing::{error, info, warn};

use crate::daemon::state::{DaemonState, DaemonStateRef};
use crate::shared::config;
use crate::shared::constants;
use crate::logging;

/// Флаг для graceful shutdown (глобальный, читается из hook callback)
static DAEMON_RUNNING: AtomicBool = AtomicBool::new(true);

/// ID главного потока для отправки WM_QUIT
static MAIN_THREAD_ID: AtomicU32 = AtomicU32::new(0);

/// Глобальный хэндл Tokio для запуска задач из потоков хуков
pub static TOKIO_HANDLE: OnceLock<tokio::runtime::Handle> = OnceLock::new();

/// Запустить асинхронную задачу на глобальном рантайме Tokio
pub fn spawn_on_runtime<F>(future: F)
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    if let Some(handle) = TOKIO_HANDLE.get() {
        handle.spawn(future);
    } else {
        error!("Tokio handle not initialized!");
    }
}

/// Запустить daemon-процесс
///
/// Вызывается из main.rs когда передан флаг `--daemon`.
/// Блокирует текущий поток до получения сигнала завершения.
pub fn run_daemon(parent_pid: Option<u32>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::SetProcessDPIAware();
    }

    // Initialize logger
    logging::init_logging()?;
    info!("KeyMaster Pro Daemon v{} starting...", env!("CARGO_PKG_VERSION"));

    // Save main thread ID for request_shutdown()
    #[cfg(target_os = "windows")]
    unsafe {
        MAIN_THREAD_ID.store(windows::Win32::System::Threading::GetCurrentThreadId(), Ordering::SeqCst);
    }

    // Load configuration
    let app_config = config::load_config().unwrap_or_else(|e| {
        warn!("Failed to load config: {}, using default", e);
        crate::shared::types::AppConfig::default()
    });
    info!("Configuration loaded. Language: {}", app_config.language);

    // Create shared state
    let state = DaemonState::from_config(&app_config).into_ref();

    // Start Simulator Actor
    let simulator_tx = crate::simulator::spawn_simulator_thread();
    if let Ok(mut s) = state.write() {
        s.simulator = Some(simulator_tx);
    }

    // Start Context Tracker
    crate::trackers::context_tracker::spawn_context_tracker(crate::context::AppContextState::default());

    // Start Tokio runtime for IPC and background tasks
    let tokio_rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .thread_name("km-daemon")
        .enable_all()
        .build()
        .map_err(|e| format!("Failed to create tokio runtime: {}", e))?;

    let _ = TOKIO_HANDLE.set(tokio_rt.handle().clone());

    // Clone state for tokio tasks
    let ipc_state = state.clone();
    let shutdown_state = state.clone();

    // Start IPC server in Tokio
    tokio_rt.spawn(async move {
        if let Err(e) = crate::daemon::ipc::start_ipc_server(ipc_state).await {
            error!("IPC server stopped with error: {}", e);
            request_shutdown();
        }
    });

    // Запустить мониторинг родительского процесса (watchdog)
    if let Some(pid) = parent_pid {
        tokio_rt.spawn(async move {
            info!("Запущен мониторинг родительского процесса PID: {}", pid);
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if !is_process_alive(pid) {
                    warn!("Родительский процесс PID {} завершился. Самоликвидация daemon'а...", pid);
                    request_shutdown();
                    break;
                }
            }
        });
    }

    // Синхронизировать runtime-настройки, которые hook/engine читают из DaemonState.
    // GUI сохраняет config.json напрямую; daemon следит только за mtime файла и
    // перечитывает его при реальном изменении, поэтому здесь нет постоянного JSON-I/O.
    let config_sync_state = state.clone();
    tokio_rt.spawn(async move {
        let config_path = match crate::shared::persistence::app_data_dir() {
            Ok(dir) => dir.join("config.json"),
            Err(e) => {
                warn!("Config sync disabled: {}", e);
                return;
            }
        };
        let mut last_modified = std::fs::metadata(&config_path)
            .and_then(|meta| meta.modified())
            .ok();

        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            let running = config_sync_state
                .read()
                .map(|s| s.running)
                .unwrap_or(false);
            if !running {
                break;
            }

            let modified = match std::fs::metadata(&config_path).and_then(|meta| meta.modified()) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if last_modified.as_ref().is_some_and(|previous| *previous == modified) {
                continue;
            }
            last_modified = Some(modified);

            let updated = match crate::shared::config::load_config() {
                Ok(config) => config,
                Err(e) => {
                    warn!("Не удалось перечитать config для runtime sync: {}", e);
                    continue;
                }
            };

            if let Ok(mut s) = config_sync_state.write() {
                let changed = s.kb_hook_enabled != updated.kb_hook_enabled
                    || s.mouse_hook_enabled != updated.mouse_hook_enabled
                    || s.restore_mouse_after_macro != updated.restore_mouse_after_macro;

                s.kb_hook_enabled = updated.kb_hook_enabled;
                s.mouse_hook_enabled = updated.mouse_hook_enabled;
                s.restore_mouse_after_macro = updated.restore_mouse_after_macro;

                if changed {
                    info!(
                        "Runtime config applied: keyboard={}, mouse={}, restore_mouse_after_macro={}",
                        s.kb_hook_enabled,
                        s.mouse_hook_enabled,
                        s.restore_mouse_after_macro
                    );
                }
            }
        }
    });

    // NOTE: Автопереключение профилей по активному окну убрано (раньше каждую секунду
    // перетирало ручной выбор пользователя, откатывая на профиль с is_default=true).
    // Профиль выбирается ТОЛЬКО вручную через UI. Последний активный сохраняется в config.
    //
    // ROADMAP: вернуть как настраиваемую фичу — галочка в настройках (вкл/выкл),
    // матчит linked_apps профилей с активным процессом; fallback на дефолт только
    // при включённой опции и без явного ручного выбора пользователя.

    // Запустить фоновый ticker для Tap-Hold (Kanata-style)
    let taphold_state = state.clone();
    tokio_rt.spawn(async move {
        info!("Запущен фоновый ticker для Tap-Hold маппингов");
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            
            // Если daemon останавливается, выходим
            {
                if let Ok(s) = taphold_state.read() {
                    if !s.running {
                        break;
                    }
                }
            }
            
            crate::daemon::engine::tick_tap_holds(Some(&taphold_state));
        }
    });

    // Load active profile
    let profile_id = app_config.active_profile_id.clone();
    let loaded_profile = match crate::shared::persistence::load_profile(&profile_id) {
        Ok(prof) => {
            info!("Profile '{}' successfully loaded from disk", profile_id);
            prof
        }
        Err(_) => {
            info!("Profile '{}' not found on disk. Creating default profile.", profile_id);
            let default_prof = crate::shared::types::Profile {
                id: profile_id.clone(),
                name: "Default".to_string(),
                is_default: true,
                linked_apps: vec![],
                rules: vec![],
                layers: vec![],
            };
            if let Err(e) = crate::shared::persistence::save_profile(&default_prof) {
                error!("Failed to save default profile to disk: {}", e);
            }
            default_prof
        }
    };

    {
        if let Ok(mut s) = state.write() {
            let frontend_config = crate::schemas::frontend::FrontendConfig {
                rules: loaded_profile.rules.clone(),
                layers: loaded_profile.layers.clone(),
                tap_hold_timeout_ms: app_config.tap_hold_timeout_ms,
            };
            s.engine_schema = crate::daemon::compiler::compile_schema(&frontend_config);
            s.active_profile = Some(loaded_profile);
        }
    }

    // Install hooks (keyboard + mouse)
    crate::daemon::hooks::install_hooks(state.clone())?;

    // Update state
    {
        let mut s = state.write().map_err(|e| format!("Failed to lock state: {}", e))?;
        s.hooks_installed = true;
    }

    info!("KeyMaster Pro Daemon started and ready");
    info!("IPC Pipe: {}", constants::IPC_PIPE_NAME);

    // Windows Message Loop - required for SetWindowsHookEx
    // GetMessage blocks until WM_QUIT is received
    run_message_loop(&state);

    // Graceful shutdown
    info!("Daemon shutting down...");
    DAEMON_RUNNING.store(false, Ordering::SeqCst);

    {
        let mut s = shutdown_state.write().map_err(|e| format!("Ошибка блокировки state: {}", e))?;
        s.running = false;
    }

    // Снять хуки
    crate::daemon::hooks::uninstall_hooks();

    // Остановить tokio runtime
    tokio_rt.shutdown_background();

    // Остановить трекер контекста
    crate::trackers::context_tracker::stop_context_tracker();

    info!("KeyMaster Pro Daemon остановлен");
    Ok(())
}

/// Windows Message Loop
///
/// SetWindowsHookEx требует presence message loop в потоке,
/// где установлен hook. Без GetMessage hook callbacks не вызываются.
fn run_message_loop(_state: &DaemonStateRef) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG};

        let mut msg = MSG::default();
        unsafe {
            // GetMessage блокируется, пока не получит WM_QUIT
            // Возвращает >0 если есть сообщение, 0 при WM_QUIT, -1 при ошибке
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                // Hook callbacks вызываются Windows напрямую
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // На не-Windows просто ждём shutdown сигнал
        while DAEMON_RUNNING.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
}

/// Отправить WM_QUIT daemon-процессу для graceful shutdown
pub fn request_shutdown() {
    DAEMON_RUNNING.store(false, Ordering::SeqCst);

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::PostThreadMessageW;
        use windows::Win32::UI::WindowsAndMessaging::WM_QUIT;

        let thread_id = MAIN_THREAD_ID.load(Ordering::SeqCst);
        if thread_id != 0 {
            unsafe {
                let _ = PostThreadMessageW(
                    thread_id,
                    WM_QUIT,
                    windows::Win32::Foundation::WPARAM(0),
                    windows::Win32::Foundation::LPARAM(0),
                );
            }
        }
    }
}

/// Проверить, запущен ли процесс по его PID
fn is_process_alive(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, GetExitCodeProcess};
        use windows::Win32::Foundation::{CloseHandle, GetLastError};

        unsafe {
            let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                Ok(h) => h,
                Err(_) => {
                    let err = GetLastError();
                    // Если отказано в доступе (ERROR_ACCESS_DENIED), то процесс живет, просто у нас нет прав
                    return err == windows::Win32::Foundation::ERROR_ACCESS_DENIED;
                }
            };

            let mut exit_code = 0u32;
            let success = GetExitCodeProcess(handle, &mut exit_code);
            let _ = CloseHandle(handle);

            if success.is_ok() {
                // 259 = STILL_ACTIVE / STATUS_PENDING
                exit_code == 259
            } else {
                false
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

/// Проверить, запущен ли daemon (для GUI)
///
/// Пытаемся подключиться к Named Pipe. Если pipe существует — daemon работает.
pub fn is_daemon_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::CreateFileW;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::Storage::FileSystem::{
            FILE_SHARE_READ, FILE_ATTRIBUTE_NORMAL, OPEN_EXISTING,
        };

        let pipe_name = HSTRING::from(constants::IPC_PIPE_NAME);

        unsafe {
            // CreateFileW в windows 0.62 возвращает Result<HANDLE>
            match CreateFileW(
                &pipe_name,
                0,
                FILE_SHARE_READ,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            ) {
                Ok(handle) => {
                    let _ = CloseHandle(handle);
                    true
                }
                Err(e) => {
                    e.code() == windows::Win32::Foundation::ERROR_PIPE_BUSY.to_hresult()
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
