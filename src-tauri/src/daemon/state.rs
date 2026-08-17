/// Daemon State — глобальное состояние daemon-процесса
///
/// Хранит текущий профиль, активные слои, состояние хуков.
/// Доступно из всех потоков через DaemonStateRef (Arc<RwLock<DaemonState>>).
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::schemas::engine::EngineSchema;
use crate::schemas::frontend::KeyChord;
use crate::shared::types::AppConfig;
use crate::simulator::SimulatorSender;

/// Ссылка на разделяемое состояние Daemon
pub type DaemonStateRef = Arc<RwLock<DaemonState>>;

/// Глобальное состояние Daemon
#[derive(Debug)]
pub struct DaemonState {
    /// Активный профиль
    pub active_profile_id: String,
    pub preferred_profile_id: String,
    pub auto_switch_profiles: bool,
    pub manual_profile_lock: bool,
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
    pub last_latency_us: std::sync::atomic::AtomicU64,
    /// Return the cursor to its pre-macro position after playback finishes
    pub restore_mouse_after_macro: bool,
    /// Emergency macro-stop VK (0 = disabled).
    pub macro_emergency_stop_vk: u8,
    /// Macro recording state
    pub is_recording: std::sync::atomic::AtomicBool,
    pub record_ready: std::sync::atomic::AtomicBool,
    pub record_mouse_moves: std::sync::atomic::AtomicBool,
    pub record_mouse_drag_drop_only: std::sync::atomic::AtomicBool,
    pub recorded_steps: std::sync::Mutex<Vec<crate::schemas::frontend::MacroStep>>,
    pub last_record_time: std::sync::Mutex<Option<std::time::Instant>>,
    /// Bounded, memory-only text expansion buffer and single undo record.
    pub text_input: std::sync::Mutex<crate::daemon::text_expansion::TextInputState>,
    /// Режим захвата клавиши/кнопки мыши для KeyPicker.
    /// Keyboard hook в этом режиме сам собирает chord и блокирует его до Windows,
    /// чтобы Win/Alt-комбинации можно было записывать без системного side-effect.
    pub key_capture_active: std::sync::atomic::AtomicBool,
    /// Последний chord, захваченный keyboard LL-hook. GUI забирает его polling-ом.
    pub last_captured_key: std::sync::Mutex<Option<KeyChord>>,
    /// Последняя нажатая кнопка мыши в режиме key_capture_active.
    pub last_captured_mouse: std::sync::Mutex<Option<u8>>,
}

impl DaemonState {
    /// Создать из конфигурации приложения
    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            active_profile_id: config.active_profile_id.clone(),
            preferred_profile_id: config.active_profile_id.clone(),
            auto_switch_profiles: config.auto_switch_profiles,
            manual_profile_lock: config.manual_profile_lock,
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
            macro_emergency_stop_vk: config.macro_emergency_stop_vk,
            is_recording: std::sync::atomic::AtomicBool::new(false),
            record_ready: std::sync::atomic::AtomicBool::new(false),
            record_mouse_moves: std::sync::atomic::AtomicBool::new(false),
            record_mouse_drag_drop_only: std::sync::atomic::AtomicBool::new(true),
            recorded_steps: std::sync::Mutex::new(Vec::new()),
            last_record_time: std::sync::Mutex::new(None),
            text_input: std::sync::Mutex::new(
                crate::daemon::text_expansion::TextInputState::default(),
            ),
            key_capture_active: std::sync::atomic::AtomicBool::new(false),
            last_captured_key: std::sync::Mutex::new(None),
            last_captured_mouse: std::sync::Mutex::new(None),
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
            preferred_profile_id: "1".to_string(),
            auto_switch_profiles: false,
            manual_profile_lock: false,
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
            macro_emergency_stop_vk: 0x13,
            is_recording: std::sync::atomic::AtomicBool::new(false),
            record_ready: std::sync::atomic::AtomicBool::new(false),
            record_mouse_moves: std::sync::atomic::AtomicBool::new(false),
            record_mouse_drag_drop_only: std::sync::atomic::AtomicBool::new(true),
            recorded_steps: std::sync::Mutex::new(Vec::new()),
            last_record_time: std::sync::Mutex::new(None),
            text_input: std::sync::Mutex::new(
                crate::daemon::text_expansion::TextInputState::default(),
            ),
            key_capture_active: std::sync::atomic::AtomicBool::new(false),
            last_captured_key: std::sync::Mutex::new(None),
            last_captured_mouse: std::sync::Mutex::new(None),
        }
    }
}
