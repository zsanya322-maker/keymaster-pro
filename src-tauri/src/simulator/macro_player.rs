use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tracing::info;

use crate::schemas::engine::{MacroPlaybackConfig, SimulatorCommand};

pub type MacroExecutor = Arc<dyn Fn(SimulatorCommand) + Send + Sync + 'static>;

#[derive(Debug, Clone)]
struct MacroJob {
    id: u64,
    macro_key: u64,
    key_generation: u64,
    global_generation: u64,
    commands: Vec<SimulatorCommand>,
    playback: MacroPlaybackConfig,
}

#[derive(Debug, Default)]
struct MacroControl {
    next_job_id: AtomicU64,
    global_generation: AtomicU64,
    active_job_id: AtomicU64,
    key_generations: Mutex<HashMap<u64, u64>>,
    cancelled_jobs: Mutex<HashSet<u64>>,
    pending_while_held: Mutex<HashSet<u64>>,
}

impl MacroControl {
    fn next_id(&self) -> u64 {
        self.next_job_id
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1)
    }

    fn key_generation(&self, macro_key: u64) -> u64 {
        self.key_generations
            .lock()
            .ok()
            .and_then(|map| map.get(&macro_key).copied())
            .unwrap_or(0)
    }

    fn is_cancelled(&self, job: &MacroJob) -> bool {
        if self.global_generation.load(Ordering::Acquire) != job.global_generation {
            return true;
        }
        if self.key_generation(job.macro_key) != job.key_generation {
            return true;
        }
        self.cancelled_jobs
            .lock()
            .map(|set| set.contains(&job.id))
            .unwrap_or(true)
    }

    fn finish(&self, job: &MacroJob) {
        self.active_job_id.store(0, Ordering::Release);
        if let Ok(mut cancelled) = self.cancelled_jobs.lock() {
            cancelled.remove(&job.id);
        }
        if job.playback.repeat_while_held {
            if let Ok(mut pending) = self.pending_while_held.lock() {
                pending.remove(&job.macro_key);
            }
        }
    }
}

#[derive(Clone)]
pub struct MacroPlayer {
    tx: Sender<MacroJob>,
    control: Arc<MacroControl>,
}

impl std::fmt::Debug for MacroPlayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MacroPlayer").finish_non_exhaustive()
    }
}

impl MacroPlayer {
    pub fn spawn(executor: MacroExecutor) -> Self {
        let (tx, rx) = mpsc::channel::<MacroJob>();
        let control = Arc::new(MacroControl::default());
        let worker_control = Arc::clone(&control);

        thread::Builder::new()
            .name("km-macro-player".to_string())
            .spawn(move || {
                info!("Macro job player started.");
                while let Ok(job) = rx.recv() {
                    if worker_control.is_cancelled(&job) {
                        worker_control.finish(&job);
                        continue;
                    }
                    worker_control
                        .active_job_id
                        .store(job.id, Ordering::Release);
                    run_job(&job, &worker_control, &executor);
                    worker_control.finish(&job);
                }
                info!("Macro job player channel closed, exiting.");
            })
            .expect("Failed to spawn macro player thread");

        Self { tx, control }
    }

    pub fn enqueue(
        &self,
        commands: Vec<SimulatorCommand>,
        playback: MacroPlaybackConfig,
        macro_key: u64,
    ) -> Result<u64, String> {
        let playback = playback.normalized();

        // An infinite/held job is unique per action key. Windows keyboard
        // autorepeat must not enqueue another infinite copy for the same press.
        if playback.repeat_while_held {
            let mut pending = self
                .control
                .pending_while_held
                .lock()
                .map_err(|_| "Macro pending set is poisoned".to_string())?;
            if !pending.insert(macro_key) {
                return Ok(0);
            }
        }

        let id = self.control.next_id();
        let job = MacroJob {
            id,
            macro_key,
            key_generation: self.control.key_generation(macro_key),
            global_generation: self.control.global_generation.load(Ordering::Acquire),
            commands,
            playback,
        };

        if self.tx.send(job).is_err() {
            if playback.repeat_while_held {
                if let Ok(mut pending) = self.control.pending_while_held.lock() {
                    pending.remove(&macro_key);
                }
            }
            return Err("Macro player channel is closed".to_string());
        }
        Ok(id)
    }

    pub fn cancel_macro_key(&self, macro_key: u64) {
        if let Ok(mut generations) = self.control.key_generations.lock() {
            let generation = generations.entry(macro_key).or_insert(0);
            *generation = generation.wrapping_add(1);
        }
        if let Ok(mut pending) = self.control.pending_while_held.lock() {
            pending.remove(&macro_key);
        }
    }

    pub fn cancel_current(&self) {
        let active = self.control.active_job_id.load(Ordering::Acquire);
        if active != 0 {
            if let Ok(mut cancelled) = self.control.cancelled_jobs.lock() {
                cancelled.insert(active);
            }
        }
    }

    pub fn cancel_all(&self) {
        self.control
            .global_generation
            .fetch_add(1, Ordering::AcqRel);
        if let Ok(mut pending) = self.control.pending_while_held.lock() {
            pending.clear();
        }
    }
}

