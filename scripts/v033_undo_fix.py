from pathlib import Path

p = Path('src-tauri/src/daemon/engine.rs')
s = p.read_text(encoding='utf-8')
old = '''            if let Some(undo) = undo {
                for _ in 0..undo.inserted_text.chars().count() {
                    let _ = simulator.send(SimulatorCommand::PressKey(0x08));
                    let _ = simulator.send(SimulatorCommand::ReleaseKey(0x08));
                }
                let _ = simulator.send(SimulatorCommand::TypeString(undo.original_input));
                if let Ok(mut input) = s.text_input.lock() { input.clear_buffer(); }
                return EventAction::Block;
            }
'''
new = '''            if let Some(undo) = undo {
                // Ctrl is physically held while this branch handles Ctrl+Z. Ordinary
                // synthetic Backspace would therefore reach the target as Ctrl+Backspace.
                // Use the existing modifier-isolation path: release physical modifiers,
                // emit the undo atomically through the immediate queue, then restore them.
                let mut commands = Vec::with_capacity(undo.inserted_text.chars().count() * 2 + 1);
                for _ in 0..undo.inserted_text.chars().count() {
                    commands.push(SimulatorCommand::PressKey(0x08));
                    commands.push(SimulatorCommand::ReleaseKey(0x08));
                }
                commands.push(SimulatorCommand::TypeString(undo.original_input));
                send_isolated_immediate(simulator, commands);
                if let Ok(mut input) = s.text_input.lock() { input.clear_buffer(); }
                return EventAction::Block;
            }
'''
count = s.count(old)
if count != 1:
    raise SystemExit(f'Ctrl+Z undo block: expected 1 match, got {count}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('v0.3.3 Ctrl+Z modifier isolation applied')
