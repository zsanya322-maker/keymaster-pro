use std::collections::HashSet;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Default)]
pub struct AppContext {
    /// Monotonic foreground-context revision. Layers do not increment it.
    pub revision: u64,
    pub active_process: String,
    pub active_process_path: String,
    pub active_window_title: String,
    pub active_window_class: String,
    /// Stable display device name reported by MONITORINFOEXW (for example
    /// `\\.\DISPLAY1`), not screen coordinates.
    pub monitor_id: String,
    /// Documented IVirtualDesktopManager desktop GUID for the foreground window.
    pub virtual_desktop_id: String,
    pub window_width: i32,
    pub window_height: i32,
    pub fullscreen: bool,
    pub active_layers: HashSet<u64>,
}

pub type AppContextState = Arc<RwLock<AppContext>>;
