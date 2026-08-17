from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


p = 'src-tauri/src/daemon/compiler.rs'
replace_once(
    p,
    '''        FrontendAction, FrontendConfig, FrontendRule, FrontendTrigger, KeyChord,
        MouseWheelDirection, key_modifiers,
    };''',
    '''        FrontendAction, FrontendConfig, FrontendRule, FrontendTrigger, GestureDirection,
        KeyChord, MouseWheelDirection, key_modifiers,
    };'''
)
replace_once(
    p,
    '''    #[test]
    fn disabled_rules_are_not_compiled() {''',
    r'''    #[test]
    fn advanced_triggers_compile_into_bounded_priority_sorted_vectors() {
        let config = FrontendConfig {
            rules: vec![
                rule(
                    "leader-low",
                    1,
                    FrontendTrigger::LeaderSequence {
                        leader: KeyChord { code: 0x14, modifiers: key_modifiers::CTRL },
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
            layers: vec![],
            tap_hold_timeout_ms: 200,
        };
        let schema = compile_schema(&config);

        assert_eq!(schema.leader_sequence_rules.len(), 1);
        assert_eq!(schema.leader_sequence_rules[0].timeout_ms, 100);
        assert_eq!(schema.leader_sequence_rules[0].leader.modifiers, key_modifiers::CTRL);
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
    fn disabled_rules_are_not_compiled() {'''
)
replace_once(
    p,
    '''        assert!(schema.mouse_move_rules.is_empty());
    }''',
    '''        assert!(schema.mouse_move_rules.is_empty());
        assert!(schema.leader_sequence_rules.is_empty());
        assert!(schema.key_sequence_rules.is_empty());
        assert!(schema.key_chord_set_rules.is_empty());
        assert!(schema.mouse_gesture_rules.is_empty());
    }'''
)

# Static audit catches the high-value cross-language/version wiring before heavy compilation.
checks = {
    'package.json': ['"version": "0.4.0"'],
    'src-tauri/Cargo.toml': ['version = "0.4.0"'],
    'src-tauri/tauri.conf.json': ['"version": "0.4.0"'],
    'src-tauri/src/shared/persistence.rs': ['PROFILE_SCHEMA_VERSION: u32 = 6', '5 => {'],
    'src/app/App.tsx': ['const PROFILE_SCHEMA_VERSION = 6'],
    'src/lib/types.ts': ["type: 'leaderSequence'", "type: 'keySequence'", "type: 'keyChordSet'", "type: 'mouseGesture'"],
    'src-tauri/src/schemas/frontend.rs': ['LeaderSequence {', 'KeySequence {', 'KeyChordSet {', 'MouseGesture {'],
    'src-tauri/src/schemas/engine.rs': ['leader_sequence_rules', 'key_sequence_rules', 'key_chord_set_rules', 'mouse_gesture_rules'],
    'src-tauri/src/daemon/input_state.rs': ['MAX_SEQUENCE_EVENTS', 'prepare_window', 'chord_should_fire', 'finish_gesture'],
    'src-tauri/src/daemon/engine.rs': ['leader_sequence_rules', 'key_sequence_rules', 'key_chord_set_rules', 'mouse_gesture_rules', 'prepare_window'],
    'src/components/ruleBuilder/AdvancedTriggerEditor.tsx': ['leaderSequence', 'keySequence', 'keyChordSet', 'mouseGesture'],
    'src-tauri/tests/profile_schema_v6.rs': ['frontend_advanced_trigger_contract_round_trips_all_variants'],
}
for path, needles in checks.items():
    content = read(path)
    for needle in needles:
        if needle not in content:
            raise SystemExit(f'audit missing {needle!r} in {path}')

print('v0.4.0 compiler coverage + audit passed')
