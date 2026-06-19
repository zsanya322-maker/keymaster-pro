/// Daemon State — глобальное состояние daemon-процесса
///
/// Хранит текущий профиль, активные слои, состояние хуков.
/// Доступно из всех потоков через DaemonStateRef (Arc<RwLock<DaemonState>>).

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::shared::types::AppConfig;
use crate::schemas::engine::EngineSchema;
use crate::simulator::SimulatorSender;

/// Ссылка на разделяемое состояние daemon
pub type DaemonStateRef = Arc<RwLock<DaemonState>>;

/// Глобальное состояние Daemon
#[derive(Debug)]
pub struct DaemonState {
    /// Активный профиль
    pub active_profile_id: String,
    /// Полная структура активного профиля
    pub active_profile: Option<crate::shared::types::Profile>,
    /// Скомпилированная схема движка
    pub engine_schema: EngineSchema,
    /// Канал для отправки событий в симулятор
    pub simulator: Option<SimulatorSender>,
    /// Активные слои (layer_id → true/false)
    pub active_layers: HashMap<String, bool>,
    /// Хуки установлены?
    pub hooks_installed: bool,
    /// Keyboard hook включён?
    pub kb_hook_enabled: bool,
    /// Mouse hook включён?
    pub mouse_hook_enabled: bool,
    /// Daemon запущен и работает
    pub running: bool,
    /// CPU tracking: (last_proc_time, last_sys_time, last_instant)
    pub cpu_tracking: std::sync::Mutex<Option<(u64, u64, std::time::Instant)>>,
    /// Keystrokes processed counter
    pub keystrokes_processed: std::sync::atomic::AtomicUsize,
    /// Last keyboard/mouse hook processing latency in microseconds
    /// Last keyboard/mouse hook processing latency in microseconds
    pub last_latency_us: std::sync::atomic::AtomicU64,
    /// Return the cursor to its pre-macro position after playback finishes
    pub restore_mouse_after_macro: bool,
    /// Macro recording state
    pub is_recording: std::sync::atomic::AtomicBool,
    pub recorded_steps: std::sync::Mutex<Vec<crate::schemas::frontend::MacroStep>>,
    pub last_record_time: std::sync::Mutex<Option<std::time::Instant>>,
    /// Buffer for tracking rolling text inputs for text expansion
    pub typed_buffer: std::sync::Mutex<String>,
}

impl DaemonState {
    /// Создать из конфигурации приложения
    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            active_profile_id: config.active_profile_id.clone(),
            active_profile: None,
            engine_schema: EngineSchema::default(),
            simulator: None,
            active_layers: HashMap::new(),
            hooks_installed: false,
            kb_hook_enabled: config.kb_hook_enabled,
            mouse_hook_enabled: config.mouse_hook_enabled,
            running: true,
            cpu_tracking: std::sync::Mutex::new(None),
            keystrokes_processed: std::sync::atomic::AtomicUsize::new(0),
            last_latency_us: std::sync::atomic::AtomicU64::new(0),
            restore_mouse_after_macro: config.restore_mouse_after_macro,
            is_recording: std::sync::atomic::AtomicBool::new(false),
            recorded_steps: std::sync::Mutex::new(Vec::new()),
            last_record_time: std::sync::Mutex::new(None),
            typed_buffer: std::sync::Mutex::new(String::new()),
        }
    }

    /// Создать разделяемую ссылку
    pub fn into_ref(self) -> DaemonStateRef {
        Arc::new(RwLock::new(self))
    }
}

impl Default for DaemonState {
    fn default() -> Self {
        Self {
            active_profile_id: "1".to_string(),
            active_profile: None,
            engine_schema: EngineSchema::default(),
            simulator: None,
            active_layers: HashMap::new(),
            hooks_installed: false,
            kb_hook_enabled: true,
            mouse_hook_enabled: true,
            running: true,
            cpu_tracking: std::sync::Mutex::new(None),
            keystrokes_processed: std::sync::atomic::AtomicUsize::new(0),
            last_latency_us: std::sync::atomic::AtomicU64::new(0),
            restore_mouse_after_macro: true,
            is_recording: std::sync::atomic::AtomicBool::new(false),
            recorded_steps: std::sync::Mutex::new(Vec::new()),
            last_record_time: std::sync::Mutex::new(None),
            typed_buffer: std::sync::Mutex::new(String::new()),
        }
    }
}