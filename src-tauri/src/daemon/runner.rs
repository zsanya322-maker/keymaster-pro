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
use crate::logging;
use crate::shared::config;
use crate::shared::constants;

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

/// Разрешить профиль, с которым daemon должен стартовать.
///
/// Recovery-профиль от повреждённого/несовместимого файла никогда не становится
/// активным runtime-профилем, если можно выбрать здоровый fallback. Исходный
/// повреждённый файл при этом остаётся на диске и показывается GUI отдельно.
fn resolve_startup_profile(
    app_config: &mut crate::shared::types::AppConfig,
) -> Result<crate::shared::types::Profile, String> {
    let configured_id = app_config.active_profile_id.clone();
    if let Ok(profile) = crate::shared::persistence::load_profile_checked(&configured_id) {
        info!("Profile '{}' successfully loaded from disk", configured_id);
        return Ok(profile);
    }

    warn!(
        "Configured active profile '{}' is unavailable/corrupt; selecting safe fallback",
        configured_id
    );

    let ids = crate::shared::persistence::list_profiles()?;
    let had_profile_files = !ids.is_empty();
    let mut first_readable = None;
    let mut selected_default = None;

    for id in ids {
        if id == configured_id {
            continue;
        }
        match crate::shared::persistence::load_profile_checked(&id) {
            Ok(profile) => {
                if profile.is_default {
                    selected_default = Some(profile);
                    break;
                }
                if first_readable.is_none() {
                    first_readable = Some(profile);
                }
            }
            Err(error) => {
                warn!("Skipping unhealthy fallback profile '{}': {}", id, error);
            }
        }
    }

    let profile = if let Some(profile) = selected_default.or(first_readable) {
        info!("Startup fallback profile selected: '{}'", profile.id);
        profile
    } else {
        // Empty installation keeps the historical ID `1`. If files exist but
        // none are healthy, create a fresh UUID instead of risking overwrite
        // of an incompatible/corrupt `1.json`.
        let id = if had_profile_files {
            uuid::Uuid::new_v4().to_string()
        } else {
            "1".to_string()
        };
        let default_profile = crate::shared::types::Profile {
            id: id.clone(),
            name: "Default".to_string(),
            is_default: true,
            linked_apps: vec![],
            rules: vec![],
            layers: vec![],
        };
        crate::shared::persistence::save_profile(&default_profile)?;
        info!("Created startup default profile '{}'", id);
        default_profile
    };

    if app_config.active_profile_id != profile.id {
        app_config.active_profile_id = profile.id.clone();
        config::save_config(app_config)?;
        info!(
            "Recovered activeProfileId in config -> '{}'",
            app_config.active_profile_id
        );
    }

    Ok(profile)
}

#[cfg(target_os = "windows")]
fn prepare_main_thread_message_queue() {
    use windows::Win32::UI::WindowsAndMessaging::{PeekMessageW, MSG, PM_NOREMOVE};

    // PostThreadMessageW работает только после создания message queue у потока.
    // Создаём её ДО запуска фоновых задач, чтобы ранний IPC/watchdog shutdown не
    // потерял WM_QUIT в startup-гонке.
    let mut msg = MSG::default();
    unsafe {
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
    }
}

