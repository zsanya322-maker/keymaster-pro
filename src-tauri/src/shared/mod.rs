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