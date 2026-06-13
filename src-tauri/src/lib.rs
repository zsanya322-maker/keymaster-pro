/// KeyMaster Pro Library
///
/// Handles Tauri GUI initialization, plugin registration, and commands.

pub mod daemon;
pub mod gui;
pub mod shared;
pub mod logging;

use gui::commands::GuiState;
use tauri::Manager;
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
            gui::commands::restart_app,
        ])
        .setup(|app| {
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
            // Hide window instead of closing
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri execution failed");
}