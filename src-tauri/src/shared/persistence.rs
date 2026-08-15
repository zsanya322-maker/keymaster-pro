/// Persistence Layer — чтение/запись JSON файлов
///
/// Профили хранятся в %APPDATA%\KeyMaster Pro\profiles\
/// Бэкапы в %APPDATA%\KeyMaster Pro\backups\
/// Конфиг в %APPDATA%\KeyMaster Pro\config.json

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tracing::{error, info, warn};

use crate::shared::constants::MAX_BACKUPS;
use crate::shared::types::Profile;

/// Текущая версия JSON-схемы профиля.
///
/// `schemaVersion` хранится в JSON на границе persistence и не входит в
/// runtime-структуру `Profile`, поэтому существующий IPC/frontend контракт
/// остаётся совместимым.
pub const PROFILE_SCHEMA_VERSION: u32 = 1;

pub fn app_data_dir() -> Result<PathBuf, String> {
    let app_data = std::env::var("APPDATA")
        .map_err(|e| format!("Не удалось найти APPDATA: {}", e))?;
    let dir = PathBuf::from(app_data).join("KeyMaster Pro");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать {}: {}", dir.display(), e))?;
    Ok(dir)
}

fn profiles_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("profiles");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать {}: {}", dir.display(), e))?;
    Ok(dir)
}

fn backups_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// Возвращает путь профиля, не позволяя ID выйти за пределы `profiles`.
///
/// Старые ID остаются допустимыми (включая `1`, UUID и произвольный текст),
/// запрещаются только пустые значения, разделители пути, `.`/`..` и NUL.
fn profile_path(id: &str) -> Result<PathBuf, String> {
    if id.trim().is_empty()
        || id == "."
        || id == ".."
        || id.contains('/')
        || id.contains('\\')
        || id.contains('\0')
    {
        return Err(format!("Недопустимый ID профиля: {:?}", id));
    }

    Ok(profiles_dir()?.join(format!("{}.json", id)))
}

fn migrate_profile_value(mut value: Value) -> Result<(Value, bool), String> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Корень профиля должен быть JSON-объектом".to_string())?;

    let mut version = match object.get("schemaVersion") {
        None => 0,
        Some(value) => value
            .as_u64()
            .ok_or_else(|| "schemaVersion должна быть целым неотрицательным числом".to_string())?
            .try_into()
            .map_err(|_| "schemaVersion выходит за диапазон u32".to_string())?,
    };

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
                // v0 -> v1: существующие данные не преобразуются — добавляется
                // только явная версия схемы.
                object.insert("schemaVersion".to_string(), json!(1));
                version = 1;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),
        }
    }

    Ok((value, original_version != version))
}

fn replace_file_atomically(temp_path: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let source = HSTRING::from(temp_path.to_string_lossy().as_ref());
        let target = HSTRING::from(destination.to_string_lossy().as_ref());
        unsafe {
            MoveFileExW(
                &source,
                &target,
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
            .map_err(|e| format!("Атомарная замена профиля не удалась: {}", e))?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(temp_path, destination)
            .map_err(|e| format!("Атомарная замена профиля не удалась: {}", e))
    }
}

fn write_profile_value(path: &PathBuf, value: &Value) -> Result<(), String> {
    let data = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Ошибка сериализации профиля: {}", e))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("SystemTime error: {}", e))?
        .as_nanos();
    let temp_path = path.with_extension(format!("json.tmp.{}.{}", std::process::id(), nonce));

    let write_result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Ошибка открытия временного профиля: {}", e))?;
        file.write_all(data.as_bytes())
            .map_err(|e| format!("Ошибка записи временного профиля: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Ошибка синхронизации временного профиля: {}", e))?;
        drop(file);
        replace_file_atomically(&temp_path, path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
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

/// Проверяет, можно ли безопасно перезаписывать уже существующий профиль.
///
/// Если файл повреждён, использует неизвестную будущую schemaVersion или больше
/// не соответствует runtime-модели, обычный `save_profile` не имеет права
/// заменить его пустым/частичным состоянием из UI.
fn existing_profile_is_safe(path: &PathBuf) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }

    let data = fs::read_to_string(path)
        .map_err(|e| format!("Ошибка чтения {}: {}", path.display(), e))?;
    let raw: Value = match serde_json::from_str(&data) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let (migrated, _) = match migrate_profile_value(raw) {
        Ok(result) => result,
        Err(_) => return Ok(false),
    };

    Ok(serde_json::from_value::<Profile>(migrated).is_ok())
}

/// Загрузить профиль из JSON файла.
///
/// Повреждённый/несовместимый файл НИКОГДА не перезаписывается автоматически.
/// Создаётся защитный бэкап, а runtime получает временный пустой recovery-профиль
/// с заметным именем. Исходный файл остаётся на месте.
pub fn load_profile(id: &str) -> Result<Profile, String> {
    let path = profile_path(id)?;

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

    if profile.id != id {
        error!(
            "ID внутри профиля {} ({}) не совпадает с именем файла ({}). Файл НЕ перезаписывается.",
            path.display(),
            profile.id,
            id
        );
        if let Err(backup_err) = backup_file(&path) {
            warn!("Не удалось создать защитный бэкап профиля с неверным ID: {}", backup_err);
        }
        return Ok(recovery_profile(id));
    }

    if was_migrated {
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

/// Сохранить профиль в JSON файл (с бэкапом).
pub fn save_profile(profile: &Profile) -> Result<(), String> {
    let path = profile_path(&profile.id)?;

    if path.exists() {
        if !existing_profile_is_safe(&path)? {
            return Err(format!(
                "Сохранение профиля '{}' заблокировано: исходный файл повреждён или несовместим. Он оставлен без изменений; используйте защитный бэкап для восстановления.",
                profile.id
            ));
        }

        if let Err(e) = backup_file(&path) {
            warn!("Не удалось создать бэкап: {}", e);
        }
    }

    let mut value = serde_json::to_value(profile)
        .map_err(|e| format!("Ошибка сериализации профиля: {}", e))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Сериализованный профиль не является JSON-объектом".to_string())?;
    object.insert("schemaVersion".to_string(), json!(PROFILE_SCHEMA_VERSION));

    write_profile_value(&path, &value)?;
    info!("Профиль '{}' сохранён", profile.id);
    Ok(())
}

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
                profiles.push(name.trim_end_matches(".json").to_string());
            }
        }
    }

    profiles.sort();
    Ok(profiles)
}

