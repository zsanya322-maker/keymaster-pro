use crate::schemas::frontend::{TextDateFormat, TextExpansionMode, TextTimeFormat};
use crate::shared::types::MatchMode;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct EngineSchema {
    pub keyboard_map: HashMap<u8, Vec<CompiledRule>>,
    pub mouse_map: HashMap<u8, Vec<CompiledRule>>,
    /// Wheel key: 1=up, -1=down, 2=right, -2=left.
    pub mouse_wheel_map: HashMap<i8, Vec<CompiledRule>>,
    pub mouse_double_click_map: HashMap<u8, Vec<CompiledRule>>,
    pub mouse_move_rules: Vec<CompiledMouseMoveRule>,
    pub tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>>,
    pub text_expansion_rules: Vec<CompiledTextExpansionRule>,
}

impl Default for EngineSchema {
    fn default() -> Self {
        Self {
            keyboard_map: HashMap::new(),
            mouse_map: HashMap::new(),
            mouse_wheel_map: HashMap::new(),
            mouse_double_click_map: HashMap::new(),
            mouse_move_rules: Vec::new(),
            tap_hold_map: HashMap::new(),
            text_expansion_rules: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CompiledRule {
    pub priority: i32,
    /// Keyboard-only modifier requirement. Non-keyboard rules keep this at 0.
    pub required_modifiers: u16,
    /// `true` for KeyDown/MouseDown and `false` for KeyUp/MouseUp.
    /// Text-expansion rules use `true` because they are explicitly activated by
    /// the text matcher rather than by an input edge.
    pub trigger_on_down: bool,
    pub conditions: Vec<EngineCondition>,
    pub actions: Vec<EngineAction>,
}

#[derive(Debug, Clone)]
pub struct CompiledTextExpansionRule {
    pub sequence: String,
    pub mode: TextExpansionMode,
    pub delimiters: String,
    pub case_sensitive: bool,
    pub rule: CompiledRule,
}

#[derive(Debug, Clone)]
pub struct CompiledMouseMoveRule {
    pub rule_id_hash: u64,
    pub priority: i32,
    pub min_distance: u16,
    pub cooldown_ms: u32,
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
    LayerActive {
        layer_id_hash: u64,
    },
    VirtualDesktop {
        id: u32,
    },
    /// Объединённое условие «Активное окно»: срабатывает по ИЛИ.
    /// Хотя бы одно поле должно быть Some. None = не проверяется.
    ContextMatch {
        process: Option<String>,
        path: Option<String>,
        title: Option<String>,
        class_name: Option<String>,
        virtual_desktop_id: Option<String>,
        monitor_id: Option<String>,
        min_width: Option<i32>,
        max_width: Option<i32>,
        min_height: Option<i32>,
        max_height: Option<i32>,
        fullscreen: Option<bool>,
        mode: MatchMode,
    },
    WindowMatch {
        process_hash: Option<u64>,
        title_contains: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MacroPlaybackConfig {
    pub speed: f32,
    pub repeat_count: u32,
    pub repeat_while_held: bool,
}

impl Default for MacroPlaybackConfig {
    fn default() -> Self {
        Self {
            speed: 1.0,
            repeat_count: 1,
            repeat_while_held: false,
        }
    }
}

impl MacroPlaybackConfig {
    pub fn normalized(self) -> Self {
        Self {
            speed: if self.speed.is_finite() {
                self.speed.clamp(0.1, 10.0)
            } else {
                1.0
            },
            repeat_count: self.repeat_count.clamp(1, 10_000),
            repeat_while_held: self.repeat_while_held,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SimulatorCommand {
    PressKey(u8),
    ReleaseKey(u8),
    MousePress(u8),
    MouseRelease(u8),
    TypeString(String),
    Delay(u32),
    MouseMove {
        dx: i32,
        dy: i32,
    },
    MouseScroll {
        delta: i32,
    },
    MouseHScroll {
        delta: i32,
    },
    MouseAbsolute {
        x: i32,
        y: i32,
    },
    /// Re-assert only source modifiers that are still physically held when the
    /// command executes. Used at the end of asynchronous macro jobs.
    RestorePhysicalModifiers {
        mask: u16,
    },
}

#[derive(Debug, Clone)]
pub enum EngineAction {
    RemapKey {
        code: u8,
        modifiers: u16,
    },
    RemapMouse {
        code: u8,
    },
    TypeText {
        text: String,
        date_format: TextDateFormat,
        time_format: TextTimeFormat,
    },
    TypeTextLiteral {
        text: String,
    },
    MacroCommands {
        commands: Vec<SimulatorCommand>,
        playback: MacroPlaybackConfig,
        macro_key: u64,
    },
    ToggleLayer {
        layer_id_hash: u64,
    },
    HoldLayerPush {
        layer_id_hash: u64,
    },
    HoldLayerPop {
        layer_id_hash: u64,
    },
    SystemVolume {
        action: String,
    },
    MediaKey {
        key: String,
    },
    WindowAction {
        action: String,
    },
    LaunchApp {
        path: String,
    },
    /// Поднять окно указанного процесса/заголовка поверх всех окон.
    /// Поиск по ИЛИ: process (точное совпадение clean-имени) ИЛИ title (содержит).
    FocusProcess {
        process: Option<String>,
        title: Option<String>,
    },
    Sleep,
    MonitorOff,
}
