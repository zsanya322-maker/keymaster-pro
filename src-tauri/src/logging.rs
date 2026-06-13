/// Logging setup — tracing subscriber
///
/// Логирование в файл %APPDATA%\KeyMaster Pro\logs\daemon.log
/// Это важно для отладки фонового daemon-процесса, у которого нет консоли.

use tracing_subscriber::{fmt, EnvFilter};
use std::fs;
use std::path::PathBuf;

/// Инициализировать логгер
pub fn init_logging() -> Result<(), String> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| {
            if cfg!(debug_assertions) {
                EnvFilter::new("debug")
            } else {
                EnvFilter::new("info")
            }
        });

    // Получаем путь к APPDATA/KeyMaster Pro/logs
    let app_data = std::env::var("APPDATA")
        .map_err(|e| format!("Не удалось получить APPDATA: {}", e))?;
    let log_dir = PathBuf::from(app_data).join("KeyMaster Pro").join("logs");
    
    // Создаем директорию логов
    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Не удалось создать папку логов {}: {}", log_dir.display(), e))?;

    let log_path = log_dir.join("daemon.log");
    
    // Открываем файл для дозаписи логов
    let file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Не удалось открыть файл логов {}: {}", log_path.display(), e))?;

    // Инициализируем подписчик с выводом в файл
    fmt()
        .with_env_filter(filter)
        .with_writer(file)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .init();

    Ok(())
}