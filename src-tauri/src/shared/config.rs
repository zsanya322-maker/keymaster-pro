/// Конфигурация приложения (config.json)
///
/// Чтение/запись настроек в %APPDATA%\KeyMaster Pro\config.json.
/// Повреждённый файл не теряется: перед восстановлением дефолта он копируется
/// в backups/config_corrupt_<timestamp>.json.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tracing::{info, warn};

use crate::shared::types::AppConfig;

fn config_path() -> Result<PathBuf, String> {
    Ok(super::persistence::app_data_dir()?.join("config.json"))
}

fn validate_config(config: &AppConfig) -> Result<(), String> {
    if !matches!(config.language.as_str(), "ru" | "en") {
        return Err(format!("Неподдерживаемый язык: {}", config.language));
    }
    if !matches!(config.theme.as_str(), "light" | "dark") {
        return Err(format!("Неподдерживаемая тема: {}", config.theme));
    }
    if config.active_profile_id.trim().is_empty() {
        return Err("activeProfileId не может быть пустым".to_string());
    }
    if !config.scale.is_finite() || !(0.5..=2.0).contains(&config.scale) {
        return Err(format!("Некорректный scale: {}", config.scale));
    }
    if !(8..=32).contains(&config.font_size) {
        return Err(format!("Некорректный fontSize: {}", config.font_size));
    }
    if !(2..=32).contains(&config.row_padding) {
        return Err(format!("Некорректный rowPadding: {}", config.row_padding));
    }
    Ok(())
}

fn parse_config(data: &str) -> Result<AppConfig, String> {
    let config: AppConfig = serde_json::from_str(data)
        .map_err(|e| format!("Ошибка парсинга config.json: {}", e))?;
    validate_config(&config)?;
    Ok(config)
}

fn backup_corrupt_config(path: &Path) -> Result<PathBuf, String> {
    let backup_dir = super::persistence::app_data_dir()?.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Не удалось создать папку бэкапов config: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("SystemTime error: {}", e))?
        .as_nanos();
    let backup_path = backup_dir.join(format!("config_corrupt_{}.json", timestamp));

    fs::copy(path, &backup_path)
        .map_err(|e| format!("Не удалось сохранить повреждённый config.json: {}", e))?;
    Ok(backup_path)
}

fn write_config_file(path: &Path, config: &AppConfig) -> Result<(), String> {
    validate_config(config)?;
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Ошибка сериализации config: {}", e))?;

    // Явный flush/sync уменьшает шанс получить обрезанный JSON при аварийном
    // завершении процесса во время сохранения.
    let mut file = fs::File::create(path)
        .map_err(|e| format!("Ошибка открытия config.json для записи: {}", e))?;
    file.write_all(data.as_bytes())
        .map_err(|e| format!("Ошибка записи config.json: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("Ошибка синхронизации config.json: {}", e))?;
    Ok(())
}

/// Загрузить конфигурацию. Отсутствующие поля старых версий автоматически
/// дополняются через `#[serde(default)]` в AppConfig.
///
/// Если JSON повреждён или содержит недопустимые значения, исходник сначала
/// копируется в backups, затем создаётся рабочий дефолтный config.json.
pub fn load_config() -> Result<AppConfig, String> {
    let path = config_path()?;

    if !path.exists() {
        info!("Конфиг не найден, создаём дефолтный");
        let config = AppConfig::default();
        write_config_file(&path, &config)?;
        return Ok(config);
    }

    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Ошибка чтения config.json: {}", e))?;

    match parse_config(&data) {
        Ok(config) => {
            info!("Конфигурация загружена");
            Ok(config)
        }
        Err(error) => {
            warn!("{}; выполняем безопасное восстановление", error);
            let backup_path = backup_corrupt_config(&path)?;
            let config = AppConfig::default();
            if let Err(write_error) = write_config_file(&path, &config) {
                return Err(format!(
                    "Повреждённый config сохранён в {}, но восстановить рабочий config не удалось: {}",
                    backup_path.display(),
                    write_error
                ));
            }
            warn!(
                "Повреждённый config сохранён как {}, создан дефолтный config.json",
                backup_path.display()
            );
            Ok(config)
        }
    }
}

/// Сохранить проверенную конфигурацию в файл.
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    write_config_file(&path, config)?;
    info!("Конфигурация сохранена");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_config_missing_new_fields_uses_defaults() {
        let parsed = parse_config(r#"{
            "language": "ru",
            "theme": "light",
            "activeProfileId": "1"
        }"#).unwrap();

        assert_eq!(parsed.language, "ru");
        assert_eq!(parsed.active_profile_id, "1");
        assert_eq!(parsed.scale, AppConfig::default().scale);
        assert!(parsed.kb_hook_enabled);
        assert!(parsed.mouse_hook_enabled);
    }

    #[test]
    fn invalid_config_values_are_rejected() {
        let mut config = AppConfig::default();
        config.scale = f64::NAN;
        assert!(validate_config(&config).is_err());

        let mut config = AppConfig::default();
        config.language = "unknown".to_string();
        assert!(validate_config(&config).is_err());
    }
}
