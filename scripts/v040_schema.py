from pathlib import Path
import json


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


# Version metadata.
replace_once('package.json', '"version": "0.3.3"', '"version": "0.4.0"')
replace_once('src-tauri/Cargo.toml', 'version = "0.3.3"', 'version = "0.4.0"')
conf = json.loads(read('src-tauri/tauri.conf.json'))
conf['version'] = '0.4.0'
write('src-tauri/tauri.conf.json', json.dumps(conf, ensure_ascii=False, indent=2) + '\n')
replace_once('src/app/App.tsx', 'const PROFILE_SCHEMA_VERSION = 4', 'const PROFILE_SCHEMA_VERSION = 6')

# Persistence schema v5 -> v6 is marker-only: existing rule semantics stay untouched.
p = 'src-tauri/src/shared/persistence.rs'
replace_once(p, 'pub const PROFILE_SCHEMA_VERSION: u32 = 5;', 'pub const PROFILE_SCHEMA_VERSION: u32 = 6;')
replace_once(
    p,
    '''                object.insert("schemaVersion".to_string(), json!(5));
                version = 5;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),''',
    '''                object.insert("schemaVersion".to_string(), json!(5));
                version = 5;
            }
            5 => {
                // v5 -> v6: advanced-input trigger variants are additive. No existing
                // rule payload needs rewriting, so preserve every v5 rule byte-for-byte
                // apart from the schema marker.
                object.insert("schemaVersion".to_string(), json!(6));
                version = 6;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),'''
)

# Frontend Rust schema.
p = 'src-tauri/src/schemas/frontend.rs'
replace_once(
    p,
    '''pub enum MouseWheelDirection {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]''',
    '''pub enum MouseWheelDirection {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GestureDirection {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]'''
)
replace_once(
    p,
    '''    MouseMove {
        #[serde(default = "default_mouse_move_distance")]
        min_distance: u16,
        #[serde(default = "default_mouse_move_cooldown")]
        cooldown_ms: u32,
    },
    TapHoldKeyDown {''',
    '''    MouseMove {
        #[serde(default = "default_mouse_move_distance")]
        min_distance: u16,
        #[serde(default = "default_mouse_move_cooldown")]
        cooldown_ms: u32,
    },
    LeaderSequence {
        leader: KeyChord,
        #[serde(default)]
        sequence: Vec<u8>,
        #[serde(default = "default_advanced_timeout")]
        timeout_ms: u32,
    },
    KeySequence {
        #[serde(default)]
        sequence: Vec<u8>,
        #[serde(default = "default_advanced_timeout")]
        timeout_ms: u32,
    },
    KeyChordSet {
        #[serde(default)]
        codes: Vec<u8>,
        #[serde(default = "default_chord_skew")]
        max_skew_ms: u32,
    },
    MouseGesture {
        code: u8,
        #[serde(default)]
        directions: Vec<GestureDirection>,
        #[serde(default = "default_gesture_distance")]
        min_distance: u16,
    },
    TapHoldKeyDown {'''
)
replace_once(
    p,
    '''fn default_mouse_move_cooldown() -> u32 {
    120
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]''',
    '''fn default_mouse_move_cooldown() -> u32 {
    120
}

fn default_advanced_timeout() -> u32 {
    800
}

fn default_chord_skew() -> u32 {
    80
}

fn default_gesture_distance() -> u16 {
    28
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]'''
)

# Engine schema and compiled advanced rule records.
p = 'src-tauri/src/schemas/engine.rs'
replace_once(
    p,
    'use crate::schemas::frontend::{TextDateFormat, TextExpansionMode, TextTimeFormat};',
    'use crate::schemas::frontend::{GestureDirection, KeyChord, TextDateFormat, TextExpansionMode, TextTimeFormat};'
)
replace_once(
    p,
    '''    pub tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>>,
    pub text_expansion_rules: Vec<CompiledTextExpansionRule>,
}''',
    '''    pub tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>>,
    pub text_expansion_rules: Vec<CompiledTextExpansionRule>,
    pub leader_sequence_rules: Vec<CompiledLeaderSequenceRule>,
    pub key_sequence_rules: Vec<CompiledKeySequenceRule>,
    pub key_chord_set_rules: Vec<CompiledKeyChordSetRule>,
    pub mouse_gesture_rules: Vec<CompiledMouseGestureRule>,
}'''
)
replace_once(
    p,
    '''            tap_hold_map: HashMap::new(),
            text_expansion_rules: Vec::new(),
        }''',
    '''            tap_hold_map: HashMap::new(),
            text_expansion_rules: Vec::new(),
            leader_sequence_rules: Vec::new(),
            key_sequence_rules: Vec::new(),
            key_chord_set_rules: Vec::new(),
            mouse_gesture_rules: Vec::new(),
        }'''
)
replace_once(
    p,
    '''pub struct CompiledTextExpansionRule {
    pub sequence: String,
    pub mode: TextExpansionMode,
    pub delimiters: String,
    pub case_sensitive: bool,
    pub rule: CompiledRule,
}

#[derive(Debug, Clone)]
pub struct CompiledMouseMoveRule''',
    '''pub struct CompiledTextExpansionRule {
    pub sequence: String,
    pub mode: TextExpansionMode,
    pub delimiters: String,
    pub case_sensitive: bool,
    pub rule: CompiledRule,
}

#[derive(Debug, Clone)]
pub struct CompiledLeaderSequenceRule {
    pub rule_id_hash: u64,
    pub leader: KeyChord,
    pub sequence: Vec<u8>,
    pub timeout_ms: u32,
    pub rule: CompiledRule,
}

#[derive(Debug, Clone)]
pub struct CompiledKeySequenceRule {
    pub rule_id_hash: u64,
    pub sequence: Vec<u8>,
    pub timeout_ms: u32,
    pub rule: CompiledRule,
}

#[derive(Debug, Clone)]
pub struct CompiledKeyChordSetRule {
    pub rule_id_hash: u64,
    pub codes: Vec<u8>,
    pub max_skew_ms: u32,
    pub rule: CompiledRule,
}

#[derive(Debug, Clone)]
pub struct CompiledMouseGestureRule {
    pub rule_id_hash: u64,
    pub code: u8,
    pub directions: Vec<GestureDirection>,
    pub min_distance: u16,
    pub rule: CompiledRule,
}

#[derive(Debug, Clone)]
pub struct CompiledMouseMoveRule'''
)

