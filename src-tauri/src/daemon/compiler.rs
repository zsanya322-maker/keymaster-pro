use std::collections::HashMap;

use crate::schemas::engine::{
    CompiledMouseMoveRule, CompiledRule, CompiledTapHoldRule, CompiledTextExpansionRule,
    EngineAction, EngineCondition, EngineSchema, MacroPlaybackConfig, SimulatorCommand,
};
use crate::schemas::frontend::{
    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger, MacroAction,
    MacroPlayback, MacroStep, MouseWheelDirection,
};
use crate::shared::calculate_hash;

fn wheel_key(direction: MouseWheelDirection) -> i8 {
    match direction {
        MouseWheelDirection::Up => 1,
        MouseWheelDirection::Down => -1,
        MouseWheelDirection::Right => 2,
        MouseWheelDirection::Left => -2,
    }
}

pub fn compile_schema(frontend: &FrontendConfig) -> EngineSchema {
    let mut keyboard_map: HashMap<u8, Vec<CompiledRule>> = HashMap::new();
    let mut mouse_map: HashMap<u8, Vec<CompiledRule>> = HashMap::new();
    let mut mouse_wheel_map: HashMap<i8, Vec<CompiledRule>> = HashMap::new();
    let mut mouse_double_click_map: HashMap<u8, Vec<CompiledRule>> = HashMap::new();
    let mut mouse_move_rules: Vec<CompiledMouseMoveRule> = Vec::new();
    let mut tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>> = HashMap::new();
    let mut text_expansion_rules: Vec<CompiledTextExpansionRule> = Vec::new();

    for rule in frontend.rules.iter().filter(|rule| rule.enabled) {
        match &rule.trigger {
            FrontendTrigger::KeyDown { chord } => {
                keyboard_map
                    .entry(chord.code)
                    .or_default()
                    .push(compile_rule(rule, chord.modifiers, true));
            }
            FrontendTrigger::KeyUp { chord } => {
                keyboard_map
                    .entry(chord.code)
                    .or_default()
                    .push(compile_rule(rule, chord.modifiers, false));
            }
            FrontendTrigger::MouseDown { code } => {
                mouse_map
                    .entry(*code)
                    .or_default()
                    .push(compile_rule(rule, 0, true));
            }
            FrontendTrigger::MouseUp { code } => {
                mouse_map
                    .entry(*code)
                    .or_default()
                    .push(compile_rule(rule, 0, false));
            }
            FrontendTrigger::MouseWheel { direction } => {
                mouse_wheel_map
                    .entry(wheel_key(*direction))
                    .or_default()
                    .push(compile_rule(rule, 0, true));
            }
            FrontendTrigger::MouseDoubleClick { code } => {
                mouse_double_click_map
                    .entry(*code)
                    .or_default()
                    .push(compile_rule(rule, 0, true));
            }
            FrontendTrigger::MouseMove {
                min_distance,
                cooldown_ms,
            } => {
                mouse_move_rules.push(compile_mouse_move_rule(rule, *min_distance, *cooldown_ms));
            }
            FrontendTrigger::TapHoldKeyDown { code, timeout_ms } => {
                tap_hold_map
                    .entry(*code)
                    .or_default()
                    .push(compile_tap_hold_rule(rule, *timeout_ms));
            }
            FrontendTrigger::TypedText {
                sequence,
                mode,
                delimiters,
                case_sensitive,
            } => {
                if !sequence.is_empty() {
                    text_expansion_rules.push(CompiledTextExpansionRule {
                        sequence: sequence.clone(),
                        mode: *mode,
                        delimiters: delimiters.clone(),
                        case_sensitive: *case_sensitive,
                        rule: compile_rule(rule, 0, true),
                    });
                }
            }
        }
    }

    for rules in keyboard_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    for rules in mouse_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    for rules in mouse_wheel_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    for rules in mouse_double_click_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    mouse_move_rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    for rules in tap_hold_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    text_expansion_rules.sort_by(|a, b| {
        b.rule
            .priority
            .cmp(&a.rule.priority)
            .then_with(|| b.sequence.chars().count().cmp(&a.sequence.chars().count()))
            .then_with(|| a.sequence.cmp(&b.sequence))
    });

    EngineSchema {
        keyboard_map,
        mouse_map,
        mouse_wheel_map,
        mouse_double_click_map,
        mouse_move_rules,
        tap_hold_map,
        text_expansion_rules,
    }
}

