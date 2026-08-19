use serde::{Deserialize, Serialize};

use crate::schemas::frontend::{FrontendRule, LayerMeta, MacroDefinition, RuleFolder};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum MatchMode {
    #[default]
    Any,
    All,
}

/// Structured application binding used by profile auto-switch.
///
/// `linked_apps` remains on Profile for backward compatibility and migrates
/// semantically as an exact process-name binding. New UI writes this structure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBinding {
    #[serde(default)]
    pub process: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub class_name: Option<String>,
    #[serde(default)]
    pub virtual_desktop_id: Option<String>,
    #[serde(default)]
    pub monitor_id: Option<String>,
    #[serde(default)]
    pub fullscreen: Option<bool>,
    #[serde(default)]
    pub mode: MatchMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    /// Legacy exact process-name bindings. Kept readable/writable through the
    /// 0.3.x migration window so old exports remain valid.
    #[serde(default)]
    pub linked_apps: Vec<String>,
    #[serde(default)]
    pub bindings: Vec<ProfileBinding>,
    #[serde(default)]
    pub order: i32,
    pub rules: Vec<FrontendRule>,
    #[serde(default)]
    pub macros: Vec<MacroDefinition>,
    pub layers: Vec<LayerMeta>,
    #[serde(default)]
    pub folders: Vec<RuleFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderProfile {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub language: String,
    /// False for legacy configs that predate explicit locale tracking. The GUI
    /// then chooses ru/en from the Windows/WebView locale once and persists it.
    pub language_user_selected: bool,
    pub theme: String,
    pub autostart: bool,
    pub minimize_to_tray: bool,
    pub kb_hook_enabled: bool,
    pub mouse_hook_enabled: bool,
    pub debug_mode: bool,
    /// Persisted manual/preferred profile. Runtime auto-switch must NEVER rewrite
    /// this field just because the foreground window changed.
    pub active_profile_id: String,
    pub auto_switch_profiles: bool,
    pub manual_profile_lock: bool,
    pub scale: f64,
    pub restore_mouse_after_macro: bool,
    /// Single VK used to cancel every queued/running macro. 0 disables it.
    pub macro_emergency_stop_vk: u8,
    pub onboarding_complete: bool,
    /// Legacy compatibility field. Tap-Hold timeout is stored per rule and the
    /// engine does not consume this global value.
    pub tap_hold_timeout_ms: u64,
    pub font_size: u32,
    pub row_padding: u32,
    pub ai_providers: Vec<AiProviderProfile>,
    pub active_ai_provider_id: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: "ru".to_string(),
            language_user_selected: false,
            theme: "light".to_string(),
            autostart: false,
            minimize_to_tray: true,
            kb_hook_enabled: true,
            mouse_hook_enabled: true,
            debug_mode: false,
            active_profile_id: "1".to_string(),
            auto_switch_profiles: false,
            manual_profile_lock: false,
            scale: 0.85,
            restore_mouse_after_macro: true,
            macro_emergency_stop_vk: 0x13, // Pause
            onboarding_complete: false,
            tap_hold_timeout_ms: 200,
            font_size: 12,
            row_padding: 8,
            ai_providers: Vec::new(),
            active_ai_provider_id: None,
        }
    }
}
