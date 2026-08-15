/// KeyMaster Pro Library
///
/// Handles Tauri GUI initialization, plugin registration, and commands.

pub mod daemon;
pub mod gui;
pub mod shared;
pub mod logging;
pub mod schemas;
pub mod context;
pub mod trackers;
pub mod simulator;

use gui::commands::GuiState;
use tauri::{Emitter, Manager};
use tracing::{info, error};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    info!("Starting GUI process");

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(GuiState::default())
        .invoke_handler(tauri::generate_handler![
            gui::commands::greet,
            gui::commands::ipc_call,
            gui::commands::daemon_status,
            gui::commands::spawn_daemon,
            gui::commands::stop_daemon,
            gui::commands::quit_app,
            gui::commands::restart_app,
            gui::commands::restart_as_admin,
            gui::commands::is_elevated,
            gui::commands::get_gui_config,
            gui::commands::update_gui_config,
        ])
        .setup(|app| {
            // Spawn background task to listen for daemon events
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
                use tokio::net::windows::named_pipe::ClientOptions;
                use tauri::Emitter;

                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    let pipe_path = crate::shared::constants::IPC_PIPE_NAME;
                    
                    let mut pipe = match ClientOptions::new().open(pipe_path) {
                        Ok(p) => {
                            tracing::info!("GUI event listener connected to Named Pipe: {}", pipe_path);
                            p
                        },
                        Err(_) => continue,
                    };

                    let sub_request = crate::daemon::ipc_types::JsonRpcRequest {
                        jsonrpc: "2.0".to_string(),
                        method: "subscribe_events".to_string(),
                        params: None,
                        id: Some(serde_json::json!(999)),
                    };

                    let mut req_bytes = match serde_json::to_string(&sub_request) {
                        Ok(r) => r,
                        Err(_) => continue,
                    };
                    req_bytes.push('\n');

                    if pipe.write_all(req_bytes.as_bytes()).await.is_err() {
                        continue;
                    }
                    if pipe.flush().await.is_err() {
                        continue;
                    }

                    let (reader, mut _writer) = tokio::io::split(pipe);
                    let mut lines = BufReader::new(reader).lines();

                    if lines.next_line().await.is_err() {
                        continue;
                    }

                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Ok(event) = serde_json::from_str::<crate::gui::events::DaemonEvent>(&line) {
                            let _ = app_handle.emit("daemon-event", event);
                        }
                    }
                }
            });

            // Check window icon
            let has_icon = app.default_window_icon().is_some();
            info!("Default window icon loaded: {}", has_icon);

            // Set up System Tray
            if let Err(e) = gui::tray::setup_tray(app) {
                error!("Failed to set up system tray: {:?}", e);
                return Err(e);
            }
            info!("System tray configured successfully");

            // Workaround: show and focus window on startup
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                info!("Main window focused");
            } else {
                error!("Main webview window not found");
            }

            info!("GUI initialization complete");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let minimize_to_tray = crate::shared::config::load_config()
                    .map(|config| config.minimize_to_tray)
                    .unwrap_or(true);

                if minimize_to_tray {
                    let _ = window.hide();
                } else {
                    // Само окно не закрываем сразу: React проверит, есть ли
                    // несохранённый черновик, и при необходимости покажет
                    // внутренний ConfirmDialog. Явный quit_app() завершит процесс.
                    let _ = window.emit("app-exit-requested", ());
                }
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri execution failed");
}
