use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, RwLock};
use tracing::info;

/// Модель слоя, зеркальная TypeScript-интерфейсу
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    #[serde(rename = "profileId")]
    pub profile_id: String,
    pub name: String,
    pub priority: i32,
    #[serde(rename = "triggerType")]
    pub trigger_type: String, // 'hotkey' | 'process' | 'window_title' | 'none'
    #[serde(rename = "triggerValue")]
    pub trigger_value: String,
}

// Потокобезопасное хранилище слоев (пока в памяти)
static LAYERS: LazyLock<RwLock<Vec<Layer>>> = LazyLock::new(|| {
    RwLock::new(vec![
        Layer {
            id: "1".to_string(),
            profile_id: "1".to_string(),
            name: "Базовый слой".to_string(),
            priority: 0,
            trigger_type: "none".to_string(),
            trigger_value: "".to_string(),
        },
        Layer {
            id: "2".to_string(),
            profile_id: "1".to_string(),
            name: "Режим снайпера".to_string(),
            priority: 10,
            trigger_type: "hotkey".to_string(),
            trigger_value: "LAlt".to_string(),
        },
    ])
});

/// Получить все слои для конкретного профиля
pub fn get_profile_layers(profile_id: &str) -> Vec<Layer> {
    if let Ok(layers) = LAYERS.read() {
        let mut profile_layers: Vec<Layer> = layers.iter().filter(|l| l.profile_id == profile_id).cloned().collect();
        // Сортировка по убыванию приоритета (от высшего к низшему)
        profile_layers.sort_by(|a, b| b.priority.cmp(&a.priority));
        profile_layers
    } else {
        vec![]
    }
}

/// Создать новый слой
pub fn create_layer(layer: Layer) -> Result<(), String> {
    let mut layers = LAYERS.write().map_err(|_| "Failed to lock layers")?;
    info!("Создан новый слой: {} (Приоритет: {})", layer.name, layer.priority);
    layers.push(layer);
    Ok(())
}

/// Удалить слой
pub fn delete_layer(id: &str) -> Result<(), String> {
    let mut layers = LAYERS.write().map_err(|_| "Failed to lock layers")?;
    layers.retain(|l| l.id != id);
    info!("Слой {} удален", id);
    Ok(())
}

/// Движок вычисления активных слоев (Core Engine)
/// Вызывается при каждом событии клавиатуры для оценки контекста
pub fn evaluate_active_layers(profile_id: &str, active_process: &str, window_title: &str, pressed_keys: &[String]) -> Vec<Layer> {
    let all_layers = get_profile_layers(profile_id);
    
    all_layers.into_iter().filter(|layer| {
        match layer.trigger_type.as_str() {
            "none" => true, // Базовый слой активен всегда
            "process" => active_process.to_lowercase().contains(&layer.trigger_value.to_lowercase()),
            "window_title" => window_title.to_lowercase().contains(&layer.trigger_value.to_lowercase()),
            "hotkey" => pressed_keys.contains(&layer.trigger_value), // Например, если нажат LAlt
            _ => false,
        }
    }).collect()
}