fn compile_condition(condition: &FrontendCondition) -> EngineCondition {
    match condition {
        FrontendCondition::LayerActive { layer_id } => EngineCondition::LayerActive {
            layer_id_hash: calculate_hash(layer_id),
        },
        FrontendCondition::VirtualDesktop { .. } => {
            // Compatibility only: Virtual Desktop is still unsupported at runtime.
            // Fail closed instead of silently turning the rule into a global rule.
            EngineCondition::WindowMatch {
                process_hash: None,
                title_contains: Some("\0".to_string()),
            }
        }
        FrontendCondition::ContextMatch {
            process,
            path,
            title,
            class_name,
            virtual_desktop_id,
            monitor_id,
            min_width,
            max_width,
            min_height,
            max_height,
            fullscreen,
            mode,
        } => EngineCondition::ContextMatch {
            process: process
                .as_ref()
                .filter(|v| !v.trim().is_empty())
                .map(|v| v.trim().to_lowercase()),
            path: path
                .as_ref()
                .filter(|v| !v.trim().is_empty())
                .map(|v| v.trim().to_lowercase()),
            title: title
                .as_ref()
                .filter(|v| !v.trim().is_empty())
                .map(|v| v.trim().to_lowercase()),
            class_name: class_name
                .as_ref()
                .filter(|v| !v.trim().is_empty())
                .map(|v| v.trim().to_lowercase()),
            virtual_desktop_id: virtual_desktop_id.clone(),
            monitor_id: monitor_id.clone(),
            min_width: *min_width,
            max_width: *max_width,
            min_height: *min_height,
            max_height: *max_height,
            fullscreen: *fullscreen,
            mode: *mode,
        },
        FrontendCondition::WindowMatch { process, title } => EngineCondition::WindowMatch {
            process_hash: process
                .as_ref()
                .filter(|s| !s.is_empty())
                .map(|p| calculate_hash(&crate::shared::clean_process_name(p))),
            title_contains: title
                .as_ref()
                .filter(|s| !s.is_empty())
                .map(|t| t.to_lowercase()),
        },
    }
}

fn compile_rule(
    rule: &FrontendRule,
    required_modifiers: u16,
    trigger_on_down: bool,
) -> CompiledRule {
    let conditions = rule.conditions.iter().map(compile_condition).collect();
    let actions = rule
        .actions
        .iter()
        .enumerate()
        .map(|(index, action)| compile_action(action, macro_action_key(&rule.id, false, index)))
        .collect();

    CompiledRule {
        priority: rule.priority,
        required_modifiers,
        trigger_on_down,
        conditions,
        actions,
    }
}

fn compile_mouse_move_rule(
    rule: &FrontendRule,
    min_distance: u16,
    cooldown_ms: u32,
) -> CompiledMouseMoveRule {
    CompiledMouseMoveRule {
        rule_id_hash: calculate_hash(&rule.id),
        priority: rule.priority,
        min_distance: min_distance.max(1),
        cooldown_ms,
        conditions: rule.conditions.iter().map(compile_condition).collect(),
        actions: rule
            .actions
            .iter()
            .enumerate()
            .map(|(index, action)| compile_action(action, macro_action_key(&rule.id, false, index)))
            .collect(),
    }
}

fn compile_tap_hold_rule(rule: &FrontendRule, timeout_ms: u32) -> CompiledTapHoldRule {
    let conditions = rule.conditions.iter().map(compile_condition).collect();
    let tap_actions = rule
        .actions
        .iter()
        .enumerate()
        .map(|(index, action)| compile_action(action, macro_action_key(&rule.id, false, index)))
        .collect();
    let hold_actions = rule
        .hold_actions
        .as_ref()
        .map(|actions| {
            actions
                .iter()
                .enumerate()
                .map(|(index, action)| {
                    compile_action(action, macro_action_key(&rule.id, true, index))
                })
                .collect()
        })
        .unwrap_or_default();

    CompiledTapHoldRule {
        priority: rule.priority,
        timeout_ms,
        conditions,
        tap_actions,
        hold_actions,
    }
}

fn macro_action_key(rule_id: &str, hold: bool, index: usize) -> u64 {
    calculate_hash(&format!(
        "{}:{}:{}",
        rule_id,
        if hold { "hold" } else { "tap" },
        index
    ))
}

pub fn compile_macro_playback(playback: &MacroPlayback) -> MacroPlaybackConfig {
    MacroPlaybackConfig {
        speed: playback.speed,
        repeat_count: playback.repeat_count,
        repeat_while_held: playback.repeat_while_held,
    }
    .normalized()
}

