use serde::{Deserialize, Serialize};

pub mod key_modifiers {
    pub const CTRL: u16 = 1 << 0;
    pub const ALT: u16 = 1 << 1;
    pub const SHIFT: u16 = 1 << 2;
    pub const WIN: u16 = 1 << 3;

    pub const LCTRL: u16 = 1 << 4;
    pub const RCTRL: u16 = 1 << 5;
    pub const LALT: u16 = 1 << 6;
    pub const RALT: u16 = 1 << 7;
    pub const LSHIFT: u16 = 1 << 8;
    pub const RSHIFT: u16 = 1 << 9;
    pub const LWIN: u16 = 1 << 10;
    pub const RWIN: u16 = 1 << 11;

    pub const GENERIC_MASK: u16 = CTRL | ALT | SHIFT | WIN;
    pub const SIDE_MASK: u16 = LCTRL | RCTRL | LALT | RALT | LSHIFT | RSHIFT | LWIN | RWIN;
    pub const ALL: u16 = GENERIC_MASK | SIDE_MASK;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyChord {
    pub code: u8,
    #[serde(default)]
    pub modifiers: u16,
}

impl KeyChord {
    pub const fn single(code: u8) -> Self {
        Self { code, modifiers: 0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendConfig {
    pub rules: Vec<FrontendRule>,
    pub layers: Vec<LayerMeta>,
    pub tap_hold_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerMeta {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleFolder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub order: i32,
}

fn default_rule_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendRule {
    pub id: String,
    pub name: Option<String>,
    pub trigger: FrontendTrigger,
    pub actions: Vec<FrontendAction>,
    pub hold_actions: Option<Vec<FrontendAction>>,
    pub conditions: Vec<FrontendCondition>,
    pub priority: i32,
    #[serde(default = "default_rule_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouseWheelDirection {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrontendTrigger {
    KeyDown {
        #[serde(flatten)]
        chord: KeyChord,
    },
    KeyUp {
        #[serde(flatten)]
        chord: KeyChord,
    },
    MouseDown { code: u8 },
    MouseUp { code: u8 },
    MouseWheel { direction: MouseWheelDirection },
    MouseDoubleClick { code: u8 },
    MouseMove {
        #[serde(default = "default_mouse_move_distance")]
        min_distance: u16,
        #[serde(default = "default_mouse_move_cooldown")]
        cooldown_ms: u32,
    },
    TapHoldKeyDown { code: u8, timeout_ms: u32 },
    TypedText { sequence: String },
}

fn default_mouse_move_distance() -> u16 {
    24
}

fn default_mouse_move_cooldown() -> u32 {
    120
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrontendAction {
    RemapKey {
        #[serde(flatten)]
        chord: KeyChord,
    },
    RemapMouse { code: u8 },
    TypeText { text: String },
    RunMacro { steps: Vec<MacroStep> },
    ToggleLayer { layer_id: String },
    HoldLayer { layer_id: String },
    SystemVolume { action: String },
    MediaKey { key: String },
    WindowAction { action: String },
    LaunchApp { path: String },
    /// Поднять окно указанного процесса/заголовка поверх всех окон.
    /// Поиск по ИЛИ: если заполнены оба поля — поднимает первое окно,
    /// где совпал процесс ИЛИ заголовок (содержит). Достаточно одного.
    FocusProcess {
        #[serde(default)]
        process: Option<String>,
        #[serde(default)]
        title: Option<String>,
    },
    Sleep,
    MonitorOff,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MacroAction {
    KeyDown { code: u8 },
    KeyUp { code: u8 },
    MouseDown { code: u8 },
    MouseUp { code: u8 },
    MouseMove { dx: i32, dy: i32 },
    MouseScroll { delta: i32 },
    MouseHScroll { delta: i32 },
    MouseToAbsolute { x: i32, y: i32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroStep {
    pub action: MacroAction,
    pub delay_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrontendCondition {
    LayerActive { layer_id: String },
    VirtualDesktop { id: u32 },
    /// Объединённое условие «Активное окно»: срабатывает, если совпал процесс ИЛИ заголовок.
    /// process и title оба опциональны, но хотя бы один должен быть заполнен.
    /// Срабатывает по ИЛИ: достаточно совпадения любого из указанных полей.
    WindowMatch {
        #[serde(default)]
        process: Option<String>,
        #[serde(default)]
        title: Option<String>,
    },
}
