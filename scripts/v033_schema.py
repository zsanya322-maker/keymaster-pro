from pathlib import Path
import json
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str, label: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    write(path, text.replace(old, new, 1))

# ---------------------------------------------------------------------------
# Frontend Rust schema: backward-compatible typed-text trigger + explicit
# per-TypeText date/time formatting. Legacy JSON defaults reproduce v0.3.2.
# ---------------------------------------------------------------------------
p = 'src-tauri/src/schemas/frontend.rs'
s = read(p)
anchor = '''#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrontendTrigger {'''
insert = '''#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TextExpansionMode {
    #[default]
    Instant,
    Delimiter,
}

fn default_text_delimiters() -> String {
    " \\t\\n.,;:!?".to_string()
}

fn default_case_sensitive() -> bool {
    // v0.3.2 used String::ends_with, so legacy rules were case-sensitive.
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TextDateFormat {
    #[default]
    Dmy,
    Ymd,
    Mdy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TextTimeFormat {
    #[default]
    Hm24,
    Hms24,
    Hm12,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrontendTrigger {'''
if anchor not in s:
    raise SystemExit('frontend trigger enum anchor missing')
s = s.replace(anchor, insert, 1)
s = s.replace(
    '    TypedText { sequence: String },',
    '''    TypedText {
        sequence: String,
        #[serde(default)]
        mode: TextExpansionMode,
        #[serde(default = "default_text_delimiters")]
        delimiters: String,
        #[serde(default = "default_case_sensitive")]
        case_sensitive: bool,
    },''',
    1,
)
s = s.replace(
    '    TypeText { text: String },',
    '''    TypeText {
        text: String,
        #[serde(default)]
        date_format: TextDateFormat,
        #[serde(default)]
        time_format: TextTimeFormat,
    },''',
    1,
)
write(p, s)

# Patch Rust constructor expressions in tests/fixtures without touching match
# patterns. Fully-qualified enums avoid import churn.
for path in Path('src-tauri').rglob('*.rs'):
    if path.as_posix().endswith('schemas/frontend.rs'):
        continue
    text = path.read_text(encoding='utf-8')
    text = re.sub(
        r'FrontendTrigger::TypedText\s*\{\s*sequence:\s*([^,\n}]+),?\s*\}',
        r'''FrontendTrigger::TypedText { sequence: \1, mode: crate::schemas::frontend::TextExpansionMode::Instant, delimiters: " \\t\\n.,;:!?".into(), case_sensitive: true }''',
        text,
    )
    text = re.sub(
        r'FrontendAction::TypeText\s*\{\s*text:\s*([^,\n}]+),?\s*\}',
        r'''FrontendAction::TypeText { text: \1, date_format: crate::schemas::frontend::TextDateFormat::Dmy, time_format: crate::schemas::frontend::TextTimeFormat::Hm24 }''',
        text,
    )
    path.write_text(text, encoding='utf-8')

# ---------------------------------------------------------------------------
# Engine schema: text rules are a deterministic ordered list, not a HashMap.
# ---------------------------------------------------------------------------
p = 'src-tauri/src/schemas/engine.rs'
s = read(p)
s = s.replace(
    'use crate::shared::types::MatchMode;',
    'use crate::shared::types::MatchMode;\nuse crate::schemas::frontend::{TextDateFormat, TextExpansionMode, TextTimeFormat};',
    1,
)
s = s.replace(
    '    pub text_expansion_map: HashMap<String, Vec<CompiledRule>>,',
    '    pub text_expansion_rules: Vec<CompiledTextExpansionRule>,',
    1,
)
s = s.replace(
    '            text_expansion_map: HashMap::new(),',
    '            text_expansion_rules: Vec::new(),',
    1,
)
compiled_anchor = '''#[derive(Debug, Clone)]
pub struct CompiledMouseMoveRule {'''
compiled_insert = '''#[derive(Debug, Clone)]
pub struct CompiledTextExpansionRule {
    pub sequence: String,
    pub mode: TextExpansionMode,
    pub delimiters: String,
    pub case_sensitive: bool,
    pub rule: CompiledRule,
}

#[derive(Debug, Clone)]
pub struct CompiledMouseMoveRule {'''
if compiled_anchor not in s:
    raise SystemExit('compiled text rule anchor missing')
