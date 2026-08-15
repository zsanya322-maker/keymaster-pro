use std::collections::HashMap;

use crate::schemas::engine::{
    CompiledRule, CompiledTapHoldRule, EngineAction, EngineCondition, EngineSchema,
    SimulatorCommand,
};
use crate::schemas::frontend::{
    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger,
    MacroAction,
};
use crate::shared::calculate_hash;

pub fn compile_schema(frontend: &FrontendConfig) -> EngineSchema {
    let mut keyboard_map: HashMap<u8, Vec<CompiledRule>> = HashMap::new();
    let mut mouse_map: HashMap<u8, Vec<CompiledRule>> = HashMap::new();
    let mut tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>> = HashMap::new();
    let mut text_expansion_map: HashMap<String, Vec<CompiledRule>> = HashMap::new();

    for rule in frontend.rules.iter().filter(|rule| rule.enabled) {
        match &rule.trigger {
            FrontendTrigger::KeyDown { chord } | FrontendTrigger::KeyUp { chord } => {
                keyboard_map
                    .entry(chord.code)
                    .or_default()
                    .push(compile_rule(rule, chord.modifiers));
            }
            FrontendTrigger::MouseDown { code } | FrontendTrigger::MouseUp { code } => {
                mouse_map
                    .entry(*code)
                    .or_default()
                    .push(compile_rule(rule, 0));
            }
            FrontendTrigger::TapHoldKeyDown { code, timeout_ms } => {
                tap_hold_map
                    .entry(*code)
                    .or_default()
                    .push(compile_tap_hold_rule(rule, *timeout_ms));
            }
            FrontendTrigger::TypedText { sequence } => {
                text_expansion_map
                    .entry(sequence.clone())
                    .or_default()
                    .push(compile_rule(rule, 0));
            }
        }
    }

    for rules in keyboard_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    for rules in mouse_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    for rules in tap_hold_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    for rules in text_expansion_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }

    EngineSchema {
        keyboard_map,
        mouse_map,
        tap_hold_map,
        text_expansion_map,
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

fn compile_rule(rule: &FrontendRule, required_modifiers: u16) -> CompiledRule {
    let conditions = rule.conditions.iter().map(compile_condition).collect();
    let actions = rule.actions.iter().map(compile_action).collect();

    CompiledRule {
        priority: rule.priority,
        required_modifiers,
        conditions,
        actions,
    }
}

fn compile_tap_hold_rule(rule: &FrontendRule, timeout_ms: u32) -> CompiledTapHoldRule {
    let conditions = rule.conditions.iter().map(compile_condition).collect();
    let tap_actions = rule.actions.iter().map(compile_action).collect();
    let hold_actions = rule
        .hold_actions
        .as_ref()
        .map(|actions| actions.iter().map(compile_action).collect())
        .unwrap_or_default();

    CompiledTapHoldRule {
        priority: rule.priority,
        timeout_ms,
        conditions,
        tap_actions,
        hold_actions,
    }
}

fn compile_action(action: &FrontendAction) -> EngineAction {
    match action {
        FrontendAction::RemapKey { chord } => EngineAction::RemapKey {
            code: chord.code,
            modifiers: chord.modifiers,
        },
        FrontendAction::RemapMouse { code } => EngineAction::RemapMouse { code: *code },
        FrontendAction::TypeText { text } => EngineAction::TypeText { text: text.clone() },
        FrontendAction::RunMacro { steps } => {
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
                    MacroAction::MouseToAbsolute { x, y } => {
                        commands.push(SimulatorCommand::MouseAbsolute { x, y })
                    }
                }
                if step.delay_ms > 0 {
                    commands.push(SimulatorCommand::Delay(step.delay_ms));
                }
            }
            EngineAction::MacroCommands { commands }
        }
        FrontendAction::ToggleLayer { layer_id } => EngineAction::ToggleLayer {
            layer_id_hash: calculate_hash(layer_id),
        },
        FrontendAction::HoldLayer { layer_id } => EngineAction::HoldLayerPush {
            layer_id_hash: calculate_hash(layer_id),
        },
        FrontendAction::SystemVolume { action } => {
            EngineAction::SystemVolume { action: action.clone() }
        }
        FrontendAction::MediaKey { key } => EngineAction::MediaKey { key: key.clone() },
        FrontendAction::WindowAction { action } => {
            EngineAction::WindowAction { action: action.clone() }
        }
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
        key_modifiers, FrontendAction, FrontendConfig, FrontendRule, FrontendTrigger,
        KeyChord,
    };

    fn rule(id: &str, priority: i32, trigger: FrontendTrigger, action: FrontendAction) -> FrontendRule {
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
    fn test_compile_schema_distribution_and_modifiers() {
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
                FrontendTrigger::KeyDown {
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
                },
                FrontendAction::TypeText {
                    text: "result".into(),
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
        assert_eq!(schema.tap_hold_map.len(), 1);
        assert_eq!(schema.text_expansion_map.len(), 1);

        let kb_rules = schema.keyboard_map.get(&0x41).unwrap();
        assert_eq!(kb_rules.len(), 2);
        assert_eq!(kb_rules[0].priority, 20);
        assert_eq!(kb_rules[1].priority, 10);
        assert_eq!(
            kb_rules[1].required_modifiers,
            key_modifiers::CTRL | key_modifiers::SHIFT
        );
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
