/// Конфигурация приложения (config.json)
///
/// Чтение/запись настроек в %APPDATA%\KeyMaster Pro\config.json

use std::fs;

use tracing::{info, warn};

use crate::shared::types::AppConfig;

/// Загрузить конфигурацию из файла или создать дефолтную
pub fn load_config() -> Result<AppConfig, String> {
    let dir = super::persistence::app_data_dir()?;
    let path = dir.join("config.json");

    if !path.exists() {
        info!("Конфиг не найден, создаём дефолтный");
        let config = AppConfig::default();
        save_config(&config)?;
        return Ok(config);
    }

    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Ошибка чтения config.json: {}", e))?;

    match serde_json::from_str(&data) {
        Ok(config) => {
            info!("Конфигурация загружена");
            Ok(config)
        }
        Err(e) => {
            warn!("Ошибка парсинга config.json: {}, используем дефолтный", e);
            Ok(AppConfig::default())
        }
    }
}

/// Сохранить конфигурацию в файл
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let dir = super::persistence::app_data_dir()?;
    let path = dir.join("config.json");

    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Ошибка сериализации config: {}", e))?;

    fs::write(&path, data)
        .map_err(|e| format!("Ошибка записи config.json: {}", e))?;

    info!("Конфигурация сохранена");
    Ok(())
}