s = s.replace(compiled_anchor, compiled_insert, 1)
s = s.replace(
    '    TypeText { text: String },',
    '''    TypeText {
        text: String,
        date_format: TextDateFormat,
        time_format: TextTimeFormat,
    },''',
    1,
)
write(p, s)

# EngineAction constructor expressions in unit tests.
for path in Path('src-tauri').rglob('*.rs'):
    if path.as_posix().endswith('schemas/engine.rs'):
        continue
    text = path.read_text(encoding='utf-8')
    text = re.sub(
        r'EngineAction::TypeText\s*\{\s*text:\s*([^,\n}]+),?\s*\}',
        r'''EngineAction::TypeText { text: \1, date_format: crate::schemas::frontend::TextDateFormat::Dmy, time_format: crate::schemas::frontend::TextTimeFormat::Hm24 }''',
        text,
    )
    path.write_text(text, encoding='utf-8')

# ---------------------------------------------------------------------------
# Compiler: preserve trigger options and deterministic priority/longest suffix.
# ---------------------------------------------------------------------------
p = 'src-tauri/src/daemon/compiler.rs'
s = read(p)
s = s.replace(
    '    CompiledMouseMoveRule, CompiledRule, CompiledTapHoldRule, EngineAction, EngineCondition,',
    '    CompiledMouseMoveRule, CompiledRule, CompiledTapHoldRule, CompiledTextExpansionRule, EngineAction, EngineCondition,',
    1,
)
s = s.replace(
    '    let mut text_expansion_map: HashMap<String, Vec<CompiledRule>> = HashMap::new();',
    '    let mut text_expansion_rules: Vec<CompiledTextExpansionRule> = Vec::new();',
    1,
)
old = '''            FrontendTrigger::TypedText { sequence } => {
                text_expansion_map
                    .entry(sequence.clone())
                    .or_default()
                    .push(compile_rule(rule, 0, true));
            }'''
new = '''            FrontendTrigger::TypedText { sequence, mode, delimiters, case_sensitive } => {
                if !sequence.is_empty() {
                    text_expansion_rules.push(CompiledTextExpansionRule {
                        sequence: sequence.clone(),
                        mode: *mode,
                        delimiters: delimiters.clone(),
                        case_sensitive: *case_sensitive,
                        rule: compile_rule(rule, 0, true),
                    });
                }
            }'''
if old not in s:
    raise SystemExit('compiler TypedText match anchor missing')
s = s.replace(old, new, 1)
s = s.replace(
    '''    for rules in text_expansion_map.values_mut() {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
''',
    '''    text_expansion_rules.sort_by(|a, b| {
        b.rule.priority
            .cmp(&a.rule.priority)
            .then_with(|| b.sequence.chars().count().cmp(&a.sequence.chars().count()))
            .then_with(|| a.sequence.cmp(&b.sequence))
    });
''',
    1,
)
s = s.replace('        text_expansion_map,\n', '        text_expansion_rules,\n', 1)
s = s.replace(
    '        FrontendAction::TypeText { text } => EngineAction::TypeText { text: text.clone() },',
    '''        FrontendAction::TypeText { text, date_format, time_format } => EngineAction::TypeText {
            text: text.clone(),
            date_format: *date_format,
            time_format: *time_format,
        },''',
    1,
)
write(p, s)

# ---------------------------------------------------------------------------
# Runtime state + window identity for focus-change reset.
# ---------------------------------------------------------------------------
p = 'src-tauri/src/context.rs'
s = read(p)
s = s.replace(
    '    /// Monotonic foreground-context revision. Layer changes do not increment it.\n    pub revision: u64,',
    '    /// Monotonic foreground-context revision. Layer changes do not increment it.\n    pub revision: u64,\n    /// Opaque HWND identity used only for in-memory input lifecycle resets.\n    pub active_window_id: isize,',
    1,
)
write(p, s)

p = 'src-tauri/src/trackers/context_tracker.rs'
s = read(p)
s = s.replace(
    '            state.revision = state.revision.wrapping_add(1);\n            state.active_process = process;',
    '            state.revision = state.revision.wrapping_add(1);\n            state.active_window_id = hwnd.0 as isize;\n            state.active_process = process;',
    1,
)
write(p, s)

