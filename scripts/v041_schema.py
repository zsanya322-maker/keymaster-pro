from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:160]!r}')
    write(path, text.replace(old, new, 1))


# Version metadata.
replace_once('package.json', '"version": "0.4.0"', '"version": "0.4.1"')
replace_once('src-tauri/Cargo.toml', 'version = "0.4.0"', 'version = "0.4.1"')
replace_once('src-tauri/tauri.conf.json', '"version": "0.4.0"', '"version": "0.4.1"')

# ---------------- Frontend/Rust schema ----------------
p = 'src/lib/types.ts'
text = read(p)
text = text.replace(
'''  rules: FrontendRule[]
  layers: LayerMeta[]
  folders: RuleFolder[]''',
'''  rules: FrontendRule[]
  macros: MacroDefinition[]
  layers: LayerMeta[]
  folders: RuleFolder[]''',
1,
)
text = text.replace(
"  | { type: 'runMacro'; steps: MacroStep[]; playback: MacroPlayback }",
"  | { type: 'runMacro'; macroId: string; playback: MacroPlayback }",
1,
)
anchor = '''export interface MacroStep {
  action: MacroAction
  delayMs: number
}
'''
if anchor not in text:
    raise SystemExit('MacroStep anchor missing in src/lib/types.ts')
text = text.replace(anchor, anchor + '''\nexport interface MacroDefinition {
  id: Uuid
  name: string
  steps: MacroStep[]
}
''', 1)
write(p, text)

p = 'src-tauri/src/schemas/frontend.rs'
text = read(p)
text = text.replace(
'''pub struct FrontendConfig {
    pub rules: Vec<FrontendRule>,
    pub layers: Vec<LayerMeta>,''',
'''pub struct FrontendConfig {
    pub rules: Vec<FrontendRule>,
    pub macros: Vec<MacroDefinition>,
    pub layers: Vec<LayerMeta>,''',
1,
)
text = text.replace(
'''    RunMacro {
        steps: Vec<MacroStep>,
        #[serde(default)]
        playback: MacroPlayback,
    },''',
'''    RunMacro {
        #[serde(rename = "macroId")]
        macro_id: String,
        #[serde(default)]
        playback: MacroPlayback,
    },''',
1,
)
anchor = '''pub struct MacroStep {
    pub action: MacroAction,
    pub delay_ms: u32,
}
'''
if anchor not in text:
    raise SystemExit('MacroStep anchor missing in Rust frontend schema')
text = text.replace(anchor, anchor + '''\n#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub steps: Vec<MacroStep>,
}
''', 1)
write(p, text)

p = 'src-tauri/src/shared/types.rs'
text = read(p)
text = text.replace(
'use crate::schemas::frontend::{FrontendRule, LayerMeta, RuleFolder};',
'use crate::schemas::frontend::{FrontendRule, LayerMeta, MacroDefinition, RuleFolder};',
1,
)
text = text.replace(
'''    pub rules: Vec<FrontendRule>,
    pub layers: Vec<LayerMeta>,''',
'''    pub rules: Vec<FrontendRule>,
    #[serde(default)]
    pub macros: Vec<MacroDefinition>,
    pub layers: Vec<LayerMeta>,''',
1,
)
write(p, text)

# Frontend store always materializes macros so old daemon responses/dev fixtures remain safe.
p = 'src/store/profileStore.ts'
text = read(p)
text = text.replace(
'''profiles: res.profiles.map(profile => ({ ...profile, bindings: profile.bindings ?? [], order: profile.order ?? 0 })),''',
'''profiles: res.profiles.map(profile => ({ ...profile, bindings: profile.bindings ?? [], macros: profile.macros ?? [], order: profile.order ?? 0 })),''',
1,
)
text = text.replace(
'''        rules: [],
        layers: [],''',
'''        rules: [],
        macros: [],
        layers: [],''',
1,
)
write(p, text)

