/// Константы приложения
///
/// Имя pipe, директории, версии и т.д.

/// Имя Named Pipe для IPC GUI ↔ Daemon
pub const IPC_PIPE_NAME: &str = r"\\.\pipe\keymaster-pro-ipc";

/// Имя приложения
pub const APP_NAME: &str = "KeyMaster Pro";

/// Версия схемы данных (для миграций)
pub const DATA_VERSION: u32 = 1;

/// Интервал проверки активного окна (Layer Watcher)
pub const WINDOW_POLL_INTERVAL_MS: u64 = 500;

/// Максимальное количество бэкапов профиля
pub const MAX_BACKUPS: usize = 5;

/// Максимальное время hook callback (мс) — Windows снимает хук после 300мс
pub const HOOK_CALLBACK_TIMEOUT_MS: u32 = 300;
