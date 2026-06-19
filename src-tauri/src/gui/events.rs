/// Tauri events → Frontend
///
/// Daemon отправляет уведомления через Named Pipe,
/// GUI преобразует их в Tauri events для React.

use std::sync::{Mutex, LazyLock};
use tokio::sync::mpsc;

pub static EVENT_LISTENERS: LazyLock<Mutex<Vec<mpsc::UnboundedSender<String>>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

/// Отправить событие всем подключенным GUI клиентам
pub fn broadcast_event(event: DaemonEvent) {
    if let Ok(json_str) = serde_json::to_string(&event) {
        let mut listeners = EVENT_LISTENERS.lock().unwrap();
        listeners.retain(|tx| {
            let mut msg = json_str.clone();
            msg.push('\n');
            tx.send(msg).is_ok()
        });
    }
}

/// Типы событий от Daemon к GUI
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum DaemonEvent {
    /// Слой активирован
    LayerActivated { layer_id: String, layer_name: String },
    /// Слой деактивирован
    LayerDeactivated { layer_id: String },
    /// Шаг макроса записан
    MacroRecordingStep { step: serde_json::Value },
    /// Запись макроса остановлена
    MacroRecordingStopped { macro_id: String },
    /// Профиль переключён
    ProfileSwitched { profile_id: String },
    /// Статус хуков изменён
    HooksStatusChanged { kb_enabled: bool, mouse_enabled: bool },
}