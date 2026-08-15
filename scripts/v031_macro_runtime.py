from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one marker, got {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

p = Path('src-tauri/src/simulator/mod.rs')
s = p.read_text(encoding='utf-8')
s = s.replace('pub mod system;\n', 'pub mod system;\npub mod macro_player;\n', 1)
s = s.replace('use crate::schemas::engine::SimulatorCommand;\n', 'use crate::schemas::engine::{MacroPlaybackConfig, SimulatorCommand};\nuse self::macro_player::{MacroExecutor, MacroPlayer};\n', 1)
s = s.replace(
    '''    immediate_tx: Sender<SimulatorCommand>,\n    macro_tx: Sender<Vec<SimulatorCommand>>,\n''',
    '''    immediate_tx: Sender<SimulatorCommand>,\n    macro_player: MacroPlayer,\n''',
    1,
)
old_method = '''    /// Поставить в очередь один целый макрос. Его задержки выполняются только\n    /// macro-worker'ом и не блокируют мгновенную очередь.\n    pub fn send_macro(\n        &self,\n        commands: Vec<SimulatorCommand>,\n    ) -> Result<(), SendError<Vec<SimulatorCommand>>> {\n        self.macro_tx.send(commands)\n    }\n'''
new_method = '''    /// Поставить в очередь macro-job. Delay/repeat/cancellation живут только в\n    /// macro-player и никогда не блокируют immediate remap queue.\n    pub fn send_macro(\n        &self,\n        commands: Vec<SimulatorCommand>,\n        playback: MacroPlaybackConfig,\n        macro_key: u64,\n    ) -> Result<u64, String> {\n        self.macro_player.enqueue(commands, playback, macro_key)\n    }\n\n    pub fn cancel_macro_key(&self, macro_key: u64) {\n        self.macro_player.cancel_macro_key(macro_key);\n    }\n\n    pub fn cancel_current_macro(&self) {\n        self.macro_player.cancel_current();\n    }\n\n    pub fn cancel_all_macros(&self) {\n        self.macro_player.cancel_all();\n    }\n'''
if old_method not in s:
    raise RuntimeError('old send_macro method not found')
s = s.replace(old_method, new_method, 1)
s = s.replace('type CommandExecutor = Arc<dyn Fn(SimulatorCommand) + Send + Sync + \'static>;\n\n', '', 1)
old_spawn = '''fn spawn_simulator_with_executor(executor: CommandExecutor) -> SimulatorSender {\n    let (immediate_tx, immediate_rx): (Sender<SimulatorCommand>, Receiver<SimulatorCommand>) = mpsc::channel();\n    let (macro_tx, macro_rx): (Sender<Vec<SimulatorCommand>>, Receiver<Vec<SimulatorCommand>>) = mpsc::channel();\n\n    let immediate_executor = Arc::clone(&executor);\n    thread::Builder::new()\n        .name("km-simulator".to_string())\n        .spawn(move || {\n            info!("Immediate simulator thread started.");\n            while let Ok(command) = immediate_rx.recv() {\n                immediate_executor(command);\n            }\n            info!("Immediate simulator thread channel closed, exiting.");\n        })\n        .expect("Failed to spawn simulator thread");\n\n    thread::Builder::new()\n        .name("km-macro-player".to_string())\n        .spawn(move || {\n            info!("Macro player thread started.");\n            while let Ok(commands) = macro_rx.recv() {\n                for command in commands {\n                    executor(command);\n                }\n            }\n            info!("Macro player thread channel closed, exiting.");\n        })\n        .expect("Failed to spawn macro player thread");\n\n    SimulatorSender {\n        immediate_tx,\n        macro_tx,\n    }\n}\n'''
new_spawn = '''fn spawn_simulator_with_executor(executor: MacroExecutor) -> SimulatorSender {\n    let (immediate_tx, immediate_rx): (Sender<SimulatorCommand>, Receiver<SimulatorCommand>) = mpsc::channel();\n    let macro_player = MacroPlayer::spawn(Arc::clone(&executor));\n\n    let immediate_executor = Arc::clone(&executor);\n    thread::Builder::new()\n        .name("km-simulator".to_string())\n        .spawn(move || {\n            info!("Immediate simulator thread started.");\n            while let Ok(command) = immediate_rx.recv() {\n                immediate_executor(command);\n            }\n            info!("Immediate simulator thread channel closed, exiting.");\n        })\n        .expect("Failed to spawn simulator thread");\n\n    SimulatorSender {\n        immediate_tx,\n        macro_player,\n    }\n}\n'''
if old_spawn not in s:
    raise RuntimeError('old simulator spawn block not found')
s = s.replace(old_spawn, new_spawn, 1)
# Replace the old simulator-level tests with APIs matching the job player.
test_start = s.index('#[cfg(test)]\nmod tests {')
s = s[:test_start] + r'''#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn macro_delay_does_not_block_immediate_queue() {
        let (observed_tx, observed_rx) = mpsc::channel::<String>();
        let executor: MacroExecutor = Arc::new(move |command| {
            if let SimulatorCommand::TypeString(text) = command {
                let _ = observed_tx.send(text);
            }
        });

        let sender = spawn_simulator_with_executor(executor);
        sender
            .send_macro(
                vec![
                    SimulatorCommand::Delay(250),
                    SimulatorCommand::TypeString("macro-finished".to_string()),
                ],
                MacroPlaybackConfig::default(),
                1,
            )
            .expect("macro queue should be available");

        std::thread::sleep(Duration::from_millis(25));
        sender
            .send(SimulatorCommand::TypeString("immediate".to_string()))
            .expect("immediate queue should be available");

        assert_eq!(
            observed_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "immediate",
            "immediate command must execute while macro worker is delayed",
        );
        assert_eq!(
            observed_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "macro-finished",
        );
    }

    #[test]
    fn macro_jobs_remain_serial_and_ordered() {
        let (observed_tx, observed_rx) = mpsc::channel::<String>();
        let executor: MacroExecutor = Arc::new(move |command| {
            if let SimulatorCommand::TypeString(text) = command {
                let _ = observed_tx.send(text);
            }
        });

        let sender = spawn_simulator_with_executor(executor);
        sender
            .send_macro(
                vec![
                    SimulatorCommand::TypeString("a".to_string()),
                    SimulatorCommand::TypeString("b".to_string()),
                ],
                MacroPlaybackConfig::default(),
                1,
            )
            .unwrap();
        sender
            .send_macro(
                vec![SimulatorCommand::TypeString("c".to_string())],
                MacroPlaybackConfig::default(),
                2,
            )
            .unwrap();

        let observed = (0..3)
            .map(|_| observed_rx.recv_timeout(Duration::from_secs(1)).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(observed, vec!["a", "b", "c"]);
    }
}
'''
p.write_text(s, encoding='utf-8')

# Engine: start macro jobs with playback/key and cancel while-held jobs on release.
p = Path('src-tauri/src/daemon/engine.rs')
s = p.read_text(encoding='utf-8')
old = '''            EngineAction::MacroCommands { commands } => {\n                if is_down {\n                    let mut macro_commands = commands.clone();\n'''
new = '''            EngineAction::MacroCommands { commands, playback, macro_key } => {\n                if is_down {\n                    let mut macro_commands = commands.clone();\n'''
if old not in s:
    raise RuntimeError('engine MacroCommands match start not found')
s = s.replace(old, new, 1)
old = '''                    let _ = simulator.send_macro(macro_commands);\n                }\n            }\n'''
new = '''                    let _ = simulator.send_macro(macro_commands, *playback, *macro_key);\n                } else if playback.repeat_while_held {\n                    simulator.cancel_macro_key(*macro_key);\n                }\n            }\n'''
if old not in s:
    raise RuntimeError('engine old send_macro call not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

print('cancellable macro runtime wiring staged')
