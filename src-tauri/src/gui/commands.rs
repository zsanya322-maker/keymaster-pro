/// Tauri commands (invoke handlers)
///
/// GUI вызывает эти функции через tauri.invoke().
/// Большинство runtime-команд перенаправляются в Daemon через Named Pipe IPC,
/// а GUI-конфигурация читается/пишется напрямую, чтобы настройки сохранялись
/// даже при остановленном демоне.

use tauri::State;
use tracing::{info, warn};
use std::sync::atomic::{AtomicBool, Ordering};

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
    let exe_path = state.exe_path.as_ref()
        .ok_or("Не удалось определить путь к исполняемому файлу")?;

    if crate::daemon::runner::is_daemon_running() {
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
    info!("Запуск daemon-процесса: {} --daemon --parent-pid {}", exe_path, current_pid);
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

/// Остановить daemon-процесс через IPC.
/// Возвращаем успех только когда Named Pipe действительно исчез. Это делает
/// последовательность stop -> spawn детерминированной и не требует угадывать
/// задержку завершения daemon в GUI.
#[tauri::command]
pub async fn stop_daemon() -> Result<serde_json::Value, String> {
    info!("stop_daemon: отправка shutdown через IPC");
    if let Err(e) = crate::daemon::ipc_client::call("shutdown", None).await {
        warn!("stop_daemon: не удалось отправить команду: {}", e);
        return Ok(serde_json::json!({
            "success": false,
            "message": format!("IPC error: {}", e)
        }));
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

    warn!("stop_daemon: timeout ожидания завершения daemon");
    Ok(serde_json::json!({
        "success": false,
        "message": "Daemon shutdown timeout"
    }))
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
pub async fn ipc_call(method: String, params: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    crate::daemon::ipc_client::call(&method, params).await
}

/// Тестовая команда.
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Привет, {}! KeyMaster Pro работает 🎉", name)
}

/// Полностью завершить GUI. В отличие от закрытия окна, эта команда всегда
/// означает явный пункт меню «Выход» и не должна превращаться в hide-to-tray.
#[tauri::command]
pub fn quit_app(app_handle: tauri::AppHandle) {
    info!("quit_app: explicit application exit");
    app_handle.exit(0);
}

/// Перезапустить приложение (используется после обновления).
#[tauri::command]
pub fn restart_app(app_handle: tauri::AppHandle) {
    info!("restart_app: перезапуск приложения");
    app_handle.restart();
}

/// Перезапустить приложение от имени Администратора (UAC).
#[tauri::command]
pub fn restart_as_admin(state: State<'_, GuiState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        use windows::core::HSTRING;

        let exe_path = state.exe_path.as_ref()
            .ok_or("Не удалось определить путь к исполняемому файлу")?;

        let verb = HSTRING::from("runas");
        let file = HSTRING::from(exe_path);

        let _ = ShellExecuteW(
            None,
            &verb,
            &file,
            None,
            None,
            SW_SHOWNORMAL,
        );
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
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
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
                ).is_ok() {
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
