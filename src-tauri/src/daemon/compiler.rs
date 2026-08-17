use std::collections::HashMap;

use crate::schemas::engine::{
    CompiledKeyChordSetRule, CompiledKeySequenceRule, CompiledLeaderSequenceRule,
    CompiledMouseGestureRule, CompiledMouseMoveRule, CompiledRule, CompiledTapHoldRule,
    CompiledTextExpansionRule, EngineAction, EngineCondition, EngineSchema, MacroPlaybackConfig,
    SimulatorCommand,
};
use crate::schemas::frontend::{
    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger, MacroAction,
    MacroDefinition, MacroPlayback, MacroStep, MouseWheelDirection,
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
    let mut leader_sequence_rules: Vec<CompiledLeaderSequenceRule> = Vec::new();
    let mut key_sequence_rules: Vec<CompiledKeySequenceRule> = Vec::new();
    let mut key_chord_set_rules: Vec<CompiledKeyChordSetRule> = Vec::new();
    let mut mouse_gesture_rules: Vec<CompiledMouseGestureRule> = Vec::new();
    let macro_library: HashMap<&str, &MacroDefinition> = frontend
        .macros
        .iter()
        .map(|macro_def| (macro_def.id.as_str(), macro_def))
        .collect();

    for rule in frontend.rules.iter().filter(|rule| rule.enabled) {
        match &rule.trigger {
            FrontendTrigger::KeyDown { chord } => {
                keyboard_map
                    .entry(chord.code)
                    .or_default()
                    .push(compile_rule(rule, chord.modifiers, true, &macro_library));
            }
            FrontendTrigger::KeyUp { chord } => {
                keyboard_map
                    .entry(chord.code)
                    .or_default()
                    .push(compile_rule(rule, chord.modifiers, false, &macro_library));
            }
            FrontendTrigger::MouseDown { code } => {
                mouse_map.entry(*code).or_default().push(compile_rule(
                    rule,
                    0,
                    true,
                    &macro_library,
                ));
            }
            FrontendTrigger::MouseUp { code } => {
                mouse_map.entry(*code).or_default().push(compile_rule(
                    rule,
                    0,
                    false,
                    &macro_library,
                ));
            }
            FrontendTrigger::MouseWheel { direction } => {
                mouse_wheel_map
                    .entry(wheel_key(*direction))
                    .or_default()
                    .push(compile_rule(rule, 0, true, &macro_library));
            }
            FrontendTrigger::MouseDoubleClick { code } => {
                mouse_double_click_map
                    .entry(*code)
                    .or_default()
                    .push(compile_rule(rule, 0, true, &macro_library));
            }
            FrontendTrigger::MouseMove {
                min_distance,
                cooldown_ms,
            } => {
                mouse_move_rules.push(compile_mouse_move_rule(
                    rule,
                    *min_distance,
                    *cooldown_ms,
                    &macro_library,
                ));
            }
            FrontendTrigger::LeaderSequence {
                leader,
                sequence,
                timeout_ms,
            } => {
                let sequence: Vec<u8> = sequence
                    .iter()
                    .copied()
                    .filter(|code| *code != 0)
                    .take(16)
                    .collect();
                if leader.code != 0 && !sequence.is_empty() {
                    leader_sequence_rules.push(CompiledLeaderSequenceRule {
                        rule_id_hash: calculate_hash(&rule.id),
                        leader: *leader,
                        sequence,
                        timeout_ms: (*timeout_ms).clamp(100, 10_000),
                        rule: compile_rule(rule, 0, true, &macro_library),
                    });
                }
            }
            FrontendTrigger::KeySequence {
                sequence,
                timeout_ms,
            } => {
                let sequence: Vec<u8> = sequence
                    .iter()
                    .copied()
                    .filter(|code| *code != 0)
                    .take(16)
                    .collect();
                if !sequence.is_empty() {
                    key_sequence_rules.push(CompiledKeySequenceRule {
                        rule_id_hash: calculate_hash(&rule.id),
                        sequence,
                        timeout_ms: (*timeout_ms).clamp(100, 10_000),
                        rule: compile_rule(rule, 0, true, &macro_library),
                    });
                }
            }
            FrontendTrigger::KeyChordSet { codes, max_skew_ms } => {
                let mut codes: Vec<u8> = codes
                    .iter()
                    .copied()
                    .filter(|code| *code != 0)
                    .take(8)
                    .collect();
                codes.sort_unstable();
                codes.dedup();
                if codes.len() >= 3 {
                    key_chord_set_rules.push(CompiledKeyChordSetRule {
                        rule_id_hash: calculate_hash(&rule.id),
                        codes,
                        max_skew_ms: (*max_skew_ms).clamp(10, 1_000),
                        rule: compile_rule(rule, 0, true, &macro_library),
                    });
                }
            }
            FrontendTrigger::MouseGesture {
                code,
                directions,
                min_distance,
            } => {
                let directions = directions.iter().copied().take(8).collect::<Vec<_>>();
                if *code != 0 && !directions.is_empty() {
                    mouse_gesture_rules.push(CompiledMouseGestureRule {
                        rule_id_hash: calculate_hash(&rule.id),
                        code: *code,
                        directions,
                        min_distance: (*min_distance).clamp(4, 500),
                        rule: compile_rule(rule, 0, true, &macro_library),
                    });
                }
            }
            FrontendTrigger::TapHoldKeyDown { code, timeout_ms } => {
                tap_hold_map
                    .entry(*code)
                    .or_default()
                    .push(compile_tap_hold_rule(rule, *timeout_ms, &macro_library));
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
                        rule: compile_rule(rule, 0, true, &macro_library),
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
    leader_sequence_rules.sort_by(|a, b| {
        b.rule
            .priority
            .cmp(&a.rule.priority)
            .then_with(|| b.sequence.len().cmp(&a.sequence.len()))
    });
    key_sequence_rules.sort_by(|a, b| {
        b.rule
            .priority
            .cmp(&a.rule.priority)
            .then_with(|| b.sequence.len().cmp(&a.sequence.len()))
    });
    key_chord_set_rules.sort_by(|a, b| {
        b.rule
            .priority
            .cmp(&a.rule.priority)
            .then_with(|| b.codes.len().cmp(&a.codes.len()))
    });
    mouse_gesture_rules.sort_by(|a, b| {
        b.rule
            .priority
            .cmp(&a.rule.priority)
            .then_with(|| b.directions.len().cmp(&a.directions.len()))
    });

    EngineSchema {
        keyboard_map,
        mouse_map,
        mouse_wheel_map,
        mouse_double_click_map,
        mouse_move_rules,
        tap_hold_map,
        text_expansion_rules,
        leader_sequence_rules,
        key_sequence_rules,
        key_chord_set_rules,
        mouse_gesture_rules,
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
    macro_library: &HashMap<&str, &MacroDefinition>,
) -> CompiledRule {
    let conditions = rule.conditions.iter().map(compile_condition).collect();
    let actions = rule
        .actions
        .iter()
        .enumerate()
        .map(|(index, action)| {
            compile_action(
                action,
                macro_action_key(&rule.id, false, index),
                macro_library,
            )
        })
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
    macro_library: &HashMap<&str, &MacroDefinition>,
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
            .map(|(index, action)| {
                compile_action(
                    action,
                    macro_action_key(&rule.id, false, index),
                    macro_library,
                )
            })
            .collect(),
    }
}

fn compile_tap_hold_rule(
    rule: &FrontendRule,
    timeout_ms: u32,
    macro_library: &HashMap<&str, &MacroDefinition>,
) -> CompiledTapHoldRule {
    let conditions = rule.conditions.iter().map(compile_condition).collect();
    let tap_actions = rule
        .actions
        .iter()
        .enumerate()
        .map(|(index, action)| {
            compile_action(
                action,
                macro_action_key(&rule.id, false, index),
                macro_library,
            )
        })
        .collect();
    let hold_actions = rule
        .hold_actions
        .as_ref()
        .map(|actions| {
            actions
                .iter()
                .enumerate()
                .map(|(index, action)| {
                    compile_action(
                        action,
                        macro_action_key(&rule.id, true, index),
                        macro_library,
                    )
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

fn compile_action(
    action: &FrontendAction,
    macro_key: u64,
    macro_library: &HashMap<&str, &MacroDefinition>,
) -> EngineAction {
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
        FrontendAction::RunMacro { macro_id, playback } => EngineAction::MacroCommands {
            commands: macro_library
                .get(macro_id.as_str())
                .map(|macro_def| compile_macro_commands(&macro_def.steps))
                .unwrap_or_default(),
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
        FrontendAction, FrontendConfig, FrontendRule, FrontendTrigger, GestureDirection, KeyChord,
        MacroAction, MacroDefinition, MacroPlayback, MacroStep, MouseWheelDirection, key_modifiers,
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
            macros: vec![],
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
    fn advanced_triggers_compile_into_bounded_priority_sorted_vectors() {
        let config = FrontendConfig {
            rules: vec![
                rule(
                    "leader-low",
                    1,
                    FrontendTrigger::LeaderSequence {
                        leader: KeyChord {
                            code: 0x14,
                            modifiers: key_modifiers::CTRL,
                        },
                        sequence: vec![0x46, 0x46],
                        timeout_ms: 50,
                    },
                    FrontendAction::TypeText {
                        text: "leader".into(),
                        date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                        time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                    },
                ),
                rule(
                    "sequence-high",
                    40,
                    FrontendTrigger::KeySequence {
                        sequence: (1u8..=30).collect(),
                        timeout_ms: 50_000,
                    },
                    FrontendAction::TypeText {
                        text: "sequence".into(),
                        date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                        time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                    },
                ),
                rule(
                    "chord",
                    20,
                    FrontendTrigger::KeyChordSet {
                        codes: vec![0x4B, 0, 0x4A, 0x4B, 0x4C],
                        max_skew_ms: 1,
                    },
                    FrontendAction::TypeText {
                        text: "chord".into(),
                        date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                        time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                    },
                ),
                rule(
                    "gesture",
                    30,
                    FrontendTrigger::MouseGesture {
                        code: 4,
                        directions: vec![
                            GestureDirection::Right,
                            GestureDirection::Down,
                            GestureDirection::Left,
                            GestureDirection::Up,
                            GestureDirection::Right,
                            GestureDirection::Down,
                            GestureDirection::Left,
                            GestureDirection::Up,
                            GestureDirection::Right,
                        ],
                        min_distance: 1,
                    },
                    FrontendAction::TypeText {
                        text: "gesture".into(),
                        date_format: crate::schemas::frontend::TextDateFormat::Dmy,
                        time_format: crate::schemas::frontend::TextTimeFormat::Hm24,
                    },
                ),
            ],
            macros: vec![],
            layers: vec![],
            tap_hold_timeout_ms: 200,
        };
        let schema = compile_schema(&config);

        assert_eq!(schema.leader_sequence_rules.len(), 1);
        assert_eq!(schema.leader_sequence_rules[0].timeout_ms, 100);
        assert_eq!(
            schema.leader_sequence_rules[0].leader.modifiers,
            key_modifiers::CTRL
        );
        assert_eq!(schema.leader_sequence_rules[0].sequence, vec![0x46, 0x46]);

        assert_eq!(schema.key_sequence_rules.len(), 1);
        assert_eq!(schema.key_sequence_rules[0].sequence.len(), 16);
        assert_eq!(schema.key_sequence_rules[0].timeout_ms, 10_000);

        assert_eq!(schema.key_chord_set_rules.len(), 1);
        assert_eq!(schema.key_chord_set_rules[0].codes, vec![0x4A, 0x4B, 0x4C]);
        assert_eq!(schema.key_chord_set_rules[0].max_skew_ms, 10);

        assert_eq!(schema.mouse_gesture_rules.len(), 1);
        assert_eq!(schema.mouse_gesture_rules[0].directions.len(), 8);
        assert_eq!(schema.mouse_gesture_rules[0].min_distance, 4);
    }

    #[test]
    fn macro_ids_resolve_only_the_referenced_library_object() {
        let playback = MacroPlayback::default();
        let config = FrontendConfig {
            rules: vec![
                rule(
                    "macro-valid",
                    10,
                    FrontendTrigger::KeyDown {
                        chord: KeyChord::single(0x70),
                    },
                    FrontendAction::RunMacro {
                        macro_id: "macro-a".into(),
                        playback: playback.clone(),
                    },
                ),
                rule(
                    "macro-missing",
                    9,
                    FrontendTrigger::KeyDown {
                        chord: KeyChord::single(0x71),
                    },
                    FrontendAction::RunMacro {
                        macro_id: "does-not-exist".into(),
                        playback,
                    },
                ),
            ],
            macros: vec![MacroDefinition {
                id: "macro-a".into(),
                name: "A".into(),
                steps: vec![
                    MacroStep {
                        action: MacroAction::KeyDown { code: 0x41 },
                        delay_ms: 12,
                    },
                    MacroStep {
                        action: MacroAction::KeyUp { code: 0x41 },
                        delay_ms: 0,
                    },
                ],
            }],
            layers: vec![],
            tap_hold_timeout_ms: 200,
        };

        let schema = compile_schema(&config);
        let valid = &schema.keyboard_map.get(&0x70).unwrap()[0].actions[0];
        match valid {
            EngineAction::MacroCommands { commands, .. } => assert_eq!(
                commands,
                &vec![
                    SimulatorCommand::PressKey(0x41),
                    SimulatorCommand::Delay(12),
                    SimulatorCommand::ReleaseKey(0x41),
                ]
            ),
            other => panic!("expected macro commands, got {other:?}"),
        }

        let missing = &schema.keyboard_map.get(&0x71).unwrap()[0].actions[0];
        match missing {
            EngineAction::MacroCommands { commands, .. } => assert!(commands.is_empty()),
            other => panic!("expected empty macro commands, got {other:?}"),
        }
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
            macros: vec![],
            layers: vec![],
            tap_hold_timeout_ms: 200,
        });
        assert!(schema.keyboard_map.is_empty());
        assert!(schema.mouse_wheel_map.is_empty());
        assert!(schema.mouse_double_click_map.is_empty());
        assert!(schema.mouse_move_rules.is_empty());
        assert!(schema.leader_sequence_rules.is_empty());
        assert!(schema.key_sequence_rules.is_empty());
        assert!(schema.key_chord_set_rules.is_empty());
        assert!(schema.mouse_gesture_rules.is_empty());
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
