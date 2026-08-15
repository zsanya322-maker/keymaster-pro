use crate::schemas::engine::SimulatorCommand;
use crate::schemas::frontend::key_modifiers;

const SHELL_MASK_KEY: u8 = 0x87; // F24 — intentionally obscure, no text output.

pub fn modifier_vks(mask: u16) -> Vec<u8> {
    let mut result = Vec::with_capacity(4);
    if mask & key_modifiers::CTRL != 0 {
        result.push(0xA2);
    } else {
        if mask & key_modifiers::LCTRL != 0 { result.push(0xA2); }
        if mask & key_modifiers::RCTRL != 0 { result.push(0xA3); }
    }
    if mask & key_modifiers::ALT != 0 {
        result.push(0xA4);
    } else {
        if mask & key_modifiers::LALT != 0 { result.push(0xA4); }
        if mask & key_modifiers::RALT != 0 { result.push(0xA5); }
    }
    if mask & key_modifiers::SHIFT != 0 {
        result.push(0xA0);
    } else {
        if mask & key_modifiers::LSHIFT != 0 { result.push(0xA0); }
        if mask & key_modifiers::RSHIFT != 0 { result.push(0xA1); }
    }
    if mask & key_modifiers::WIN != 0 {
        result.push(0x5B);
    } else {
        if mask & key_modifiers::LWIN != 0 { result.push(0x5B); }
        if mask & key_modifiers::RWIN != 0 { result.push(0x5C); }
    }
    result
}

pub fn shell_mask_commands(mask: u16) -> Vec<SimulatorCommand> {
    let alt = key_modifiers::ALT | key_modifiers::LALT | key_modifiers::RALT;
    let win = key_modifiers::WIN | key_modifiers::LWIN | key_modifiers::RWIN;
    if mask & (alt | win) == 0 {
        Vec::new()
    } else {
        vec![
            SimulatorCommand::PressKey(SHELL_MASK_KEY),
            SimulatorCommand::ReleaseKey(SHELL_MASK_KEY),
        ]
    }
}

pub fn release_modifier_commands(mask: u16) -> Vec<SimulatorCommand> {
    modifier_vks(mask)
        .into_iter()
        .rev()
        .map(SimulatorCommand::ReleaseKey)
        .collect()
}

pub fn press_modifier_commands(mask: u16) -> Vec<SimulatorCommand> {
    modifier_vks(mask)
        .into_iter()
        .map(SimulatorCommand::PressKey)
        .collect()
}

/// Build a fully isolated chord output for synchronous/immediate actions.
///
/// The source modifiers are temporarily released so they cannot leak into the
/// output chord. Alt/Win get an F24 mask event before release so Windows does
/// not interpret their synthetic release as an isolated Alt/Win press.
pub fn build_atomic_chord_commands(
    code: u8,
    output_modifiers: u16,
    physical_modifiers: u16,
) -> Vec<SimulatorCommand> {
    let physical = physical_modifiers & key_modifiers::ALL;
    let output = output_modifiers & key_modifiers::ALL;
    let mut commands = shell_mask_commands(physical);
    commands.extend(release_modifier_commands(physical));
    commands.extend(press_modifier_commands(output));

    if code != 0 {
        commands.push(SimulatorCommand::PressKey(code));
        commands.push(SimulatorCommand::ReleaseKey(code));
    }

    commands.extend(
        modifier_vks(output)
            .into_iter()
            .rev()
            .map(SimulatorCommand::ReleaseKey),
    );
    if physical != 0 {
        commands.push(SimulatorCommand::RestorePhysicalModifiers { mask: physical });
    }
    commands
}

/// Wrap an asynchronous macro so source modifiers do not alter its keyboard or
/// mouse events. Restoration is deferred until the macro worker reaches the end
/// and is based on the *current* physical key state, not the launch snapshot.
pub fn isolate_macro_commands(
    commands: Vec<SimulatorCommand>,
    physical_modifiers: u16,
) -> Vec<SimulatorCommand> {
    let physical = physical_modifiers & key_modifiers::ALL;
    if physical == 0 {
        return commands;
    }

    let mut isolated = shell_mask_commands(physical);
    isolated.extend(release_modifier_commands(physical));
    isolated.extend(commands);
    isolated.push(SimulatorCommand::RestorePhysicalModifiers { mask: physical });
    isolated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ctrl_shift_to_alt_tab_has_safe_order() {
        let source = key_modifiers::LCTRL | key_modifiers::RSHIFT;
        let commands = build_atomic_chord_commands(0x09, key_modifiers::ALT, source);
        assert_eq!(
            commands,
            vec![
                SimulatorCommand::ReleaseKey(0xA1),
                SimulatorCommand::ReleaseKey(0xA2),
                SimulatorCommand::PressKey(0xA4),
                SimulatorCommand::PressKey(0x09),
                SimulatorCommand::ReleaseKey(0x09),
                SimulatorCommand::ReleaseKey(0xA4),
                SimulatorCommand::RestorePhysicalModifiers { mask: source },
            ]
        );
    }

    #[test]
    fn win_and_alt_source_get_shell_mask_before_release() {
        let commands = build_atomic_chord_commands(
            0x41,
            0,
            key_modifiers::LWIN | key_modifiers::LALT,
        );
        assert_eq!(commands[0], SimulatorCommand::PressKey(SHELL_MASK_KEY));
        assert_eq!(commands[1], SimulatorCommand::ReleaseKey(SHELL_MASK_KEY));
        assert_eq!(commands[2], SimulatorCommand::ReleaseKey(0x5B));
        assert_eq!(commands[3], SimulatorCommand::ReleaseKey(0xA4));
    }

    #[test]
    fn macro_restores_only_through_runtime_command() {
        let commands = isolate_macro_commands(
            vec![SimulatorCommand::PressKey(0x41), SimulatorCommand::ReleaseKey(0x41)],
            key_modifiers::CTRL,
        );
        assert_eq!(commands[0], SimulatorCommand::ReleaseKey(0xA2));
        assert_eq!(
            commands.last(),
            Some(&SimulatorCommand::RestorePhysicalModifiers { mask: key_modifiers::CTRL })
        );
    }
}
