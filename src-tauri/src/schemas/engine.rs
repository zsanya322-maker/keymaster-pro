use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct EngineSchema {
    pub keyboard_map: HashMap<u8, Vec<CompiledRule>>,
    pub mouse_map: HashMap<u8, Vec<CompiledRule>>,
    pub tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>>,
    pub text_expansion_map: HashMap<String, Vec<CompiledRule>>,
}

impl Default for EngineSchema {
    fn default() -> Self {
        Self {
            keyboard_map: HashMap::new(),
            mouse_map: HashMap::new(),
            tap_hold_map: HashMap::new(),
            text_expansion_map: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CompiledRule {
    pub priority: i32,
    pub conditions: Vec<EngineCondition>,
    pub actions: Vec<EngineAction>,
}

#[derive(Debug, Clone)]
pub struct CompiledTapHoldRule {
    pub priority: i32,
    pub timeout_ms: u32,
    pub conditions: Vec<EngineCondition>,
    pub tap_actions: Vec<EngineAction>,
    pub hold_actions: Vec<EngineAction>,
}

#[derive(Debug, Clone)]
pub enum EngineCondition {
    LayerActive { layer_id_hash: u64 },
    VirtualDesktop { id: u32 },
    /// Объединённое условие «Активное окно»: срабатывает по ИЛИ.
    /// Хотя бы одно поле должно быть Some. None = не проверяется.
    WindowMatch {
        process_hash: Option<u64>,
        title_contains: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub enum SimulatorCommand {
    PressKey(u8),
    ReleaseKey(u8),
    MousePress(u8),
    MouseRelease(u8),
    TypeString(String),
    Delay(u32),
    MouseMove { dx: i32, dy: i32 },
    MouseScroll { delta: i32 },
    MouseAbsolute { x: i32, y: i32 },
}

#[derive(Debug, Clone)]
pub enum EngineAction {
    RemapKey { code: u8 },
    RemapMouse { code: u8 },
    TypeText { text: String },
    MacroCommands { commands: Vec<SimulatorCommand> },
    ToggleLayer { layer_id_hash: u64 },
    HoldLayerPush { layer_id_hash: u64 },
    HoldLayerPop { layer_id_hash: u64 },
    SystemVolume { action: String },
    MediaKey { key: String },
    WindowAction { action: String },
    LaunchApp { path: String },
    /// Поднять окно указанного процесса/заголовка поверх всех окон.
    /// Поиск по ИЛИ: process (точное совпадение clean-имени) ИЛИ title (содержит).
    FocusProcess {
        process: Option<String>,
        title: Option<String>,
    },
    Sleep,
    MonitorOff,
}