# Compiler routes every new trigger into deterministic priority-sorted vectors.
p = 'src-tauri/src/daemon/compiler.rs'
replace_once(
    p,
    '''    CompiledMouseMoveRule, CompiledRule, CompiledTapHoldRule, CompiledTextExpansionRule,
    EngineAction, EngineCondition, EngineSchema, MacroPlaybackConfig, SimulatorCommand,
};''',
    '''    CompiledKeyChordSetRule, CompiledKeySequenceRule, CompiledLeaderSequenceRule,
    CompiledMouseGestureRule, CompiledMouseMoveRule, CompiledRule, CompiledTapHoldRule,
    CompiledTextExpansionRule, EngineAction, EngineCondition, EngineSchema, MacroPlaybackConfig,
    SimulatorCommand,
};'''
)
replace_once(
    p,
    '''    let mut tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>> = HashMap::new();
    let mut text_expansion_rules: Vec<CompiledTextExpansionRule> = Vec::new();''',
    '''    let mut tap_hold_map: HashMap<u8, Vec<CompiledTapHoldRule>> = HashMap::new();
    let mut text_expansion_rules: Vec<CompiledTextExpansionRule> = Vec::new();
    let mut leader_sequence_rules: Vec<CompiledLeaderSequenceRule> = Vec::new();
    let mut key_sequence_rules: Vec<CompiledKeySequenceRule> = Vec::new();
    let mut key_chord_set_rules: Vec<CompiledKeyChordSetRule> = Vec::new();
    let mut mouse_gesture_rules: Vec<CompiledMouseGestureRule> = Vec::new();'''
)
replace_once(
    p,
    '''            FrontendTrigger::TapHoldKeyDown { code, timeout_ms } => {''',
    '''            FrontendTrigger::LeaderSequence { leader, sequence, timeout_ms } => {
                let sequence: Vec<u8> = sequence.iter().copied().filter(|code| *code != 0).take(16).collect();
                if leader.code != 0 && !sequence.is_empty() {
                    leader_sequence_rules.push(CompiledLeaderSequenceRule {
                        rule_id_hash: calculate_hash(&rule.id),
                        leader: *leader,
                        sequence,
                        timeout_ms: (*timeout_ms).clamp(100, 10_000),
                        rule: compile_rule(rule, 0, true),
                    });
                }
            }
            FrontendTrigger::KeySequence { sequence, timeout_ms } => {
                let sequence: Vec<u8> = sequence.iter().copied().filter(|code| *code != 0).take(16).collect();
                if !sequence.is_empty() {
                    key_sequence_rules.push(CompiledKeySequenceRule {
                        rule_id_hash: calculate_hash(&rule.id),
                        sequence,
                        timeout_ms: (*timeout_ms).clamp(100, 10_000),
                        rule: compile_rule(rule, 0, true),
                    });
                }
            }
            FrontendTrigger::KeyChordSet { codes, max_skew_ms } => {
                let mut codes: Vec<u8> = codes.iter().copied().filter(|code| *code != 0).take(8).collect();
                codes.sort_unstable();
                codes.dedup();
                if codes.len() >= 2 {
                    key_chord_set_rules.push(CompiledKeyChordSetRule {
                        rule_id_hash: calculate_hash(&rule.id),
                        codes,
                        max_skew_ms: (*max_skew_ms).clamp(10, 1_000),
                        rule: compile_rule(rule, 0, true),
                    });
                }
            }
            FrontendTrigger::MouseGesture { code, directions, min_distance } => {
                let directions = directions.iter().copied().take(8).collect::<Vec<_>>();
                if *code != 0 && !directions.is_empty() {
                    mouse_gesture_rules.push(CompiledMouseGestureRule {
                        rule_id_hash: calculate_hash(&rule.id),
                        code: *code,
                        directions,
                        min_distance: (*min_distance).clamp(4, 500),
                        rule: compile_rule(rule, 0, true),
                    });
                }
            }
            FrontendTrigger::TapHoldKeyDown { code, timeout_ms } => {'''
)
replace_once(
    p,
    '''    text_expansion_rules.sort_by(|a, b| {
        b.rule
            .priority
            .cmp(&a.rule.priority)
            .then_with(|| b.sequence.chars().count().cmp(&a.sequence.chars().count()))
            .then_with(|| a.sequence.cmp(&b.sequence))
    });

    EngineSchema {''',
    '''    text_expansion_rules.sort_by(|a, b| {
        b.rule
            .priority
            .cmp(&a.rule.priority)
            .then_with(|| b.sequence.chars().count().cmp(&a.sequence.chars().count()))
            .then_with(|| a.sequence.cmp(&b.sequence))
    });
    leader_sequence_rules.sort_by(|a, b| b.rule.priority.cmp(&a.rule.priority).then_with(|| b.sequence.len().cmp(&a.sequence.len())));
    key_sequence_rules.sort_by(|a, b| b.rule.priority.cmp(&a.rule.priority).then_with(|| b.sequence.len().cmp(&a.sequence.len())));
    key_chord_set_rules.sort_by(|a, b| b.rule.priority.cmp(&a.rule.priority).then_with(|| b.codes.len().cmp(&a.codes.len())));
    mouse_gesture_rules.sort_by(|a, b| b.rule.priority.cmp(&a.rule.priority).then_with(|| b.directions.len().cmp(&a.directions.len())));

    EngineSchema {'''
)
replace_once(
    p,
    '''        tap_hold_map,
        text_expansion_rules,
    }''',
    '''        tap_hold_map,
        text_expansion_rules,
        leader_sequence_rules,
        key_sequence_rules,
        key_chord_set_rules,
        mouse_gesture_rules,
    }'''
)

