from pathlib import Path

path = Path('src-tauri/src/daemon/engine.rs')
text = path.read_text(encoding='utf-8')
old = '''use crate::daemon::chord_output::{
    build_atomic_chord_commands, isolate_macro_commands, modifier_vks,
    press_modifier_commands, release_modifier_commands, shell_mask_commands,
};'''
new = '''use crate::daemon::chord_output::{
    build_atomic_chord_commands, isolate_macro_commands, modifier_vks,
    release_modifier_commands, shell_mask_commands,
};'''
if text.count(old) != 1:
    raise RuntimeError('engine import pattern mismatch')
text = text.replace(old, new, 1)
old = '''    send_commands(simulator, shell_mask_commands(physical));
    send_commands(simulator, release_modifier_commands(physical));
    send_commands(simulator, commands);
    send_commands(simulator, press_modifier_commands(physical));
}'''
new = '''    send_commands(simulator, shell_mask_commands(physical));
    send_commands(simulator, release_modifier_commands(physical));
    send_commands(simulator, commands);
    if physical != 0 {
        let _ = simulator.send(SimulatorCommand::RestorePhysicalModifiers { mask: physical });
    }
}'''
if text.count(old) != 1:
    raise RuntimeError('send_isolated_immediate pattern mismatch')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
