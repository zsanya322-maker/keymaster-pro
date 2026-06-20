/// Общий код между GUI и Daemon процессами
pub mod types;
pub mod config;
pub mod persistence;
pub mod constants;

pub fn calculate_hash<T: std::hash::Hash>(t: &T) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::Hasher;
    let mut s = DefaultHasher::new();
    t.hash(&mut s);
    s.finish()
}

pub fn clean_process_name(name: &str) -> String {
    let lowercase = name.to_lowercase();
    if lowercase.ends_with(".exe") {
        lowercase[..lowercase.len() - 4].to_string()
    } else {
        lowercase
    }
}