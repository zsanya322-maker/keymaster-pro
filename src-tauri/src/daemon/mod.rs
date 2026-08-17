/// Daemon-специфичный код (background process)
///
/// Запускается с флагом --daemon. Содержит хуки, IPC сервер, движки.
pub mod runner;
pub mod hooks;
pub mod ipc;
pub mod ipc_types;
pub mod ipc_client;
pub mod engine;
pub mod chord_output;
pub mod mouse_triggers;
pub mod profile_runtime;
pub mod state;
pub mod router;
pub mod compiler;

#[cfg(test)]
mod router_tests;
