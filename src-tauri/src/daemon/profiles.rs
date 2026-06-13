use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, RwLock};
use tracing::info;

/// Profile Manager
///
/// Управление профилями: загрузка, переключение, auto-detect по окну.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub linked_apps: Vec<String>,
}

// Потокобезопасное состояние (пока в памяти, позже подключим shared::persistence)
static PROFILES: LazyLock<RwLock<Vec<Profile>>> = LazyLock::new(|| {
    RwLock::new(vec![Profile {
        id: "1".to_string(),
        name: "Default (По умолчанию)".to_string(),
        is_default: true,
        linked_apps: vec![],
    }])
});

static ACTIVE_PROFILE_ID: LazyLock<RwLock<Option<String>>> =
    LazyLock::new(|| RwLock::new(Some("1".to_string())));

/// Загрузить профиль по ID
pub fn load_profile(id: &str) -> Result<(), String> {
    let profiles = PROFILES.read().map_err(|_| "Failed to lock profiles")?;
    
    if profiles.iter().any(|p| p.id == id) {
        let mut active = ACTIVE_PROFILE_ID.write().map_err(|_| "Failed to lock active id")?;
        *active = Some(id.to_string());
        info!("Профиль {} загружен", id);
        Ok(())
    } else {
        Err(format!("Профиль {} не найден", id))
    }
}

/// Получить активный профиль
pub fn get_active_profile() -> Option<String> {
    ACTIVE_PROFILE_ID.read().ok()?.clone()
}

/// Получить все профили
pub fn get_all_profiles() -> Vec<Profile> {
    PROFILES.read().map(|p| p.clone()).unwrap_or_default()
}

/// Удалить профиль
pub fn delete_profile(id: &str) -> Result<(), String> {
    let mut profiles = PROFILES.write().map_err(|_| "Failed to lock profiles")?;
    profiles.retain(|p| p.id != id);
    info!("Профиль {} удален", id);
    Ok(())
}

/// Переключить профиль
pub fn switch_profile(id: &str) -> Result<(), String> {
    info!("Переключение на профиль: {}", id);
    load_profile(id)?;
    // TODO: обновить engine (ремаппинги, слои), уведомить GUI
    Ok(())
}