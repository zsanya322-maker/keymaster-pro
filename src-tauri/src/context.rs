use std::collections::HashSet;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
pub struct AppContext {
    pub active_process: String,
    pub active_window_title: String,
    pub active_layers: HashSet<u64>,
}

impl Default for AppContext {
    fn default() -> Self {
        Self {
            active_process: String::new(),
            active_window_title: String::new(),
            active_layers: HashSet::new(),
        }
    }
}

pub type AppContextState = Arc<RwLock<AppContext>>;
