/// System Tray setup
///
/// Иконка в трее с контекстным меню:
/// - Показать окно
/// - Перезапустить от Администратора
/// - Выйти

use tauri::{
    App, Emitter, Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};

/// Идентификаторы пунктов меню
pub const MENU_SHOW: &str = "show";
pub const MENU_RESTART_ADMIN: &str = "restart_admin";
pub const MENU_QUIT: &str = "quit";

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Создать System Tray с контекстным меню
pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let is_elevated = {
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
                        elevation.TokenIsElevated != 0
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    };

    let mut menu_builder = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id(MENU_SHOW, "Показать KeyMaster Pro").build(app)?);

    if !is_elevated {
        menu_builder = menu_builder.item(
            &MenuItemBuilder::with_id(MENU_RESTART_ADMIN, "🛡️ Перезапустить от Администратора").build(app)?,
        );
    } else {
        menu_builder = menu_builder.item(
            &MenuItemBuilder::with_id(MENU_RESTART_ADMIN, "🛡️ Запущено как Администратор")
                .enabled(false)
                .build(app)?,
        );
    }

    let menu = menu_builder
        .separator()
        .item(&MenuItemBuilder::with_id(MENU_QUIT, "Выйти").build(app)?)
        .build()?;

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
                MENU_SHOW => show_main_window(app),
                MENU_RESTART_ADMIN => {
                    show_main_window(app);
                    let _ = app.emit("app-restart-admin-requested", ());
                }
                MENU_QUIT => {
                    show_main_window(app);
                    let _ = app.emit("app-exit-requested", ());
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { button, button_state, .. } = event {
                if button == tauri::tray::MouseButton::Left && button_state == tauri::tray::MouseButtonState::Up {
                    show_main_window(tray.app_handle());
                }
            }
        })
        .build(app)?;

    app.manage(tray);

    Ok(())
}
