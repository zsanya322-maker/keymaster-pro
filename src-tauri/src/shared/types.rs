/// Общие типы данных для GUI и Daemon
///
/// Ремаппинги, слои, макросы, профили.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapRule {
    pub id: String,
    pub profile_id: String,
    pub original_key: String,
    pub mapped_key: String,
    pub layer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseRemapRule {
    pub id: String,
    pub profile_id: String,
    pub original_button: String,
    pub mapped_action: String,
    pub layer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub priority: i32,
    pub trigger_type: String, // 'hotkey' | 'process' | 'window_title' | 'none'
    pub trigger_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroStep {
    pub id: String,
    pub action_type: String, // 'key_down' | 'key_up' | 'mouse_click' | 'delay'
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Macro {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub trigger_key: String,
    pub steps: Vec<MacroStep>,
    pub target_app: Option<String>,
    pub trigger_type: Option<String>,
    pub trigger_time: Option<u32>,
    pub trigger_layout: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextExpansion {
    pub id: String,
    pub profile_id: String,
    pub trigger: String,
    pub replacement: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub linked_apps: Vec<String>,
    pub remaps: Vec<RemapRule>,
    pub mouse_remaps: Vec<MouseRemapRule>,
    pub layers: Vec<Layer>,
    pub macros: Vec<Macro>,
    pub text_expansions: Vec<TextExpansion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub language: String,
    pub theme: String,
    pub autostart: bool,
    pub minimize_to_tray: bool,
    pub kb_hook_enabled: bool,
    pub mouse_hook_enabled: bool,
    pub debug_mode: bool,
    pub active_profile_id: String,
    pub scale: f64,
    pub restore_mouse_after_macro: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            theme: "dark".to_string(),
            autostart: false,
            minimize_to_tray: true,
            kb_hook_enabled: true,
            mouse_hook_enabled: true,
            debug_mode: false,
            active_profile_id: "1".to_string(),
            scale: 0.85,
            restore_mouse_after_macro: true,
        }
    }
}