/// System Tray setup
///
/// Иконка в трее с контекстным меню:
/// - Показать окно
/// - Включить/Выключить хуки
/// - Активный профиль
/// - Выйти

use tauri::{
    App, Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};

/// Идентификаторы пунктов меню
pub const MENU_SHOW: &str = "show";
pub const MENU_HOOKS_TOGGLE: &str = "hooks_toggle";

/// Создать System Tray с контекстным меню
pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    // Контекстное меню
    let menu = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id(MENU_SHOW, "Показать KeyMaster Pro").build(app)?)
        .item(&MenuItemBuilder::with_id(MENU_HOOKS_TOGGLE, "⏸ Отключить хуки").build(app)?)
        .separator()
        .quit()
        .build()?;

    // Tray icon
    let icon = match app.default_window_icon() {
        Some(icon) => icon.clone(),
        None => {
            tracing::warn!("Default window icon not found");
            return Err("Default window icon not found".into());
        }
    };

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("KeyMaster Pro - active")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                MENU_SHOW => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                MENU_HOOKS_TOGGLE => {
                    // IPC command toggle_hooks to daemon is not implemented yet
                    tracing::info!("Tray: toggle hooks (IPC not implemented)");
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { button, button_state, .. } = event {
                if button == tauri::tray::MouseButton::Left && button_state == tauri::tray::MouseButtonState::Up {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    app.manage(tray);

    Ok(())
}