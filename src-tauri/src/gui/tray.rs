/// System Tray setup
///
/// Иконка в трее с контекстным меню:
/// - Показать окно
/// - Перезапустить от Администратора
/// - Выйти

use tauri::{
    App, Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};

/// Идентификаторы пунктов меню
pub const MENU_SHOW: &str = "show";
pub const MENU_RESTART_ADMIN: &str = "restart_admin";

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
        .quit()
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
                MENU_SHOW => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                MENU_RESTART_ADMIN => {
                    let exe_path = std::env::current_exe()
                        .ok()
                        .and_then(|p| p.to_str().map(|s| s.to_string()));
                    if let Some(exe) = exe_path {
                        #[cfg(target_os = "windows")]
                        unsafe {
                            use windows::Win32::UI::Shell::ShellExecuteW;
                            use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
                            use windows::core::HSTRING;
                            let verb = HSTRING::from("runas");
                            let file = HSTRING::from(exe);
                            let _ = ShellExecuteW(None, &verb, &file, None, None, SW_SHOWNORMAL);
                            std::process::exit(0);
                        }
                    }
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
