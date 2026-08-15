/// Tauri commands (invoke handlers)
///
/// GUI вызывает эти функции через tauri.invoke().
/// Большинство runtime-команд перенаправляются в Daemon через Named Pipe IPC,
/// а GUI-конфигурация читается/пишется напрямую, чтобы настройки сохранялись
/// даже при остановленном демоне.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;
use tracing::{info, warn};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Состояние GUI процесса
pub struct GuiState {
    /// Путь к текущему исполняемому файлу (для spawn daemon)
    exe_path: Option<String>,
    /// Флаг, указывающий, что запуск daemon-процесса уже выполняется
    spawning: AtomicBool,
}

impl Default for GuiState {
    fn default() -> Self {
        let exe_path = std::env::current_exe()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()));
        Self {
            exe_path,
            spawning: AtomicBool::new(false),
        }
    }
}

/// Запустить daemon-процесс из GUI.
#[tauri::command]
pub fn spawn_daemon(state: State<'_, GuiState>) -> Result<serde_json::Value, String> {
    let exe_path = state
        .exe_path
        .as_ref()
        .ok_or("Не удалось определить путь к исполняемому файлу")?;

    if crate::daemon::runner::is_daemon_running() {
        state.spawning.store(false, Ordering::SeqCst);
        info!("Daemon уже запущен");
        return Ok(serde_json::json!({
            "success": true,
            "message": "Daemon already running"
        }));
    }

    if state.spawning.swap(true, Ordering::SeqCst) {
        info!("Запуск daemon уже выполняется, игнорируем дублирующий вызов");
        return Ok(serde_json::json!({
            "success": true,
            "message": "Daemon spawn already in progress"
        }));
    }

    let current_pid = std::process::id();
    let pipe_path = crate::shared::constants::IPC_PIPE_NAME;
    info!(
        "Запуск daemon-процесса: {} --daemon --parent-pid {}",
        exe_path, current_pid
    );
    info!("Ожидаемый Named Pipe: {}", pipe_path);

    let child = match std::process::Command::new(exe_path)
        .arg("--daemon")
        .arg("--parent-pid")
        .arg(current_pid.to_string())
        .creation_flags(0x00000008)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            state.spawning.store(false, Ordering::SeqCst);
            return Err(format!("Не удалось запустить daemon: {}", e));
        }
    };

    let pid = child.id();
    info!("Daemon запущен с PID: {}", pid);

    Ok(serde_json::json!({
        "success": true,
        "pid": pid,
        "message": "Daemon started"
    }))
}

/// Дождаться появления Named Pipe, если daemon уже был spawn'нут, но ещё
/// находится в коротком startup-окне до запуска IPC server.
async fn wait_for_spawning_daemon(state: &GuiState) {
    if crate::daemon::runner::is_daemon_running() || !state.spawning.load(Ordering::SeqCst) {
        return;
    }

    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        if crate::daemon::runner::is_daemon_running() {
            return;
        }
        if !state.spawning.load(Ordering::SeqCst) {
            return;
        }
    }
}

