use std::collections::HashMap;

use crate::schemas::frontend::{FrontendConfig, FrontendRule, FrontendTrigger, FrontendAction, FrontendCondition, MacroAction};
use crate::schemas::engine::{EngineSchema, CompiledRule, CompiledTapHoldRule, EngineCondition, EngineAction, SimulatorCommand};
use crate::shared::calculate_hash;

pub fn compile_schema(frontend: &FrontendConfig) -> EngineSchema {
    let mut keyboard_map: HashMap<u8, Vec<CompiledRule>> = HashMap::new();
    let mut mouse_map: HashMap<u8, Vec<CompiledRule>> = HashMap::new();
    let mut tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>> = HashMap::new();
    let mut text_expansion_map: HashMap<String, Vec<CompiledRule>> = HashMap::new();

    for rule in &frontend.rules {
        match rule.trigger {
            FrontendTrigger::KeyDown { code } | FrontendTrigger::KeyUp { code } => {
                keyboard_map.entry(code).or_default().push(compile_rule(rule));
            }
            FrontendTrigger::MouseDown { code } | FrontendTrigger::MouseUp { code } => {
                mouse_map.entry(code).or_default().push(compile_rule(rule));
            }
            FrontendTrigger::TapHoldKeyDown { code, timeout_ms } => {
                tap_hold_map.entry(code).or_default().push(compile_tap_hold_rule(rule, timeout_ms));
            }
            FrontendTrigger::TypedText { ref sequence } => {
                text_expansion_map.entry(sequence.clone()).or_default().push(compile_rule(rule));
            }
        }
    }

    // Sort descending by priority
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

fn compile_rule(rule: &FrontendRule) -> CompiledRule {
    let conditions = rule.conditions.iter().map(|c| match c {
        FrontendCondition::WindowFocused { process, .. } => {
            EngineCondition::WindowFocused { process_hash: calculate_hash(&process.to_lowercase()) }
        }
        FrontendCondition::LayerActive { layer_id } => {
            EngineCondition::LayerActive { layer_id_hash: calculate_hash(layer_id) }
        }
        FrontendCondition::VirtualDesktop { id } => {
            EngineCondition::VirtualDesktop { id: *id }
        }
    }).collect();

    let actions = rule.actions.iter().map(compile_action).collect();

    CompiledRule {
        priority: rule.priority,
        conditions,
        actions,
    }
}

fn compile_tap_hold_rule(rule: &FrontendRule, timeout_ms: u32) -> CompiledTapHoldRule {
    let conditions = rule.conditions.iter().map(|c| match c {
        FrontendCondition::WindowFocused { process, .. } => {
            EngineCondition::WindowFocused { process_hash: calculate_hash(&process.to_lowercase()) }
        }
        FrontendCondition::LayerActive { layer_id } => {
            EngineCondition::LayerActive { layer_id_hash: calculate_hash(layer_id) }
        }
        FrontendCondition::VirtualDesktop { id } => {
            EngineCondition::VirtualDesktop { id: *id }
        }
    }).collect();

    let tap_actions = rule.actions.iter().map(compile_action).collect();
    let hold_actions = rule.hold_actions.as_ref()
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

fn compile_action(a: &FrontendAction) -> EngineAction {
    match a {
        FrontendAction::RemapKey { code } => EngineAction::RemapKey { code: *code },
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
                    MacroAction::MouseMove { dx, dy } => commands.push(SimulatorCommand::MouseMove { dx, dy }),
                    MacroAction::MouseScroll { delta } => commands.push(SimulatorCommand::MouseScroll { delta }),
                    MacroAction::MouseToAbsolute { x, y } => commands.push(SimulatorCommand::MouseAbsolute { x, y }),
                }
                if step.delay_ms > 0 {
                    commands.push(SimulatorCommand::Delay(step.delay_ms));
                }
            }
            EngineAction::MacroCommands { commands }
        }
        FrontendAction::ToggleLayer { layer_id } => EngineAction::ToggleLayer { layer_id_hash: calculate_hash(layer_id) },
        FrontendAction::HoldLayer { layer_id } => EngineAction::HoldLayerPush { layer_id_hash: calculate_hash(layer_id) },
        FrontendAction::SystemVolume { action } => EngineAction::SystemVolume { action: action.clone() },
        FrontendAction::MediaKey { key } => EngineAction::MediaKey { key: key.clone() },
        FrontendAction::WindowAction { action } => EngineAction::WindowAction { action: action.clone() },
        FrontendAction::LaunchApp { path } => EngineAction::LaunchApp { path: path.clone() },
        FrontendAction::Sleep => EngineAction::Sleep,
        FrontendAction::MonitorOff => EngineAction::MonitorOff,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schemas::frontend::{FrontendConfig, FrontendRule, FrontendTrigger, FrontendAction, FrontendCondition};

    #[test]
    fn test_compile_schema_distribution() {
        let rules = vec![
            FrontendRule {
                id: "1".into(),
                priority: 10,
                trigger: FrontendTrigger::KeyDown { code: 0x41 },
                conditions: vec![],
                actions: vec![FrontendAction::RemapKey { code: 0x42 }],
                hold_actions: None,
            },
            FrontendRule {
                id: "2".into(),
                priority: 20,
                trigger: FrontendTrigger::KeyDown { code: 0x41 },
                conditions: vec![],
                actions: vec![FrontendAction::RemapKey { code: 0x43 }],
                hold_actions: None,
            },
            FrontendRule {
                id: "3".into(),
                priority: 15,
                trigger: FrontendTrigger::MouseDown { code: 1 },
                conditions: vec![],
                actions: vec![FrontendAction::RemapMouse { code: 2 }],
                hold_actions: None,
            },
            FrontendRule {
                id: "4".into(),
                priority: 5,
                trigger: FrontendTrigger::TapHoldKeyDown { code: 0x20, timeout_ms: 200 },
                conditions: vec![],
                actions: vec![FrontendAction::RemapKey { code: 0x21 }],
                hold_actions: Some(vec![FrontendAction::HoldLayer { layer_id: "test".into() }]),
            },
            FrontendRule {
                id: "5".into(),
                priority: 1,
                trigger: FrontendTrigger::TypedText { sequence: "test".into() },
                conditions: vec![],
                actions: vec![FrontendAction::TypeText { text: "result".into() }],
                hold_actions: None,
            },
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
    }

    #[test]
    fn test_layer_id_hashing() {
        let hash1 = calculate_hash(&"my_layer_1");
        let hash2 = calculate_hash(&"my_layer_1");
        let hash3 = calculate_hash(&"my_layer_2");

        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
    }
}
