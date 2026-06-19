/// Persistence Layer — чтение/запись JSON файлов
///
/// Профили хранятся в %APPDATA%\KeyMaster Pro\profiles\
/// Бэкапы в %APPDATA%\KeyMaster Pro\backups\
/// Конфиг в %APPDATA%\KeyMaster Pro\config.json

use std::fs;
use std::path::PathBuf;

use tracing::{info, warn};

use crate::shared::constants::MAX_BACKUPS;
use crate::shared::types::Profile;

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

/// Загрузить профиль из JSON файла
pub fn load_profile(id: &str) -> Result<Profile, String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{}.json", id));

    if !path.exists() {
        return Err(format!("Профиль '{}' не найден", id));
    }

    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Ошибка чтения {}: {}", path.display(), e))?;

    match serde_json::from_str::<Profile>(&data) {
        Ok(profile) => Ok(profile),
        Err(e) => {
            warn!("Ошибка парсинга {}: {}. Попытка сброса профиля (миграция).", path.display(), e);
            // Если парсинг не удался (скорее всего старый формат), создаем пустой новый профиль
            let new_profile = Profile {
                id: id.to_string(),
                name: format!("{} (Сброшен)", id),
                is_default: false,
                linked_apps: vec![],
                rules: vec![],
                layers: vec![],
            };
            // Сохраним его, чтобы починить файл
            let _ = save_profile(&new_profile);
            Ok(new_profile)
        }
    }
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

    // Сериализовать с форматированием
    let data = serde_json::to_string_pretty(profile)
        .map_err(|e| format!("Ошибка сериализации профиля: {}", e))?;

    fs::write(&path, data)
        .map_err(|e| format!("Ошибка записи {}: {}", path.display(), e))?;

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

    // Удаляем лишние
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