p = 'src-tauri/src/daemon/mod.rs'
s = read(p)
if 'pub mod text_expansion;' not in s:
    s += '\npub mod text_expansion;\n'
write(p, s)

p = 'src-tauri/src/daemon/state.rs'
s = read(p)
s = s.replace(
    '    /// Buffer for tracking rolling text inputs for text expansion\n    pub typed_buffer: std::sync::Mutex<String>,',
    '    /// Bounded, memory-only text expansion buffer and single undo record.\n    pub text_input: std::sync::Mutex<crate::daemon::text_expansion::TextInputState>,',
    1,
)
s = s.replace(
    '            typed_buffer: std::sync::Mutex::new(String::new()),',
    '            text_input: std::sync::Mutex::new(crate::daemon::text_expansion::TextInputState::default()),',
)
write(p, s)

# ---------------------------------------------------------------------------
# Profile schema v5 migration: explicit typed-text defaults + text token formats.
# ---------------------------------------------------------------------------
p = 'src-tauri/src/shared/persistence.rs'
s = read(p)
s = s.replace('pub const PROFILE_SCHEMA_VERSION: u32 = 4;', 'pub const PROFILE_SCHEMA_VERSION: u32 = 5;', 1)
old = '''            3 => {
                // v3 -> v4: structured profile bindings/order while retaining linkedApps.
                object.entry("order".to_string()).or_insert(json!(0));
                if !object.contains_key("bindings") {
                    let bindings=object.get("linkedApps").and_then(Value::as_array).map(|apps| apps.iter().filter_map(Value::as_str).map(|p|json!({"process":p,"mode":"any"})).collect::<Vec<_>>()).unwrap_or_default();
                    object.insert("bindings".to_string(),json!(bindings));
                }
                object.insert("schemaVersion".to_string(),json!(4)); version=4;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),'''
new = '''            3 => {
                // v3 -> v4: structured profile bindings/order while retaining linkedApps.
                object.entry("order".to_string()).or_insert(json!(0));
                if !object.contains_key("bindings") {
                    let bindings=object.get("linkedApps").and_then(Value::as_array).map(|apps| apps.iter().filter_map(Value::as_str).map(|p|json!({"process":p,"mode":"any"})).collect::<Vec<_>>()).unwrap_or_default();
                    object.insert("bindings".to_string(),json!(bindings));
                }
                object.insert("schemaVersion".to_string(),json!(4)); version=4;
            }
            4 => {
                // v4 -> v5: explicit text-expansion behavior. `instant` +
                // caseSensitive=true reproduces the legacy String::ends_with matcher.
                if let Some(rules) = object.get_mut("rules").and_then(Value::as_array_mut) {
                    for rule in rules {
                        let Some(rule_obj) = rule.as_object_mut() else { continue; };
                        if let Some(trigger) = rule_obj.get_mut("trigger").and_then(Value::as_object_mut) {
                            if trigger.get("type").and_then(Value::as_str) == Some("typedText") {
                                trigger.entry("mode".to_string()).or_insert(json!("instant"));
                                trigger.entry("delimiters".to_string()).or_insert(json!(" \\t\\n.,;:!?"));
                                trigger.entry("caseSensitive".to_string()).or_insert(json!(true));
                            }
                        }
                        for action_field in ["actions", "holdActions"] {
                            let Some(actions) = rule_obj.get_mut(action_field).and_then(Value::as_array_mut) else { continue; };
                            for action in actions {
                                let Some(action_obj) = action.as_object_mut() else { continue; };
                                if action_obj.get("type").and_then(Value::as_str) == Some("typeText") {
                                    action_obj.entry("dateFormat".to_string()).or_insert(json!("dmy"));
                                    action_obj.entry("timeFormat".to_string()).or_insert(json!("hm24"));
                                }
                            }
                        }
                    }
                }
                object.insert("schemaVersion".to_string(), json!(5));
                version = 5;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),'''
if old not in s:
    raise SystemExit('persistence v3/v4 anchor missing')
s = s.replace(old, new, 1)
write(p, s)