# Daemon owns one bounded advanced-input state object.
p = 'src-tauri/src/daemon/state.rs'
replace_once(
    p,
    '''    /// Bounded, memory-only text expansion buffer and single undo record.
    pub text_input: std::sync::Mutex<crate::daemon::text_expansion::TextInputState>,''',
    '''    /// Bounded, memory-only text expansion buffer and single undo record.
    pub text_input: std::sync::Mutex<crate::daemon::text_expansion::TextInputState>,
    /// Dedicated bounded state machine for leader/sequence/chord/gesture triggers.
    pub advanced_input: std::sync::Mutex<crate::daemon::input_state::AdvancedInputState>,'''
)
replace_once(
    p,
    '''            text_input: std::sync::Mutex::new(
                crate::daemon::text_expansion::TextInputState::default(),
            ),
            key_capture_active:''',
    '''            text_input: std::sync::Mutex::new(
                crate::daemon::text_expansion::TextInputState::default(),
            ),
            advanced_input: std::sync::Mutex::new(
                crate::daemon::input_state::AdvancedInputState::default(),
            ),
            key_capture_active:'''
)
# Same initializer appears in Default.
text = read(p)
needle = '''            text_input: std::sync::Mutex::new(
                crate::daemon::text_expansion::TextInputState::default(),
            ),
            key_capture_active:'''
if needle not in text:
    raise SystemExit('second state initializer anchor not found')
write(p, text.replace(needle, '''            text_input: std::sync::Mutex::new(
                crate::daemon::text_expansion::TextInputState::default(),
            ),
            advanced_input: std::sync::Mutex::new(
                crate::daemon::input_state::AdvancedInputState::default(),
            ),
            key_capture_active:''', 1))

p = 'src-tauri/src/daemon/mod.rs'
replace_once(p, 'pub mod hooks;\n', 'pub mod hooks;\npub mod input_state;\n')

# TypeScript mirror.
p = 'src/lib/types.ts'
replace_once(
    p,
    '''export type MouseWheelDirection = 'up' | 'down' | 'left' | 'right'
export type TextExpansionMode''',
    '''export type MouseWheelDirection = 'up' | 'down' | 'left' | 'right'
export type GestureDirection = 'up' | 'down' | 'left' | 'right'
export type TextExpansionMode'''
)
replace_once(
    p,
    '''  | { type: 'mouseMove'; minDistance: number; cooldownMs: number }
  | { type: 'tapHoldKeyDown'; code: number; timeoutMs: number }''',
    '''  | { type: 'mouseMove'; minDistance: number; cooldownMs: number }
  | { type: 'leaderSequence'; leader: KeyChord; sequence: number[]; timeoutMs: number }
  | { type: 'keySequence'; sequence: number[]; timeoutMs: number }
  | { type: 'keyChordSet'; codes: number[]; maxSkewMs: number }
  | { type: 'mouseGesture'; code: number; directions: GestureDirection[]; minDistance: number }
  | { type: 'tapHoldKeyDown'; code: number; timeoutMs: number }'''
)

print('v0.4.0 schema staging applied')