# Runtime compiler receives the macro library from the active profile.
p = 'src-tauri/src/daemon/profile_runtime.rs'
text = read(p)
text = text.replace(
'''        rules: profile.rules.clone(),
        layers: profile.layers.clone(),''',
'''        rules: profile.rules.clone(),
        macros: profile.macros.clone(),
        layers: profile.layers.clone(),''',
1,
)
write(p, text)

# Add macros to simple Profile/FrontendConfig literals across Rust sources/tests.
for path in list(Path('src-tauri/src').rglob('*.rs')) + list(Path('src-tauri/tests').rglob('*.rs')):
    text = path.read_text(encoding='utf-8')
    original = text
    # Profile literals: a simple rules field immediately followed by layers.
    text = re.sub(
        r'(?m)^(\s*)rules: ([^\n]+),\n(\s*)layers:',
        lambda m: f'{m.group(1)}rules: {m.group(2)},\n{m.group(1)}macros: vec![],\n{m.group(3)}layers:',
        text,
    )
    # FrontendConfig literals: layers immediately followed by tap_hold_timeout_ms.
    text = re.sub(
        r'(?m)^(\s*)layers: ([^\n]+),\n(\s*)tap_hold_timeout_ms:',
        lambda m: f'{m.group(1)}macros: vec![],\n{m.group(1)}layers: {m.group(2)},\n{m.group(3)}tap_hold_timeout_ms:',
        text,
    )
    if text != original:
        path.write_text(text, encoding='utf-8')

# ---------------- schema v6 -> v7 migration ----------------
p = 'src-tauri/src/shared/persistence.rs'
text = read(p)
text = text.replace('pub const PROFILE_SCHEMA_VERSION: u32 = 6;', 'pub const PROFILE_SCHEMA_VERSION: u32 = 7;', 1)
old = '''            5 => {
                // v5 -> v6: advanced-input trigger variants are additive. No existing
                // rule payload needs rewriting, so preserve every v5 rule byte-for-byte
                // apart from the schema marker.
                object.insert("schemaVersion".to_string(), json!(6));
                version = 6;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),'''
new = '''            5 => {
                // v5 -> v6: advanced-input trigger variants are additive. No existing
                // rule payload needs rewriting, so preserve every v5 rule byte-for-byte
                // apart from the schema marker.
                object.insert("schemaVersion".to_string(), json!(6));
                version = 6;
            }
            6 => {
                // v6 -> v7: macros become first-class profile objects. Every legacy
                // inline runMacro is migrated independently (no automatic deduplication),
                // then the rule stores only macroId + playback. Legacy WindowMatch is
                // normalized to ContextMatch(mode=any), preserving its OR semantics.
                let mut macros = object
                    .remove("macros")
                    .and_then(|value| value.as_array().cloned())
                    .unwrap_or_default();
                let mut generated_index = macros.len();

                if let Some(rules) = object.get_mut("rules").and_then(Value::as_array_mut) {
                    for rule in rules {
                        let Some(rule_obj) = rule.as_object_mut() else {
                            continue;
                        };
                        let rule_id = rule_obj
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("rule")
                            .to_string();
                        let rule_name = rule_obj
                            .get("name")
                            .and_then(Value::as_str)
                            .filter(|name| !name.trim().is_empty())
                            .unwrap_or("Макрос")
                            .to_string();

                        if let Some(conditions) = rule_obj
                            .get_mut("conditions")
                            .and_then(Value::as_array_mut)
                        {
                            for condition in conditions {
                                let Some(condition_obj) = condition.as_object_mut() else {
                                    continue;
                                };
                                if condition_obj.get("type").and_then(Value::as_str)
                                    == Some("windowMatch")
                                {
                                    let process = condition_obj.remove("process").unwrap_or(Value::Null);
                                    let title = condition_obj.remove("title").unwrap_or(Value::Null);
                                    *condition = json!({
                                        "type": "contextMatch",
                                        "process": process,
                                        "title": title,
                                        "mode": "any"
                                    });
                                }
                            }
                        }

                        for action_field in ["actions", "holdActions"] {
                            let Some(actions) = rule_obj
                                .get_mut(action_field)
                                .and_then(Value::as_array_mut)
                            else {
                                continue;
                            };
                            for (action_index, action) in actions.iter_mut().enumerate() {
                                let Some(action_obj) = action.as_object_mut() else {
                                    continue;
                                };
                                if action_obj.get("type").and_then(Value::as_str)
                                    != Some("runMacro")
                                {
                                    continue;
                                }
                                if action_obj.get("macroId").and_then(Value::as_str).is_some() {
                                    action_obj.remove("steps");
                                    continue;
                                }

                                generated_index += 1;
                                let macro_id = format!(
                                    "legacy-macro:{}:{}:{}:{}",
                                    rule_id, action_field, action_index, generated_index
                                );
                                let steps = action_obj.remove("steps").unwrap_or_else(|| json!([]));
                                action_obj.insert("macroId".to_string(), json!(macro_id));
                                macros.push(json!({
                                    "id": macro_id,
                                    "name": format!("{} — макрос {}", rule_name, generated_index),
                                    "steps": steps
                                }));
                            }
                        }
                    }
                }

                object.insert("macros".to_string(), Value::Array(macros));
                object.insert("schemaVersion".to_string(), json!(7));
                version = 7;
            }
            other => return Err(format!("Нет миграции для версии профиля {}", other)),'''