pub fn delete_profile(id: &str) -> Result<(), String> {
    let path = profile_path(id)?;

    if !path.exists() {
        return Err(format!("Профиль '{}' не найден", id));
    }

    if let Err(e) = backup_file(&path) {
        warn!("Не удалось создать бэкап перед удалением: {}", e);
    }

    fs::remove_file(&path)
        .map_err(|e| format!("Ошибка удаления {}: {}", path.display(), e))?;

    info!("Профиль '{}' удалён", id);
    Ok(())
}

fn backup_file(path: &PathBuf) -> Result<(), String> {
    let dir = backups_dir()?;
    let filename = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Не удалось извлечь имя файла")?;

    let timestamp = timestamp_for_filename()?;
    let backup_name = format!("{}_{}.json", filename, timestamp);
    let backup_path = dir.join(&backup_name);

    fs::copy(path, &backup_path)
        .map_err(|e| format!("Ошибка копирования бэкапа: {}", e))?;
    rotate_backups(filename)?;
    Ok(())
}

fn rotate_backups(profile_id: &str) -> Result<(), String> {
    let dir = backups_dir()?;
    let prefix = format!("{}_", profile_id);
    let mut backups: Vec<(String, std::time::SystemTime)> = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| format!("Ошибка чтения бэкапов: {}", e))? {
        let entry = entry.map_err(|e| format!("Ошибка entry: {}", e))?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.starts_with(&prefix) && name_str.ends_with(".json") {
            let modified = entry
                .metadata()
                .map_err(|e| format!("Ошибка metadata: {}", e))?
                .modified()
                .map_err(|e| format!("Ошибка modified: {}", e))?;
            backups.push((name_str.to_string(), modified));
        }
    }

    backups.sort_by(|a, b| b.1.cmp(&a.1));
    for (name, _) in backups.iter().skip(MAX_BACKUPS) {
        let path = dir.join(name);
        if let Err(e) = fs::remove_file(&path) {
            warn!("Не удалось удалить старый бэкап {}: {}", name, e);
        }
    }
    Ok(())
}

fn timestamp_for_filename() -> Result<String, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("SystemTime error: {}", e))?;
    Ok(ts.as_nanos().to_string())
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

        let save_result = save_profile(&profile);
        assert!(save_result.is_err());
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

    #[test]
    fn test_profile_path_rejects_traversal() {
        assert!(profile_path("../outside").is_err());
        assert!(profile_path("..\\outside").is_err());
        assert!(profile_path("folder/name").is_err());
        assert!(profile_path("").is_err());
        assert!(profile_path("1").is_ok());
        assert!(profile_path("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn test_future_or_malformed_schema_is_not_overwritten() {
        let dir = profiles_dir().unwrap();

        for (id, schema_version) in [
            ("test_future_schema", json!(PROFILE_SCHEMA_VERSION + 1)),
            ("test_bad_schema", json!("1")),
        ] {
            let path = dir.join(format!("{}.json", id));
            let original = json!({
                "schemaVersion": schema_version,
                "id": id,
                "name": "Protected",
                "isDefault": false,
                "linkedApps": [],
                "rules": [],
                "layers": []
            });
            let original_text = serde_json::to_string_pretty(&original).unwrap();
            fs::write(&path, &original_text).unwrap();

            let recovery = load_profile(id).unwrap();
            assert!(recovery.name.contains("Ошибка загрузки"));
            assert_eq!(fs::read_to_string(&path).unwrap(), original_text);
            assert!(save_profile(&recovery).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), original_text);

            let _ = fs::remove_file(&path);
        }
    }

    #[test]
    fn test_mismatched_internal_id_is_not_migrated_over_source() {
        let dir = profiles_dir().unwrap();
        let id = "test_id_mismatch";
        let path = dir.join(format!("{}.json", id));
        let original = json!({
            "id": "different-id",
            "name": "Mismatch",
            "isDefault": false,
            "linkedApps": [],
            "rules": [],
            "layers": []
        });
        let original_text = serde_json::to_string_pretty(&original).unwrap();
        fs::write(&path, &original_text).unwrap();

        let recovery = load_profile(id).unwrap();
        assert_eq!(recovery.id, id);
        assert!(recovery.name.contains("Ошибка загрузки"));
        assert_eq!(fs::read_to_string(&path).unwrap(), original_text);

        let _ = fs::remove_file(&path);
    }
}