fn run_job(job: &MacroJob, control: &MacroControl, executor: &MacroExecutor) {
    let repeats = if job.playback.repeat_while_held {
        u32::MAX
    } else {
        job.playback.repeat_count.max(1)
    };

    for _ in 0..repeats {
        if control.is_cancelled(job) {
            break;
        }

        let mut held_keys: Vec<u8> = Vec::new();
        let mut held_buttons: Vec<u8> = Vec::new();
        let mut cancelled = false;

        for command in &job.commands {
            if control.is_cancelled(job) {
                cancelled = true;
                break;
            }

            match command {
                SimulatorCommand::Delay(ms) => {
                    let scaled = scaled_delay(*ms, job.playback.speed);
                    if !sleep_cancellable(scaled, job, control) {
                        cancelled = true;
                        break;
                    }
                }
                SimulatorCommand::PressKey(code) => {
                    executor(command.clone());
                    if !held_keys.contains(code) {
                        held_keys.push(*code);
                    }
                }
                SimulatorCommand::ReleaseKey(code) => {
                    executor(command.clone());
                    held_keys.retain(|held| held != code);
                }
                SimulatorCommand::MousePress(code) => {
                    executor(command.clone());
                    if !held_buttons.contains(code) {
                        held_buttons.push(*code);
                    }
                }
                SimulatorCommand::MouseRelease(code) => {
                    executor(command.clone());
                    held_buttons.retain(|held| held != code);
                }
                _ => executor(command.clone()),
            }
        }

        // A malformed macro or cancellation may leave a synthetic input down.
        // Clean it at every iteration boundary, not only when the thread exits.
        for button in held_buttons.into_iter().rev() {
            executor(SimulatorCommand::MouseRelease(button));
        }
        for key in held_keys.into_iter().rev() {
            executor(SimulatorCommand::ReleaseKey(key));
        }

        if cancelled || control.is_cancelled(job) {
            break;
        }
    }
}

fn scaled_delay(ms: u32, speed: f32) -> Duration {
    if ms == 0 {
        return Duration::ZERO;
    }
    let speed = speed.clamp(0.1, 10.0) as f64;
    let scaled_ms = (f64::from(ms) / speed).round().max(1.0) as u64;
    Duration::from_millis(scaled_ms)
}

fn sleep_cancellable(duration: Duration, job: &MacroJob, control: &MacroControl) -> bool {
    let mut remaining = duration;
    const SLICE: Duration = Duration::from_millis(10);
    while !remaining.is_zero() {
        if control.is_cancelled(job) {
            return false;
        }
        let wait = remaining.min(SLICE);
        thread::sleep(wait);
        remaining = remaining.saturating_sub(wait);
    }
    !control.is_cancelled(job)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn playback() -> MacroPlaybackConfig {
        MacroPlaybackConfig {
            speed: 1.0,
            repeat_count: 1,
            repeat_while_held: false,
        }
    }

    #[test]
    fn speed_scales_delay_without_rewriting_source_commands() {
        assert_eq!(scaled_delay(100, 2.0), Duration::from_millis(50));
        assert_eq!(scaled_delay(100, 0.5), Duration::from_millis(200));
        assert_eq!(scaled_delay(1, 10.0), Duration::from_millis(1));
    }

    #[test]
    fn cancellation_releases_held_key() {
        let (tx, rx) = mpsc::channel::<SimulatorCommand>();
        let executor: MacroExecutor = Arc::new(move |command| {
            let _ = tx.send(command);
        });
        let player = MacroPlayer::spawn(executor);
        let id = player
            .enqueue(
                vec![
                    SimulatorCommand::PressKey(0x41),
                    SimulatorCommand::Delay(10_000),
                ],
                playback(),
                7,
            )
            .unwrap();
        assert!(id > 0);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            SimulatorCommand::PressKey(0x41)
        );
        player.cancel_current();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            SimulatorCommand::ReleaseKey(0x41)
        );
    }

    #[test]
    fn repeat_count_replays_in_order() {
        let (tx, rx) = mpsc::channel::<SimulatorCommand>();
        let executor: MacroExecutor = Arc::new(move |command| {
            let _ = tx.send(command);
        });
        let player = MacroPlayer::spawn(executor);
        player
            .enqueue(
                vec![SimulatorCommand::TypeString("x".to_string())],
                MacroPlaybackConfig {
                    repeat_count: 3,
                    ..playback()
                },
                11,
            )
            .unwrap();
        let seen = (0..3)
            .map(|_| rx.recv_timeout(Duration::from_secs(1)).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            seen,
            vec![
                SimulatorCommand::TypeString("x".to_string()),
                SimulatorCommand::TypeString("x".to_string()),
                SimulatorCommand::TypeString("x".to_string()),
            ]
        );
    }

    #[test]
    fn held_repeat_is_unique_and_cancelled_by_key() {
        let (tx, rx) = mpsc::channel::<SimulatorCommand>();
        let executor: MacroExecutor = Arc::new(move |command| {
            let _ = tx.send(command);
        });
        let player = MacroPlayer::spawn(executor);
        let held = MacroPlaybackConfig {
            repeat_count: 1,
            repeat_while_held: true,
            ..playback()
        };
        assert!(
            player
                .enqueue(
                    vec![
                        SimulatorCommand::TypeString("held".to_string()),
                        SimulatorCommand::Delay(20),
                    ],
                    held,
                    99,
                )
                .unwrap()
                > 0
        );
        assert_eq!(
            player
                .enqueue(
                    vec![SimulatorCommand::TypeString("dup".to_string())],
                    held,
                    99
                )
                .unwrap(),
            0
        );
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            SimulatorCommand::TypeString("held".to_string())
        );
        player.cancel_macro_key(99);
    }
}