if old not in text:
    raise SystemExit('v6 persistence migration anchor missing')
text = text.replace(old, new, 1)
write(p, text)

# ---------------- compiler macro resolution ----------------
p = 'src-tauri/src/daemon/compiler.rs'
text = read(p)
text = text.replace(
'''    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger, MacroAction,
    MacroPlayback, MacroStep, MouseWheelDirection,''',
'''    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger, MacroAction,
    MacroDefinition, MacroPlayback, MacroStep, MouseWheelDirection,''',
1,
)
anchor = '''    let mut mouse_gesture_rules: Vec<CompiledMouseGestureRule> = Vec::new();

    for rule in frontend.rules.iter().filter(|rule| rule.enabled) {'''
if anchor not in text:
    raise SystemExit('compiler macro-library insertion anchor missing')
text = text.replace(anchor, '''    let mut mouse_gesture_rules: Vec<CompiledMouseGestureRule> = Vec::new();
    let macro_library: HashMap<&str, &MacroDefinition> = frontend
        .macros
        .iter()
        .map(|macro_def| (macro_def.id.as_str(), macro_def))
        .collect();

    for rule in frontend.rules.iter().filter(|rule| rule.enabled) {''', 1)
# Main call sites.
text = text.replace('compile_rule(rule, chord.modifiers, true)', 'compile_rule(rule, chord.modifiers, true, &macro_library)')
text = text.replace('compile_rule(rule, chord.modifiers, false)', 'compile_rule(rule, chord.modifiers, false, &macro_library)')
text = text.replace('compile_rule(rule, 0, true)', 'compile_rule(rule, 0, true, &macro_library)')
text = text.replace('compile_rule(rule, 0, false)', 'compile_rule(rule, 0, false, &macro_library)')
text = text.replace(
'compile_mouse_move_rule(rule, *min_distance, *cooldown_ms)',
'compile_mouse_move_rule(rule, *min_distance, *cooldown_ms, &macro_library)',
)
text = text.replace(
'compile_tap_hold_rule(rule, *timeout_ms)',
'compile_tap_hold_rule(rule, *timeout_ms, &macro_library)',
)
# Signatures/body forwarding.
text = text.replace(
'''fn compile_rule(
    rule: &FrontendRule,
    required_modifiers: u16,
    trigger_on_down: bool,
) -> CompiledRule {''',
'''fn compile_rule(
    rule: &FrontendRule,
    required_modifiers: u16,
    trigger_on_down: bool,
    macro_library: &HashMap<&str, &MacroDefinition>,
) -> CompiledRule {''',
1,
)
text = text.replace(
'''compile_action(action, macro_action_key(&rule.id, false, index)))''',
'''compile_action(
            action,
            macro_action_key(&rule.id, false, index),
            macro_library,
        ))''',
1,
)
text = text.replace(
'''fn compile_mouse_move_rule(
    rule: &FrontendRule,
    min_distance: u16,
    cooldown_ms: u32,
) -> CompiledMouseMoveRule {''',
'''fn compile_mouse_move_rule(
    rule: &FrontendRule,
    min_distance: u16,
    cooldown_ms: u32,
    macro_library: &HashMap<&str, &MacroDefinition>,
) -> CompiledMouseMoveRule {''',
1,
)
text = text.replace(
'''.map(|(index, action)| compile_action(action, macro_action_key(&rule.id, false, index)))''',
'''.map(|(index, action)| {
                compile_action(
                    action,
                    macro_action_key(&rule.id, false, index),
                    macro_library,
                )
            })''',
1,
)
text = text.replace(
'''fn compile_tap_hold_rule(rule: &FrontendRule, timeout_ms: u32) -> CompiledTapHoldRule {''',
'''fn compile_tap_hold_rule(
    rule: &FrontendRule,
    timeout_ms: u32,
    macro_library: &HashMap<&str, &MacroDefinition>,
) -> CompiledTapHoldRule {''',
1,
)
# tap + hold compile_action call sites left in this function.
text = text.replace(
'''.map(|(index, action)| compile_action(action, macro_action_key(&rule.id, false, index)))''',
'''.map(|(index, action)| {
            compile_action(
                action,
                macro_action_key(&rule.id, false, index),
                macro_library,
            )
        })''',
1,
)
text = text.replace(
'''compile_action(action, macro_action_key(&rule.id, true, index))''',
'''compile_action(
                        action,
                        macro_action_key(&rule.id, true, index),
                        macro_library,
                    )''',
1,
)
text = text.replace(
'''fn compile_action(action: &FrontendAction, macro_key: u64) -> EngineAction {''',
'''fn compile_action(
    action: &FrontendAction,
    macro_key: u64,
    macro_library: &HashMap<&str, &MacroDefinition>,
) -> EngineAction {''',
1,
)
old_arm = '''        FrontendAction::RunMacro { steps, playback } => EngineAction::MacroCommands {
            commands: compile_macro_commands(steps),
            playback: compile_macro_playback(playback),
            macro_key,
        },'''
