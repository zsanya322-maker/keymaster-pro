use serde::{Serialize, Deserialize};

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
pub struct FrontendRule {
    pub id: String,
    pub name: Option<String>,
    pub trigger: FrontendTrigger,
    pub actions: Vec<FrontendAction>,
    pub hold_actions: Option<Vec<FrontendAction>>,
    pub conditions: Vec<FrontendCondition>,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrontendTrigger {
    KeyDown { code: u8 },
    KeyUp { code: u8 },
    MouseDown { code: u8 },
    MouseUp { code: u8 },
    TapHoldKeyDown { code: u8, timeout_ms: u32 },
    TypedText { sequence: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrontendAction {
    RemapKey { code: u8 },
    RemapMouse { code: u8 },
    TypeText { text: String },
    RunMacro { steps: Vec<MacroStep> },
    ToggleLayer { layer_id: String },
    HoldLayer { layer_id: String },
    SystemVolume { action: String },
    MediaKey { key: String },
    WindowAction { action: String },
    LaunchApp { path: String },
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
    ProcessActive { process: String },
    WindowFocused { title: String },
    LayerActive { layer_id: String },
    VirtualDesktop { id: u32 },
}
