/// Persistence Layer — чтение/запись JSON файлов
///
/// Профили хранятся в %APPDATA%\KeyMaster Pro\profiles\
/// Бэкапы в %APPDATA%\KeyMaster Pro\backups\
/// Конфиг в %APPDATA%\KeyMaster Pro\config.json

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use tracing::{error, info, warn};

use crate::shared::constants::MAX_BACKUPS;
use crate::shared::types::Profile;

/// Текущая версия JSON-схемы профиля.
///
/// Поле хранится непосредственно в JSON как `schemaVersion`, но намеренно
/// не является частью `Profile`: так фронтенд и runtime-модель остаются
/// совместимыми с существующим API, а миграции централизованы в persistence.
pub const PROFILE_SCHEMA_VERSION: u32 = 1;

/// Получить путь к директории данных приложения (%APPDATA%\KeyMaster Pro\)
pub fn app_data_dir() -> Result<PathBuf, String> {
    let app_data = std::env::var("APPDATA")
        .map_err(|e| format!("Не удалось найти APPDATA: {}", e))?;
    let dir = PathBuf::from(app_data).join("KeyMaster Pro");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// Получить путь к папке профилей
fn profiles_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("profiles");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// Получить путь к папке бэкапов
fn backups_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// Применить последовательные миграции JSON-профиля.
///
/// Профили старых версий KeyMaster Pro не имели `schemaVersion`; для них
/// считаем версию равной 0 и проводим безопасную миграцию 0 -> 1, которая
/// только добавляет метаданные версии и не меняет правила/слои.
fn migrate_profile_value(mut value: Value) -> Result<(Value, bool), String> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Корень профиля должен быть JSON-объектом".to_string())?;

    let mut version = object
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;

    if version > PROFILE_SCHEMA_VERSION {
        return Err(format!(
            "Профиль использует более новую схему {} (поддерживается до {})",
            version, PROFILE_SCHEMA_VERSION
        ));
    }

    let original_version = version;

    while version < PROFILE_SCHEMA_VERSION {
        match version {
            0 => {
                // v0 -> v1: только вводим явную версию схемы. Структура
                // существующих правил, слоёв и профиля не меняется.
                object.insert("schemaVersion".to_string(), json!(1));
                version = 1;
            }
            other => {
                return Err(format!("Нет миграции для версии профиля {}", other));
            }
        }
    }

    Ok((value, original_version != version))
}

fn write_profile_value(path: &PathBuf, value: &Value) -> Result<(), String> {
    let data = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Ошибка сериализации профиля: {}", e))?;
    fs::write(path, data)
        .map_err(|e| format!("Ошибка записи {}: {}", path.display(), e))
}

fn recovery_profile(id: &str) -> Profile {
    Profile {
        id: id.to_string(),
        name: format!("{} (Ошибка загрузки)", id),
        is_default: false,
        linked_apps: vec![],
        rules: vec![],
        layers: vec![],
    }
}

/// Загрузить профиль из JSON файла.
///
/// Важное правило: повреждённый/несовместимый файл НИКОГДА не
/// перезаписывается автоматически пустым профилем. Сначала сохраняется
/// резервная копия, а runtime получает безопасный временный профиль с
/// заметным именем `(... Ошибка загрузки)`. Исходный файл остаётся на месте.
pub fn load_profile(id: &str) -> Result<Profile, String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{}.json", id));

    if !path.exists() {
        return Err(format!("Профиль '{}' не найден", id));
    }

    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Ошибка чтения {}: {}", path.display(), e))?;

    let raw_value: Value = match serde_json::from_str(&data) {
        Ok(value) => value,
        Err(e) => {
            error!(
                "Повреждён JSON профиля {}: {}. Файл НЕ перезаписывается.",
                path.display(),
                e
            );
            if let Err(backup_err) = backup_file(&path) {
                warn!("Не удалось создать защитный бэкап повреждённого профиля: {}", backup_err);
            }
            return Ok(recovery_profile(id));
        }
    };

    let (migrated_value, was_migrated) = match migrate_profile_value(raw_value) {
        Ok(result) => result,
        Err(e) => {
            error!(
                "Не удалось мигрировать профиль {}: {}. Файл НЕ перезаписывается.",
                path.display(),
                e
            );
            if let Err(backup_err) = backup_file(&path) {
                warn!("Не удалось создать защитный бэкап несовместимого профиля: {}", backup_err);
            }
            return Ok(recovery_profile(id));
        }
    };

    let profile = match serde_json::from_value::<Profile>(migrated_value.clone()) {
        Ok(profile) => profile,
        Err(e) => {
            error!(
                "Профиль {} не соответствует runtime-схеме: {}. Файл НЕ перезаписывается.",
                path.display(),
                e
            );
            if let Err(backup_err) = backup_file(&path) {
                warn!("Не удалось создать защитный бэкап несовместимого профиля: {}", backup_err);
            }
            return Ok(recovery_profile(id));
        }
    };

    if was_migrated {
        // До любого изменения старого файла сохраняем его исходную копию.
        if let Err(e) = backup_file(&path) {
            warn!("Не удалось создать бэкап перед миграцией {}: {}", path.display(), e);
        }
        write_profile_value(&path, &migrated_value)?;
        info!(
            "Профиль '{}' мигрирован до schemaVersion={}",
            id, PROFILE_SCHEMA_VERSION
        );
    }

    Ok(profile)
}

