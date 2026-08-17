use std::collections::HashSet;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Default)]
pub struct AppContext {
    /// Monotonic foreground-context revision. Layer changes do not increment it.
    pub revision: u64,
    pub active_process: String,
    pub active_process_path: String,
    pub active_window_title: String,
    pub active_window_class: String,
    pub window_width: i32,
    pub window_height: i32,
    pub fullscreen: bool,
    pub monitor_id: String,
    pub virtual_desktop_id: String,
    pub active_layers: HashSet<u64>,
}

pub type AppContextState = Arc<RwLock<AppContext>>;