# Existing integration tests should now expect the newest canonical schema.
for path in Path('src-tauri/tests').glob('*.rs'):
    text = path.read_text(encoding='utf-8')
    text = text.replace('assert_eq!(PROFILE_SCHEMA_VERSION, 4);', 'assert_eq!(PROFILE_SCHEMA_VERSION, 5);')
    text = text.replace('exported["schemaVersion"], 4', 'exported["schemaVersion"], 5')
    path.write_text(text, encoding='utf-8')

write('src-tauri/tests/profile_schema_v5.rs', r'''use keymaster_pro_lib::schemas::frontend::{FrontendAction, FrontendTrigger, TextDateFormat, TextExpansionMode, TextTimeFormat};
use keymaster_pro_lib::shared::persistence::{export_profile_value, import_profile_value, PROFILE_SCHEMA_VERSION};
use serde_json::json;

#[test]
fn v4_typed_text_migrates_without_behavior_change() {
    let legacy = json!({
        "schemaVersion": 4,
        "id": "legacy-text-v4", "name": "Legacy text", "isDefault": false,
        "linkedApps": [], "bindings": [], "order": 0, "layers": [], "folders": [],
        "rules": [{
            "id": "text-rule", "name": "Legacy", "priority": 0, "enabled": true,
            "folderId": null, "order": 0, "holdActions": null, "conditions": [],
            "trigger": { "type": "typedText", "sequence": ";Mail" },
            "actions": [{ "type": "typeText", "text": "hello" }]
        }]
    });
    let profile = import_profile_value(legacy).expect("v4 text profile migrates");
    assert_eq!(PROFILE_SCHEMA_VERSION, 5);
    match &profile.rules[0].trigger {
        FrontendTrigger::TypedText { sequence, mode, case_sensitive, .. } => {
            assert_eq!(sequence, ";Mail");
            assert_eq!(*mode, TextExpansionMode::Instant);
            assert!(*case_sensitive);
        }
        other => panic!("unexpected trigger: {other:?}"),
    }
    match &profile.rules[0].actions[0] {
        FrontendAction::TypeText { text, date_format, time_format } => {
            assert_eq!(text, "hello");
            assert_eq!(*date_format, TextDateFormat::Dmy);
            assert_eq!(*time_format, TextTimeFormat::Hm24);
        }
        other => panic!("unexpected action: {other:?}"),
    }
    let exported = export_profile_value(&profile).unwrap();
    assert_eq!(exported["schemaVersion"], 5);
    assert_eq!(exported["rules"][0]["trigger"]["mode"], "instant");
    assert_eq!(exported["rules"][0]["trigger"]["caseSensitive"], true);
}
''')

# ---------------------------------------------------------------------------
# TypeScript mirror and version metadata.
# ---------------------------------------------------------------------------
p = 'src/lib/types.ts'
s = read(p)
s = s.replace(
    "export type MouseWheelDirection = 'up' | 'down' | 'left' | 'right'",
    "export type MouseWheelDirection = 'up' | 'down' | 'left' | 'right'\nexport type TextExpansionMode = 'instant' | 'delimiter'\nexport type TextDateFormat = 'dmy' | 'ymd' | 'mdy'\nexport type TextTimeFormat = 'hm24' | 'hms24' | 'hm12'",
    1,
)
s = s.replace(
    "  | { type: 'typedText'; sequence: string }",
    "  | { type: 'typedText'; sequence: string; mode: TextExpansionMode; delimiters: string; caseSensitive: boolean }",
    1,
)
s = s.replace(
    "  | { type: 'typeText'; text: string }",
    "  | { type: 'typeText'; text: string; dateFormat: TextDateFormat; timeFormat: TextTimeFormat }",
    1,
)
write(p, s)

# Canonical frontend export schema marker.
for path in Path('src').rglob('*.tsx'):
    text = path.read_text(encoding='utf-8').replace('schemaVersion: 4', 'schemaVersion: 5')
    path.write_text(text, encoding='utf-8')

# Versions.
for path in ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json']:
    text = read(path).replace('0.3.2', '0.3.3')
    write(path, text)

# Use the documented CF_UNICODETEXT constant instead of a magic clipboard id.
p = 'src-tauri/Cargo.toml'
s = read(p)
if '"Win32_System_Ole"' not in s:
    s = s.replace('  "Win32_System_DataExchange",', '  "Win32_System_DataExchange",\n  "Win32_System_Ole",', 1)
write(p, s)

print('v0.3.3 schema v5 staged')