/// Сохранить профиль в JSON файл (с бэкапом)
pub fn save_profile(profile: &Profile) -> Result<(), String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{}.json", profile.id));

    // Создать бэкап если файл уже существует
    if path.exists() {
        if let Err(e) = backup_file(&path) {
            warn!("Не удалось создать бэкап: {}", e);
        }
    }

    // Версия схемы добавляется на границе persistence, не меняя runtime Profile.
    let mut value = serde_json::to_value(profile)
        .map_err(|e| format!("Ошибка сериализации профиля: {}", e))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Сериализованный профиль не является JSON-объектом".to_string())?;
    object.insert(
        "schemaVersion".to_string(),
        json!(PROFILE_SCHEMA_VERSION),
    );

    write_profile_value(&path, &value)?;

    info!("Профиль '{}' сохранён", profile.id);
    Ok(())
}

/// Получить список всех ID профилей
pub fn list_profiles() -> Result<Vec<String>, String> {
    let dir = profiles_dir()?;

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut profiles = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("Ошибка чтения {}: {}", dir.display(), e))? {
        let entry = entry.map_err(|e| format!("Ошибка entry: {}", e))?;
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(".json") {
                let id = name.trim_end_matches(".json").to_string();
                profiles.push(id);
            }
        }
    }

    profiles.sort();
    Ok(profiles)
}

/// Удалить профиль
pub fn delete_profile(id: &str) -> Result<(), String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{}.json", id));

    if !path.exists() {
        return Err(format!("Профиль '{}' не найден", id));
    }

    // Бэкап перед удалением
    if let Err(e) = backup_file(&path) {
        warn!("Не удалось создать бэкап перед удалением: {}", e);
    }

    fs::remove_file(&path)
        .map_err(|e| format!("Ошибка удаления {}: {}", path.display(), e))?;

    info!("Профиль '{}' удалён", id);
    Ok(())
}

/// Создать бэкап файла с ротацией (макс. MAX_BACKUPS)
fn backup_file(path: &PathBuf) -> Result<(), String> {
    let dir = backups_dir()?;
    let filename = path.file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Не удалось извлечь имя файла")?;

    let timestamp = chrono_now()?;
    let backup_name = format!("{}_{}.json", filename, timestamp);
    let backup_path = dir.join(&backup_name);

    fs::copy(path, &backup_path)
        .map_err(|e| format!("Ошибка копирования бэкапа: {}", e))?;

    // Ротация: удалить старые бэкапы сверх MAX_BACKUPS
    rotate_backups(filename)?;

    Ok(())
}

/// Удалить старые бэкапы, оставив только MAX_BACKUPS последних
fn rotate_backups(profile_id: &str) -> Result<(), String> {
    let dir = backups_dir()?;
    let prefix = format!("{}_", profile_id);

    let mut backups: Vec<(String, std::time::SystemTime)> = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| format!("Ошибка чтения бэкапов: {}", e))? {
        let entry = entry.map_err(|e| format!("Ошибка entry: {}", e))?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.starts_with(&prefix) && name_str.ends_with(".json") {
            let modified = entry.metadata()
                .map_err(|e| format!("Ошибка metadata: {}", e))?
                .modified()
                .map_err(|e| format!("Ошибка modified: {}", e))?;
            backups.push((name_str.to_string(), modified));
        }
    }

    // Сортируем по времени (новые первые)
    backups.sort_by(|a, b| b.1.cmp(&a.1));

    // Удаляем лишние бэкапы сверх лимита
    for (name, _) in backups.iter().skip(MAX_BACKUPS) {
        let path = dir.join(name);
        if let Err(e) = fs::remove_file(&path) {
            warn!("Не удалось удалить старый бэкап {}: {}", name, e);
        }
    }

    Ok(())
}

/// Получить timestamp строку для имени бэкапа
fn chrono_now() -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("SystemTime error: {}", e))?;
    Ok(format!("{}", ts.as_secs()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_json_is_not_overwritten() {
        let dir = profiles_dir().unwrap();
        let id = "test_invalid";
        let path = dir.join(format!("{}.json", id));
        let invalid = "invalid_json_data";
        fs::write(&path, invalid).unwrap();

        let profile = load_profile(id).unwrap();
        assert_eq!(profile.id, id);
        assert!(profile.name.contains("Ошибка загрузки"));
        assert!(profile.rules.is_empty());
        assert_eq!(fs::read_to_string(&path).unwrap(), invalid);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_legacy_profile_is_migrated_without_data_loss() {
        let dir = profiles_dir().unwrap();
        let id = "test_legacy_migration";
        let path = dir.join(format!("{}.json", id));
        let legacy = json!({
            "id": id,
            "name": "Legacy",
            "isDefault": false,
            "linkedApps": [],
            "rules": [],
            "layers": []
        });
        fs::write(&path, serde_json::to_string_pretty(&legacy).unwrap()).unwrap();

        let profile = load_profile(id).unwrap();
        assert_eq!(profile.name, "Legacy");

        let migrated: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(migrated.get("schemaVersion").and_then(Value::as_u64), Some(1));
        assert_eq!(migrated.get("name").and_then(Value::as_str), Some("Legacy"));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_save_load_round_trip_writes_schema_version() {
        let profile = Profile {
            id: "test_rt".to_string(),
            name: "Round Trip".to_string(),
            is_default: false,
            linked_apps: vec![],
            rules: vec![],
            layers: vec![],
        };

        save_profile(&profile).unwrap();
        let loaded = load_profile("test_rt").unwrap();

        assert_eq!(loaded.id, "test_rt");
        assert_eq!(loaded.name, "Round Trip");

        let path = profiles_dir().unwrap().join("test_rt.json");
        let saved: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved.get("schemaVersion").and_then(Value::as_u64), Some(1));

        let _ = delete_profile("test_rt");
    }
}