/// Запустить daemon-процесс
///
/// Вызывается из main.rs когда передан флаг `--daemon`.
/// Блокирует текущий поток до получения сигнала завершения.
pub fn run_daemon(parent_pid: Option<u32>) -> Result<(), String> {
    DAEMON_RUNNING.store(true, Ordering::SeqCst);

    #[cfg(target_os = "windows")]
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::SetProcessDPIAware();
    }

    // Initialize logger
    logging::init_logging()?;
    info!(
        "KeyMaster Pro Daemon v{} starting...",
        env!("CARGO_PKG_VERSION")
    );

    // Save main thread ID and create its message queue before any background
    // task can call request_shutdown().
    #[cfg(target_os = "windows")]
    unsafe {
        MAIN_THREAD_ID.store(
            windows::Win32::System::Threading::GetCurrentThreadId(),
            Ordering::SeqCst,
        );
        prepare_main_thread_message_queue();
    }

    // load_config сам безопасно восстанавливает повреждённый legacy config, но
    // future schema / I/O failure считаются fatal: старый daemon не имеет права
    // запускаться с дефолтами и затем случайно перезаписать более новый config.
    let mut app_config = config::load_config()
        .map_err(|e| format!("Не удалось безопасно загрузить config.json: {}", e))?;
    info!("Configuration loaded. Language: {}", app_config.language);
    let loaded_profile = resolve_startup_profile(&mut app_config)?;

    // Create shared state
    let state = DaemonState::from_config(&app_config).into_ref();

    // Start Simulator Actor
    let simulator_tx = crate::simulator::spawn_simulator_thread();
    if let Ok(mut s) = state.write() {
        s.simulator = Some(simulator_tx);
    }

    // Start Context Tracker
    crate::trackers::context_tracker::spawn_context_tracker(
        crate::context::AppContextState::default(),
    );

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

    // Start IPC server in Tokio. start_ipc_server enforces ownership of the
    // first pipe instance, so a duplicate daemon exits instead of installing a
    // second global hook engine against the same IPC name.
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
                    warn!(
                        "Родительский процесс PID {} завершился. Самоликвидация daemon'а...",
                        pid
                    );
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
            if last_modified
                .as_ref()
                .is_some_and(|previous| *previous == modified)
            {
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

            if let Ok(s) = taphold_state.read() {
                if !s.running {
                    break;
                }
            }

            crate::daemon::engine::tick_tap_holds(Some(&taphold_state));
        }
    });

    // Compile the already-resolved startup profile into runtime state.
    {
        if let Ok(mut s) = state.write() {
            let frontend_config = crate::schemas::frontend::FrontendConfig {
                rules: loaded_profile.rules.clone(),
                layers: loaded_profile.layers.clone(),
                tap_hold_timeout_ms: app_config.tap_hold_timeout_ms,
            };
            s.engine_schema = crate::daemon::compiler::compile_schema(&frontend_config);
            s.active_profile_id = loaded_profile.id.clone();
            s.active_profile = Some(loaded_profile);
        }
    }

    // Install hooks (keyboard + mouse)
    crate::daemon::hooks::install_hooks(state.clone())?;

    {
        let mut s = state
            .write()
            .map_err(|e| format!("Failed to lock state: {}", e))?;
        s.hooks_installed = true;
    }

    info!("KeyMaster Pro Daemon started and ready");
    info!("IPC Pipe: {}", constants::IPC_PIPE_NAME);

    run_message_loop(&state);

    // Graceful shutdown
    info!("Daemon shutting down...");
    DAEMON_RUNNING.store(false, Ordering::SeqCst);

    {
        let mut s = shutdown_state
            .write()
            .map_err(|e| format!("Ошибка блокировки state: {}", e))?;
        s.running = false;
    }

    crate::daemon::hooks::uninstall_hooks();
    tokio_rt.shutdown_background();
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

        // Если startup-задача уже запросила shutdown (например duplicate daemon
        // не смог получить first pipe instance), не блокируемся в GetMessage.
        if !DAEMON_RUNNING.load(Ordering::SeqCst) {
            return;
        }

        let mut msg = MSG::default();
        unsafe {
            loop {
                let result = GetMessageW(&mut msg, None, 0, 0).0;
                if result > 0 {
                    continue;
                }
                if result < 0 {
                    error!("GetMessageW завершился с ошибкой; daemon останавливается");
                }
                break;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
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
        use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};

        let thread_id = MAIN_THREAD_ID.load(Ordering::SeqCst);
        if thread_id != 0 {
            unsafe {
                if let Err(e) = PostThreadMessageW(
                    thread_id,
                    WM_QUIT,
                    windows::Win32::Foundation::WPARAM(0),
                    windows::Win32::Foundation::LPARAM(0),
                ) {
                    warn!("Не удалось отправить WM_QUIT главному потоку daemon: {}", e);
                }
            }
        }
    }
}

/// Проверить, запущен ли процесс по его PID
fn is_process_alive(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{CloseHandle, GetLastError};
        use windows::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        unsafe {
            let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                Ok(h) => h,
                Err(_) => {
                    let err = GetLastError();
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

/// Проверить наличие daemon Named Pipe, не подключаясь к нему.
///
/// Старый CreateFileW-probe сам становился клиентом pipe и создавал лишний
/// accept/disconnect цикл. WaitNamedPipeW проверяет наличие/занятость без такого
/// побочного эффекта.
pub fn is_daemon_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::core::HSTRING;
        use windows::Win32::Foundation::{GetLastError, ERROR_PIPE_BUSY, ERROR_SEM_TIMEOUT};
        use windows::Win32::System::Pipes::WaitNamedPipeW;

        let pipe_name = HSTRING::from(constants::IPC_PIPE_NAME);
        unsafe {
            let ready = WaitNamedPipeW(&pipe_name, 0);
            if ready.as_bool() {
                return true;
            }

            let error = GetLastError();
            // Timeout/busy означает, что pipe существует, просто сейчас нет
            // свободного instance. Это всё ещё "daemon running".
            error == ERROR_SEM_TIMEOUT || error == ERROR_PIPE_BUSY
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