/// Реальная остановка daemon. Учитывает гонку spawn -> pipe и возвращает успех
/// только после исчезновения Named Pipe.
async fn stop_daemon_impl(state: &GuiState) -> Result<serde_json::Value, String> {
    wait_for_spawning_daemon(state).await;

    if !crate::daemon::runner::is_daemon_running() {
        state.spawning.store(false, Ordering::SeqCst);
        return Ok(serde_json::json!({
            "success": true,
            "message": "Daemon already stopped"
        }));
    }

    // После появления pipe daemon уже вышел из spawn-фазы. Новый spawn разрешим
    // только когда текущий процесс действительно исчезнет.
    state.spawning.store(false, Ordering::SeqCst);
    info!("stop_daemon: отправка shutdown через IPC");

    let shutdown_error = crate::daemon::ipc_client::call("shutdown", None)
        .await
        .err();
    if let Some(ref error) = shutdown_error {
        // Даже при ошибке чтения ответа daemon мог успеть принять shutdown.
        // Проверяем фактическое состояние pipe, прежде чем объявлять failure.
        warn!("stop_daemon: IPC shutdown вернул ошибку: {}", error);
    }

    for _ in 0..30 {
        if !crate::daemon::runner::is_daemon_running() {
            info!("stop_daemon: daemon полностью остановлен");
            return Ok(serde_json::json!({
                "success": true,
                "message": "Daemon stopped"
            }));
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    let message = shutdown_error
        .map(|error| format!("Daemon shutdown failed after IPC error: {}", error))
        .unwrap_or_else(|| "Daemon shutdown timeout".to_string());
    warn!("stop_daemon: {}", message);
    Ok(serde_json::json!({
        "success": false,
        "message": message
    }))
}

/// Остановить daemon-процесс через IPC.
#[tauri::command]
pub async fn stop_daemon(state: State<'_, GuiState>) -> Result<serde_json::Value, String> {
    stop_daemon_impl(&state).await
}

async fn stop_daemon_before_process_transition(
    reason: &str,
    state: &GuiState,
) -> Result<(), String> {
    let result = stop_daemon_impl(state).await?;
    if result.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let message = result
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("daemon did not stop");
        warn!("{}: daemon не подтвердил остановку: {}", reason, message);
        return Err(format!("Не удалось остановить daemon перед {}: {}", reason, message));
    }
    Ok(())
}

/// Получить статус Daemon через IPC.
/// Любой завершившийся status-check снимает spawn-guard: если daemon уже
/// отвечает — запуск завершён успешно; если не отвечает — следующий retry
/// имеет право попробовать запустить процесс ещё раз.
#[tauri::command]
pub async fn daemon_status(state: State<'_, GuiState>) -> Result<serde_json::Value, String> {
    match crate::daemon::ipc_client::call("get_status", None).await {
        Ok(status) => {
            state.spawning.store(false, Ordering::SeqCst);
            Ok(serde_json::json!({
                "connected": true,
                "status": "running",
                "details": status
            }))
        }
        Err(_) => {
            state.spawning.store(false, Ordering::SeqCst);
            Ok(serde_json::json!({
                "connected": false,
                "status": "stopped"
            }))
        }
    }
}

/// IPC-прокси: отправить произвольный JSON-RPC запрос в Daemon.
#[tauri::command]
pub async fn ipc_call(
    method: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    crate::daemon::ipc_client::call(&method, params).await
}

/// Тестовая команда.
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Привет, {}! KeyMaster Pro работает 🎉", name)
}

/// Полностью завершить GUI. Quit остаётся best-effort: если daemon завис,
/// пользователь всё равно должен иметь возможность закрыть приложение, а
/// parent-PID watchdog останется аварийной страховкой.
#[tauri::command]
pub async fn quit_app(
    app_handle: tauri::AppHandle,
    state: State<'_, GuiState>,
) -> Result<(), String> {
    info!("quit_app: explicit application exit");
    if let Err(error) = stop_daemon_before_process_transition("quit_app", &state).await {
        warn!("quit_app: продолжаем выход после ошибки daemon: {}", error);
    }
    app_handle.exit(0);
    Ok(())
}

/// Перезапустить приложение (используется после обновления).
/// В отличие от обычного Quit, restart запрещён, если старый daemon не удалось
/// полностью остановить: новый GUI не должен подключаться к daemon старого PID.
#[tauri::command]
pub async fn restart_app(
    app_handle: tauri::AppHandle,
    state: State<'_, GuiState>,
) -> Result<(), String> {
    info!("restart_app: перезапуск приложения");
    stop_daemon_before_process_transition("restart_app", &state).await?;
    app_handle.restart();
}

