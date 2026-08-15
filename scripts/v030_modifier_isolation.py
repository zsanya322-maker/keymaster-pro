from pathlib import Path


def replace(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")


engine = "src-tauri/src/daemon/engine.rs"
replace(
    engine,
    "use crate::schemas::frontend::key_modifiers;",
    "use crate::schemas::frontend::key_modifiers;\nuse crate::daemon::chord_output::{\n    build_atomic_chord_commands, isolate_macro_commands, modifier_vks,\n    press_modifier_commands, release_modifier_commands, shell_mask_commands,\n};",
)

start = '''fn modifier_vks(mask: u16) -> Vec<u8> {
    let mut result = Vec::with_capacity(4);
    if mask & key_modifiers::CTRL != 0 { result.push(0xA2); }
    else {
        if mask & key_modifiers::LCTRL != 0 { result.push(0xA2); }
        if mask & key_modifiers::RCTRL != 0 { result.push(0xA3); }
    }
    if mask & key_modifiers::ALT != 0 { result.push(0xA4); }
    else {
        if mask & key_modifiers::LALT != 0 { result.push(0xA4); }
        if mask & key_modifiers::RALT != 0 { result.push(0xA5); }
    }
    if mask & key_modifiers::SHIFT != 0 { result.push(0xA0); }
    else {
        if mask & key_modifiers::LSHIFT != 0 { result.push(0xA0); }
        if mask & key_modifiers::RSHIFT != 0 { result.push(0xA1); }
    }
    if mask & key_modifiers::WIN != 0 { result.push(0x5B); }
    else {
        if mask & key_modifiers::LWIN != 0 { result.push(0x5B); }
        if mask & key_modifiers::RWIN != 0 { result.push(0x5C); }
    }
    result
}

fn send_atomic_chord(
    simulator: &crate::simulator::SimulatorSender,
    code: u8,
    modifiers: u16,
) {
    let physical = PHYSICAL_MODIFIERS.load(Ordering::Relaxed) & key_modifiers::ALL;
    let physical_vks = modifier_vks(physical);
    let output_vks = modifier_vks(modifiers & key_modifiers::ALL);

    // Neutralize the physical trigger modifiers so Ctrl+Shift+F2 -> Alt+Tab
    // does not accidentally become Ctrl+Shift+Alt+Tab in the foreground app.
    for vk in physical_vks.iter().rev() {
        let _ = simulator.send(SimulatorCommand::ReleaseKey(*vk));
    }
    for vk in &output_vks {
        let _ = simulator.send(SimulatorCommand::PressKey(*vk));
    }
    if code != 0 {
        let _ = simulator.send(SimulatorCommand::PressKey(code));
        let _ = simulator.send(SimulatorCommand::ReleaseKey(code));
    }
    for vk in output_vks.iter().rev() {
        let _ = simulator.send(SimulatorCommand::ReleaseKey(*vk));
    }
    // Restore the OS-visible modifier state to the keys that are still
    // physically held. Injected events are ignored by our LL hook.
    for vk in &physical_vks {
        let _ = simulator.send(SimulatorCommand::PressKey(*vk));
    }
}
'''
new = '''pub(crate) fn currently_held_modifier_vks(mask: u16) -> Vec<u8> {
    let current = PHYSICAL_MODIFIERS.load(Ordering::Relaxed) & mask & key_modifiers::ALL;
    modifier_vks(current)
}

fn current_physical_modifiers() -> u16 {
    PHYSICAL_MODIFIERS.load(Ordering::Relaxed) & key_modifiers::ALL
}

fn send_commands(
    simulator: &crate::simulator::SimulatorSender,
    commands: impl IntoIterator<Item = SimulatorCommand>,
) {
    for command in commands {
        let _ = simulator.send(command);
    }
}

fn send_isolated_immediate(
    simulator: &crate::simulator::SimulatorSender,
    commands: impl IntoIterator<Item = SimulatorCommand>,
) {
    let physical = current_physical_modifiers();
    send_commands(simulator, shell_mask_commands(physical));
    send_commands(simulator, release_modifier_commands(physical));
    send_commands(simulator, commands);
    send_commands(simulator, press_modifier_commands(physical));
}

fn send_atomic_chord(
    simulator: &crate::simulator::SimulatorSender,
    code: u8,
    modifiers: u16,
) {
    let physical = current_physical_modifiers();
    send_commands(
        simulator,
        build_atomic_chord_commands(code, modifiers, physical),
    );
}
'''
replace(engine, start, new)

replace(
    engine,
    '''fn execute_actions(
    actions: &[EngineAction],
    simulator: &crate::simulator::SimulatorSender,
    ctx_arc: &std::sync::Arc<std::sync::RwLock<crate::context::AppContext>>,
    is_down: bool,
    state: Option<&DaemonStateRef>,
    trigger_modifiers: u16,
) -> EventAction {
    for action in actions {''',
    '''fn execute_actions(
    actions: &[EngineAction],
    simulator: &crate::simulator::SimulatorSender,
    ctx_arc: &std::sync::Arc<std::sync::RwLock<crate::context::AppContext>>,
    is_down: bool,
    state: Option<&DaemonStateRef>,
    trigger_modifiers: u16,
) -> EventAction {
    // Even actions that do not synthesize keyboard input must mark an Alt/Win
    // combination as consumed. Otherwise Windows may treat the eventual
    // modifier release as an isolated Alt/Win press (menu/Start activation).
    if is_down && trigger_modifiers != 0 {
        send_commands(simulator, shell_mask_commands(current_physical_modifiers()));
    }

    for action in actions {''',
)

replace(
    engine,
    '''            EngineAction::RemapMouse { code } => {
                if is_down {
                    let _ = simulator.send(SimulatorCommand::MousePress(*code));
                } else {
                    let _ = simulator.send(SimulatorCommand::MouseRelease(*code));
                }
            }''',
    '''            EngineAction::RemapMouse { code } => {
                if trigger_modifiers != 0 {
                    if is_down {
                        send_isolated_immediate(
                            simulator,
                            [SimulatorCommand::MousePress(*code), SimulatorCommand::MouseRelease(*code)],
                        );
                    }
                } else if is_down {
                    let _ = simulator.send(SimulatorCommand::MousePress(*code));
                } else {
                    let _ = simulator.send(SimulatorCommand::MouseRelease(*code));
                }
            }''',
)

replace(
    engine,
    '''            EngineAction::TypeText { text } => {
                if is_down {
                    let _ = simulator.send(SimulatorCommand::TypeString(text.clone()));
                }
            }''',
    '''            EngineAction::TypeText { text } => {
                if is_down {
                    if trigger_modifiers != 0 {
                        send_isolated_immediate(
                            simulator,
                            [SimulatorCommand::TypeString(text.clone())],
                        );
                    } else {
                        let _ = simulator.send(SimulatorCommand::TypeString(text.clone()));
                    }
                }
            }''',
)

replace(
    engine,
    '''                    let _ = simulator.send_macro(macro_commands);''',
    '''                    if trigger_modifiers != 0 {
                        macro_commands = isolate_macro_commands(
                            macro_commands,
                            current_physical_modifiers(),
                        );
                    }
                    let _ = simulator.send_macro(macro_commands);''',
)

replace(
    engine,
    '''                    if vk != 0 {
                        let _ = simulator.send(SimulatorCommand::PressKey(vk));
                        let _ = simulator.send(SimulatorCommand::ReleaseKey(vk));
                    }
                }
            }
            EngineAction::MediaKey { key } => {''',
    '''                    if vk != 0 {
                        if trigger_modifiers != 0 {
                            send_atomic_chord(simulator, vk, 0);
                        } else {
                            let _ = simulator.send(SimulatorCommand::PressKey(vk));
                            let _ = simulator.send(SimulatorCommand::ReleaseKey(vk));
                        }
                    }
                }
            }
            EngineAction::MediaKey { key } => {''',
)

replace(
    engine,
    '''                    if vk != 0 {
                        let _ = simulator.send(SimulatorCommand::PressKey(vk));
                        let _ = simulator.send(SimulatorCommand::ReleaseKey(vk));
                    }
                }
            }
            EngineAction::WindowAction { action } => {''',
    '''                    if vk != 0 {
                        if trigger_modifiers != 0 {
                            send_atomic_chord(simulator, vk, 0);
                        } else {
                            let _ = simulator.send(SimulatorCommand::PressKey(vk));
                            let _ = simulator.send(SimulatorCommand::ReleaseKey(vk));
                        }
                    }
                }
            }
            EngineAction::WindowAction { action } => {''',
)

simulator = "src-tauri/src/simulator/mod.rs"
replace(
    simulator,
    '''        SimulatorCommand::MouseAbsolute { x, y } => move_mouse_absolute(x, y),
    }
}''',
    '''        SimulatorCommand::MouseAbsolute { x, y } => move_mouse_absolute(x, y),
        SimulatorCommand::RestorePhysicalModifiers { mask } => {
            for vk in crate::daemon::engine::currently_held_modifier_vks(mask) {
                send_key(vk, false);
            }
        }
    }
}''',
)

print("modifier isolation patch applied")
