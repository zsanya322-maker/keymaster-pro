/// Tauri commands (invoke handlers)
///
/// GUI вызывает эти функции через tauri.invoke().
/// Они перенаправляют запросы в Daemon через Named Pipe IPC.

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

/// Запустить daemon-процесс из GUI
///
/// GUI spawn'ит себя с флагом `--daemon` как дочерний процесс.
/// Daemon работает в фоне и общается через Named Pipe.
#[tauri::command]
pub fn spawn_daemon(state: State<'_, GuiState>) -> Result<serde_json::Value, String> {
    let exe_path = state.exe_path.as_ref()
        .ok_or("Не удалось определить путь к исполняемому файлу")?;

    // Проверяем, не запущен ли уже daemon
    if crate::daemon::runner::is_daemon_running() {
        info!("Daemon уже запущен");
        return Ok(serde_json::json!({
            "success": true,
            "message": "Daemon already running"
        }));
    }

    // Проверяем атомарный флаг, чтобы избежать двойного запуска из-за StrictMode
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

    // Spawn daemon как отдельный процесс
    let child = match std::process::Command::new(exe_path)
        .arg("--daemon")
        .arg("--parent-pid")
        .arg(current_pid.to_string())
        .creation_flags(0x00000008) // DETACHED_PROCESS — без консольного окна
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

/// Остановить daemon-процесс через IPC
#[tauri::command]
pub async fn stop_daemon() -> Result<serde_json::Value, String> {
    info!("stop_daemon: отправка shutdown через IPC");
    match crate::daemon::ipc_client::call("shutdown", None).await {
        Ok(result) => Ok(result),
        Err(e) => {
            warn!("stop_daemon: не удалось отправить команду: {}", e);
            Ok(serde_json::json!({
                "success": false,
                "message": format!("IPC error: {}", e)
            }))
        }
    }
}

/// Получить статус Daemon через IPC
#[tauri::command]
pub async fn daemon_status(state: State<'_, GuiState>) -> Result<serde_json::Value, String> {
    // Запрашиваем статус напрямую через IPC (без предварительной проверки pipe_exists,
    // чтобы избежать race condition при быстром переподключении Named Pipe)
    match crate::daemon::ipc_client::call("get_status", None).await {
        Ok(status) => Ok(serde_json::json!({
            "connected": true,
            "status": "running",
            "details": status
        })),
        Err(_) => {
            state.spawning.store(false, Ordering::SeqCst);
            Ok(serde_json::json!({
                "connected": false,
                "status": "stopped"
            }))
        }
    }
}

/// IPC-прокси: отправить произвольный JSON-RPC запрос в Daemon
///
/// `params` опционален: фронтенд вызывает методы без параметров (profile.list, get_config,
/// open_log_folder, macro.start_recording, macro.stop_recording) как
/// `invoke('ipc_call', { method })` — без поля params. Обязательный аргумент
/// здесь ломал бы десериализацию Tauri и команда падала бы ДО пайпа.
#[tauri::command]
pub async fn ipc_call(method: String, params: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    crate::daemon::ipc_client::call(&method, params).await
}

/// Тестовая команда
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Привет, {}! KeyMaster Pro работает 🎉", name)
}

/// Перезапустить приложение (используется после обновления)
#[tauri::command]
pub fn restart_app(app_handle: tauri::AppHandle) {
    info!("restart_app: перезапуск приложения");
    app_handle.restart();
}

/// Перезапустить приложение от имени Администратора (UAC)
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

/// Проверить, запущено ли приложение с правами Администратора (UAC)
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

/// Загрузить конфигурацию приложения напрямую из config.json (без IPC с демоном)
#[tauri::command]
pub fn get_gui_config() -> Result<serde_json::Value, String> {
    let config = crate::shared::config::load_config()?;
    Ok(serde_json::to_value(config).unwrap())
}