new_arm = '''        FrontendAction::RunMacro { macro_id, playback } => EngineAction::MacroCommands {
            commands: macro_library
                .get(macro_id.as_str())
                .map(|macro_def| compile_macro_commands(&macro_def.steps))
                .unwrap_or_default(),
            playback: compile_macro_playback(playback),
            macro_key,
        },'''
if old_arm not in text:
    raise SystemExit('old inline RunMacro compiler arm missing')
text = text.replace(old_arm, new_arm, 1)
write(p, text)

# Update stale current-schema assertions; source fixture versions remain untouched.
for path in Path('src-tauri/tests').glob('profile_schema_v*.rs'):
    text = path.read_text(encoding='utf-8')
    text = text.replace('assert_eq!(PROFILE_SCHEMA_VERSION, 6);', 'assert_eq!(PROFILE_SCHEMA_VERSION, 7);')
    text = text.replace('assert_eq!(exported["schemaVersion"], 6);', 'assert_eq!(exported["schemaVersion"], 7);')
    path.write_text(text, encoding='utf-8')

# Dedicated v7 migration/roundtrip/independence coverage.
Path('src-tauri/tests/profile_schema_v7.rs').write_text(r'''use keymaster_pro_lib::schemas::frontend::FrontendAction;
use keymaster_pro_lib::shared::persistence::{
    PROFILE_SCHEMA_VERSION, export_profile_value, import_profile_value,
};
use serde_json::json;

fn macro_steps(code: u8) -> serde_json::Value {
    json!([{ "action": { "type": "keyDown", "code": code }, "delayMs": 10 }])
}

#[test]
fn v6_inline_macros_migrate_independently_to_named_library_objects() {
    let source = json!({
        "schemaVersion": 6,
        "id": "macro-v7", "name": "Macro V7", "isDefault": false,
        "linkedApps": [], "bindings": [], "order": 0, "layers": [], "folders": [],
        "rules": [{
            "id": "rule-a", "name": "CRM ответ", "priority": 0, "enabled": true,
            "folderId": null, "order": 0,
            "trigger": { "type": "keyDown", "code": 65, "modifiers": 1 },
            "conditions": [{ "type": "windowMatch", "process": "crm.exe", "title": "CRM" }],
            "actions": [
                { "type": "runMacro", "steps": macro_steps(66), "playback": { "speed": 1.0, "repeatCount": 1, "repeatWhileHeld": false } },
                { "type": "runMacro", "steps": macro_steps(66), "playback": { "speed": 2.0, "repeatCount": 2, "repeatWhileHeld": false } }
            ],
            "holdActions": null
        }]
    });

    let profile = import_profile_value(source).expect("v6 profile migrates");
    assert_eq!(PROFILE_SCHEMA_VERSION, 7);
    assert_eq!(profile.macros.len(), 2, "identical legacy macros must stay independent");
    assert_ne!(profile.macros[0].id, profile.macros[1].id);
    assert_eq!(profile.macros[0].steps.len(), 1);

    let FrontendAction::RunMacro { macro_id: first_id, .. } = &profile.rules[0].actions[0] else {
        panic!("first action should be library macro");
    };
    let FrontendAction::RunMacro { macro_id: second_id, .. } = &profile.rules[0].actions[1] else {
        panic!("second action should be library macro");
    };
    assert_eq!(first_id, &profile.macros[0].id);
    assert_eq!(second_id, &profile.macros[1].id);

    let exported = export_profile_value(&profile).unwrap();
    assert_eq!(exported["schemaVersion"], 7);
    assert!(exported["rules"][0]["actions"][0].get("steps").is_none());
    assert!(exported["rules"][0]["actions"][0]["macroId"].is_string());
    assert_eq!(exported["macros"].as_array().unwrap().len(), 2);

    let condition = &exported["rules"][0]["conditions"][0];
    assert_eq!(condition["type"], "contextMatch");
    assert_eq!(condition["mode"], "any");
    assert_eq!(condition["process"], "crm.exe");
    assert_eq!(condition["title"], "CRM");
}

#[test]
fn v7_macro_reference_round_trips_without_inline_steps() {
    let source = json!({
        "schemaVersion": 7,
        "id": "native-v7", "name": "Native", "isDefault": false,
        "linkedApps": [], "bindings": [], "order": 0, "layers": [], "folders": [],
        "macros": [{ "id": "m1", "name": "Ответ", "steps": macro_steps(70) }],
        "rules": [{
            "id": "r1", "name": "Run", "priority": 0, "enabled": true,
            "folderId": null, "order": 0,
            "trigger": { "type": "keyDown", "code": 71, "modifiers": 0 },
            "conditions": [], "holdActions": null,
            "actions": [{
                "type": "runMacro", "macroId": "m1",
                "playback": { "speed": 1.25, "repeatCount": 3, "repeatWhileHeld": false }
            }]
        }]
    });
    let profile = import_profile_value(source).expect("native v7 parses");
    let exported = export_profile_value(&profile).unwrap();
    assert_eq!(exported["rules"][0]["actions"][0]["macroId"], "m1");
    assert!(exported["rules"][0]["actions"][0].get("steps").is_none());
    assert_eq!(exported["macros"][0]["name"], "Ответ");
}
''', encoding='utf-8')

print('v0.4.1 schema/migration/compiler staging applied')
