/// Daemon-специфичный код (background process)
///
/// Запускается с флагом --daemon. Содержит хуки, IPC сервер, движки.
pub mod runner;
pub mod hooks;
pub mod ipc;
pub mod ipc_types;
pub mod ipc_client;
pub mod engine;
pub mod profiles;
pub mod state;
pub mod layers;
pub mod macros;
pub mod router;
pub mod text_expansions;
