use serde::{Deserialize, Serialize};

use crate::schemas::frontend::{FrontendRule, LayerMeta};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub linked_apps: Vec<String>,
    pub rules: Vec<FrontendRule>,
    pub layers: Vec<LayerMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    pub onboarding_complete: bool,
    /// Legacy compatibility field. Tap-Hold timeout is stored per rule and the
    /// engine does not consume this global value.
    pub tap_hold_timeout_ms: u64,
    pub font_size: u32,
    pub row_padding: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: "ru".to_string(),
            theme: "light".to_string(),
            autostart: false,
            minimize_to_tray: true,
            kb_hook_enabled: true,
            mouse_hook_enabled: true,
            debug_mode: false,
            active_profile_id: "1".to_string(),
            scale: 0.85,
            restore_mouse_after_macro: true,
            onboarding_complete: false,
            tap_hold_timeout_ms: 200,
            font_size: 12,
            row_padding: 8,
        }
    }
}