/// Перезапустить приложение от имени Администратора (UAC).
#[tauri::command]
pub async fn restart_as_admin(state: State<'_, GuiState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let exe_path = state
            .exe_path
            .clone()
            .ok_or("Не удалось определить путь к исполняемому файлу")?;

        // Не запускаем elevated-копию, пока старый daemon не исчез полностью.
        stop_daemon_before_process_transition("restart_as_admin", &state).await?;

        let verb = HSTRING::from("runas");
        let file = HSTRING::from(exe_path);
        // Elevated-процесс создаётся пока старый GUI ещё жив. Он подождёт ДО
        // запуска Tauri/single-instance, чтобы старый instance lock успел уйти.
        let parameters = HSTRING::from("--gui-delay-ms 650");

        let launch_result = unsafe {
            ShellExecuteW(None, &verb, &file, &parameters, None, SW_SHOWNORMAL)
        };
        let launch_code = launch_result.0 as isize;

        if launch_code <= 32 {
            warn!(
                "restart_as_admin: ShellExecuteW failed/cancelled, code={}",
                launch_code
            );
            // Мы уже штатно остановили daemon. Если пользователь отменил UAC,
            // оставляем старое GUI открытым и возвращаем ему engine обратно.
            state.spawning.store(false, Ordering::SeqCst);
            if let Err(error) = spawn_daemon(state) {
                warn!("restart_as_admin: не удалось восстановить daemon: {}", error);
            }
            return Err(format!(
                "Запуск от Администратора отменён или завершился ошибкой (код {})",
                launch_code
            ));
        }

        std::process::exit(0);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported on this OS".to_string())
    }
}

/// Проверить, запущено ли приложение с правами Администратора (UAC).
#[tauri::command]
pub fn is_elevated() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        unsafe {
            let mut token = windows::Win32::Foundation::HANDLE::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_ok() {
                let mut elevation = TOKEN_ELEVATION::default();
                let mut size = 0;
                if GetTokenInformation(
                    token,
                    TokenElevation,
                    Some(&mut elevation as *mut _ as *mut _),
                    std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                    &mut size,
                )
                .is_ok()
                {
                    return elevation.TokenIsElevated != 0;
                }
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Загрузить конфигурацию приложения напрямую из config.json.
#[tauri::command]
pub fn get_gui_config() -> Result<serde_json::Value, String> {
    let config = crate::shared::config::load_config()?;
    serde_json::to_value(config).map_err(|e| format!("Ошибка сериализации config: {}", e))
}

/// Частично обновить GUI-конфигурацию напрямую в config.json.
///
/// Patch сначала сливается с текущей конфигурацией, затем весь результат
/// десериализуется обратно в AppConfig. Поэтому неизвестные типы/некорректные
/// значения не могут тихо записать повреждённый config.json.
#[tauri::command]
pub fn update_gui_config(patch: serde_json::Value) -> Result<serde_json::Value, String> {
    let current = crate::shared::config::load_config()?;
    let mut merged = serde_json::to_value(current)
        .map_err(|e| format!("Ошибка сериализации текущего config: {}", e))?;

    let patch_object = patch
        .as_object()
        .ok_or_else(|| "Patch конфигурации должен быть JSON-объектом".to_string())?;
    let merged_object = merged
        .as_object_mut()
        .ok_or_else(|| "Текущая конфигурация не является JSON-объектом".to_string())?;

    for (key, value) in patch_object {
        if !merged_object.contains_key(key) {
            return Err(format!("Неизвестное поле конфигурации: {}", key));
        }
        merged_object.insert(key.clone(), value.clone());
    }

    let validated: crate::shared::types::AppConfig = serde_json::from_value(merged)
        .map_err(|e| format!("Некорректное значение конфигурации: {}", e))?;
    crate::shared::config::save_config(&validated)?;

    serde_json::to_value(validated)
        .map_err(|e| format!("Ошибка сериализации сохранённого config: {}", e))
}
