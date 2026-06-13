/// Tauri events → Frontend
///
/// Daemon отправляет уведомления через Named Pipe,
/// GUI преобразует их в Tauri events для React.

// TODO: Реализовать event forwarding (Daemon → Frontend)

/// Типы событий от Daemon к GUI
#[derive(Debug, Clone, serde::Serialize)]
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