pub fn compile_macro_commands(steps: &[MacroStep]) -> Vec<SimulatorCommand> {
    let mut commands = Vec::new();
    for step in steps {
        match step.action {
            MacroAction::KeyDown { code } => commands.push(SimulatorCommand::PressKey(code)),
            MacroAction::KeyUp { code } => commands.push(SimulatorCommand::ReleaseKey(code)),
            MacroAction::MouseDown { code } => commands.push(SimulatorCommand::MousePress(code)),
            MacroAction::MouseUp { code } => commands.push(SimulatorCommand::MouseRelease(code)),
            MacroAction::MouseMove { dx, dy } => {
                commands.push(SimulatorCommand::MouseMove { dx, dy })
            }
            MacroAction::MouseScroll { delta } => {
                commands.push(SimulatorCommand::MouseScroll { delta })
            }
            MacroAction::MouseHScroll { delta } => {
                commands.push(SimulatorCommand::MouseHScroll { delta })
            }
            MacroAction::MouseToAbsolute { x, y } => {
                commands.push(SimulatorCommand::MouseAbsolute { x, y })
            }
        }
        if step.delay_ms > 0 {
            commands.push(SimulatorCommand::Delay(step.delay_ms));
        }
    }
    commands
}

fn compile_action(action: &FrontendAction, macro_key: u64) -> EngineAction {
    match action {
        FrontendAction::RemapKey { chord } => EngineAction::RemapKey {
            code: chord.code,
            modifiers: chord.modifiers,
        },
        FrontendAction::RemapMouse { code } => EngineAction::RemapMouse { code: *code },
        FrontendAction::TypeText {
            text,
            date_format,
            time_format,
        } => EngineAction::TypeText {
            text: text.clone(),
            date_format: *date_format,
            time_format: *time_format,
        },
        FrontendAction::RunMacro { steps, playback } => EngineAction::MacroCommands {
            commands: compile_macro_commands(steps),
            playback: compile_macro_playback(playback),
            macro_key,
        },
        FrontendAction::ToggleLayer { layer_id } => EngineAction::ToggleLayer {
            layer_id_hash: calculate_hash(layer_id),
        },
        FrontendAction::HoldLayer { layer_id } => EngineAction::HoldLayerPush {
            layer_id_hash: calculate_hash(layer_id),
        },
        FrontendAction::SystemVolume { action } => EngineAction::SystemVolume {
            action: action.clone(),
        },
        FrontendAction::MediaKey { key } => EngineAction::MediaKey { key: key.clone() },
        FrontendAction::WindowAction { action } => EngineAction::WindowAction {
            action: action.clone(),
        },
        FrontendAction::LaunchApp { path } => EngineAction::LaunchApp { path: path.clone() },
        FrontendAction::FocusProcess { process, title } => {
            let clean_process = process
                .as_deref()
                .map(crate::shared::clean_process_name)
                .filter(|p| !p.is_empty());
            let clean_title = title
                .as_deref()
                .map(|t| t.trim().to_lowercase())
                .filter(|t| !t.is_empty());
            EngineAction::FocusProcess {
                process: clean_process,
                title: clean_title,
            }
        }
        FrontendAction::Sleep => EngineAction::Sleep,
        FrontendAction::MonitorOff => EngineAction::MonitorOff,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schemas::frontend::{
        FrontendAction, FrontendConfig, FrontendRule, FrontendTrigger, KeyChord,
        MouseWheelDirection, key_modifiers,
    };

    fn rule(
        id: &str,
        priority: i32,
        trigger: FrontendTrigger,
        action: FrontendAction,
    ) -> FrontendRule {
        FrontendRule {
            id: id.into(),
            name: None,
            priority,
            trigger,
            conditions: vec![],
            actions: vec![action],
            hold_actions: None,
            enabled: true,
            folder_id: None,
            order: 0,
        }
    }

    #[test]
    fn test_compile_schema_distribution_modifiers_edges_and_mouse_types() {
        let rules = vec![
            rule(
                "1",
                10,
                FrontendTrigger::KeyDown {
                    chord: KeyChord {
                        code: 0x41,
                        modifiers: key_modifiers::CTRL | key_modifiers::SHIFT,
                    },
                },
                FrontendAction::RemapKey {
                    chord: KeyChord::single(0x42),
                },
            ),
            rule(
                "2",
                20,
                FrontendTrigger::KeyUp {
                    chord: KeyChord::single(0x41),
                },
                FrontendAction::RemapKey {
                    chord: KeyChord::single(0x43),
                },
            ),
            rule(
                "3",
                15,
                FrontendTrigger::MouseDown { code: 1 },
                FrontendAction::RemapMouse { code: 2 },
            ),
            FrontendRule {
                id: "4".into(),
                name: None,
                priority: 5,
                trigger: FrontendTrigger::TapHoldKeyDown {
                    code: 0x20,
                    timeout_ms: 200,
                },
                conditions: vec![],
                actions: vec![FrontendAction::RemapKey {
                    chord: KeyChord::single(0x21),
                }],
                hold_actions: Some(vec![FrontendAction::HoldLayer {
                    layer_id: "test".into(),
                }]),
                enabled: true,
                folder_id: None,
                order: 0,
            },
            rule(
                "5",
                1,
                FrontendTrigger::TypedText {
                    sequence: "test".into(),
                    mode: crate::schemas::frontend::TextExpansionMode::Instant,
                    delimiters: " \t\n.,;:!?".into(),
                    case_sensitive: true,
                },
                FrontendAction::TypeText {
                    text: "result".into(),
                    date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                    time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                },
            ),
            rule(
                "6",
                30,
                FrontendTrigger::MouseWheel {
                    direction: MouseWheelDirection::Up,
                },
                FrontendAction::TypeText {
                    text: "up".into(),
                    date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                    time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                },
            ),
            rule(
                "7",
                25,
                FrontendTrigger::MouseDoubleClick { code: 4 },
                FrontendAction::TypeText {
                    text: "x1x2".into(),
                    date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                    time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                },
            ),
            rule(
                "8",
                2,
                FrontendTrigger::MouseMove {
                    min_distance: 32,
                    cooldown_ms: 150,
                },
                FrontendAction::TypeText {
                    text: "move".into(),
                    date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                    time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                },
            ),
        ];

        let config = FrontendConfig {
            rules,
            layers: vec![],
            tap_hold_timeout_ms: 200,
        };

        let schema = compile_schema(&config);
        assert_eq!(schema.keyboard_map.len(), 1);
        assert_eq!(schema.mouse_map.len(), 1);
        assert_eq!(schema.mouse_wheel_map.len(), 1);
        assert_eq!(schema.mouse_double_click_map.len(), 1);
        assert_eq!(schema.mouse_move_rules.len(), 1);
        assert_eq!(schema.tap_hold_map.len(), 1);
        assert_eq!(schema.text_expansion_rules.len(), 1);

        let kb_rules = schema.keyboard_map.get(&0x41).unwrap();
        assert_eq!(kb_rules.len(), 2);
        assert_eq!(kb_rules[0].priority, 20);
        assert!(!kb_rules[0].trigger_on_down);
        assert_eq!(kb_rules[1].priority, 10);
        assert!(kb_rules[1].trigger_on_down);
        assert_eq!(
            kb_rules[1].required_modifiers,
            key_modifiers::CTRL | key_modifiers::SHIFT
        );
        assert_eq!(schema.mouse_wheel_map.get(&1).unwrap()[0].priority, 30);
        assert_eq!(
            schema.mouse_double_click_map.get(&4).unwrap()[0].priority,
            25
        );
        assert_eq!(schema.mouse_move_rules[0].min_distance, 32);
        assert_eq!(schema.mouse_move_rules[0].cooldown_ms, 150);
    }

    #[test]
    fn disabled_rules_are_not_compiled() {
        let mut disabled = rule(
            "disabled",
            1,
            FrontendTrigger::KeyDown {
                chord: KeyChord::single(0x41),
            },
            FrontendAction::RemapKey {
                chord: KeyChord::single(0x42),
            },
        );
        disabled.enabled = false;

        let schema = compile_schema(&FrontendConfig {
            rules: vec![disabled],
            layers: vec![],
            tap_hold_timeout_ms: 200,
        });
        assert!(schema.keyboard_map.is_empty());
        assert!(schema.mouse_wheel_map.is_empty());
        assert!(schema.mouse_double_click_map.is_empty());
        assert!(schema.mouse_move_rules.is_empty());
    }

    #[test]
    fn test_wheel_direction_keys_are_stable() {
        assert_eq!(wheel_key(MouseWheelDirection::Up), 1);
        assert_eq!(wheel_key(MouseWheelDirection::Down), -1);
        assert_eq!(wheel_key(MouseWheelDirection::Right), 2);
        assert_eq!(wheel_key(MouseWheelDirection::Left), -2);
    }

    #[test]
    fn test_layer_id_hashing() {
        let hash1 = calculate_hash(&"my_layer_1");
        let hash2 = calculate_hash(&"my_layer_1");
        let hash3 = calculate_hash(&"my_layer_2");
        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_unimplemented_virtual_desktop_condition_fails_closed() {
        let compiled = compile_condition(&FrontendCondition::VirtualDesktop { id: 7 });
        match compiled {
            EngineCondition::WindowMatch {
                process_hash,
                title_contains,
            } => {
                assert!(process_hash.is_none());
                assert_eq!(title_contains.as_deref(), Some("\0"));
            }
            other => panic!("Unexpected compiled condition: {:?}", other),
        }
    }
}
