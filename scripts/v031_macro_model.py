from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one marker, got {count}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# TypeScript persisted model.
replace_once(
    'src/lib/types.ts',
    "export type FrontendAction =\n",
    "export interface MacroPlayback {\n  speed: number\n  repeatCount: number\n  repeatWhileHeld: boolean\n}\n\nexport type FrontendAction =\n",
)
replace_once(
    'src/lib/types.ts',
    "  | { type: 'runMacro'; steps: MacroStep[] }\n",
    "  | { type: 'runMacro'; steps: MacroStep[]; playback: MacroPlayback }\n",
)

# Rust persisted model + defaults.
replace_once(
    'src-tauri/src/schemas/frontend.rs',
    '''#[derive(Debug, Clone, Serialize, Deserialize)]\n#[serde(tag = "type", rename_all = "camelCase")]\npub enum FrontendAction {\n''',
    '''#[derive(Debug, Clone, Copy, Serialize, Deserialize)]\n#[serde(rename_all = "camelCase", default)]\npub struct MacroPlayback {\n    pub speed: f32,\n    pub repeat_count: u32,\n    pub repeat_while_held: bool,\n}\n\nimpl Default for MacroPlayback {\n    fn default() -> Self {\n        Self {\n            speed: 1.0,\n            repeat_count: 1,\n            repeat_while_held: false,\n        }\n    }\n}\n\n#[derive(Debug, Clone, Serialize, Deserialize)]\n#[serde(tag = "type", rename_all = "camelCase")]\npub enum FrontendAction {\n''',
)
replace_once(
    'src-tauri/src/schemas/frontend.rs',
    '    RunMacro { steps: Vec<MacroStep> },\n',
    '    RunMacro { steps: Vec<MacroStep>, #[serde(default)] playback: MacroPlayback },\n',
)

# Runtime playback model.
replace_once(
    'src-tauri/src/schemas/engine.rs',
    '''#[derive(Debug, Clone, PartialEq)]\npub enum SimulatorCommand {\n''',
    '''#[derive(Debug, Clone, Copy, PartialEq)]\npub struct MacroPlaybackConfig {\n    pub speed: f32,\n    pub repeat_count: u32,\n    pub repeat_while_held: bool,\n}\n\nimpl Default for MacroPlaybackConfig {\n    fn default() -> Self {\n        Self {\n            speed: 1.0,\n            repeat_count: 1,\n            repeat_while_held: false,\n        }\n    }\n}\n\nimpl MacroPlaybackConfig {\n    pub fn normalized(self) -> Self {\n        Self {\n            speed: if self.speed.is_finite() { self.speed.clamp(0.1, 10.0) } else { 1.0 },\n            repeat_count: self.repeat_count.clamp(1, 10_000),\n            repeat_while_held: self.repeat_while_held,\n        }\n    }\n}\n\n#[derive(Debug, Clone, PartialEq)]\npub enum SimulatorCommand {\n''',
)
replace_once(
    'src-tauri/src/schemas/engine.rs',
    '    MacroCommands { commands: Vec<SimulatorCommand> },\n',
    '''    MacroCommands {\n        commands: Vec<SimulatorCommand>,\n        playback: MacroPlaybackConfig,\n        macro_key: u64,\n    },\n''',
)

# Compiler: stable per-action macro keys and public preview helpers.
p = Path('src-tauri/src/daemon/compiler.rs')
s = p.read_text(encoding='utf-8')
s = s.replace(
    '    CompiledMouseMoveRule, CompiledRule, CompiledTapHoldRule, EngineAction, EngineCondition,\n    EngineSchema, SimulatorCommand,\n',
    '    CompiledMouseMoveRule, CompiledRule, CompiledTapHoldRule, EngineAction, EngineCondition,\n    EngineSchema, MacroPlaybackConfig, SimulatorCommand,\n',
    1,
)
s = s.replace(
    '    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger,\n    MacroAction, MouseWheelDirection,\n',
    '    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger,\n    MacroAction, MacroPlayback, MacroStep, MouseWheelDirection,\n',
    1,
)
s = s.replace(
    '    let actions = rule.actions.iter().map(compile_action).collect();\n',
    '''    let actions = rule\n        .actions\n        .iter()\n        .enumerate()\n        .map(|(index, action)| compile_action(action, macro_action_key(&rule.id, false, index)))\n        .collect();\n''',
    1,
)
s = s.replace(
    '    let tap_actions = rule.actions.iter().map(compile_action).collect();\n    let hold_actions = rule\n        .hold_actions\n        .as_ref()\n        .map(|actions| actions.iter().map(compile_action).collect())\n        .unwrap_or_default();\n',
    '''    let tap_actions = rule\n        .actions\n        .iter()\n        .enumerate()\n        .map(|(index, action)| compile_action(action, macro_action_key(&rule.id, false, index)))\n        .collect();\n    let hold_actions = rule\n        .hold_actions\n        .as_ref()\n        .map(|actions| {\n            actions\n                .iter()\n                .enumerate()\n                .map(|(index, action)| compile_action(action, macro_action_key(&rule.id, true, index)))\n                .collect()\n        })\n        .unwrap_or_default();\n''',
    1,
)
old_start = 'fn compile_action(action: &FrontendAction) -> EngineAction {\n'
if old_start not in s:
    raise RuntimeError('compiler compile_action signature not found')
s = s.replace(
    old_start,
    '''fn macro_action_key(rule_id: &str, hold: bool, index: usize) -> u64 {\n    calculate_hash(&format!("{}:{}:{}", rule_id, if hold { "hold" } else { "tap" }, index))\n}\n\npub fn compile_macro_playback(playback: &MacroPlayback) -> MacroPlaybackConfig {\n    MacroPlaybackConfig {\n        speed: playback.speed,\n        repeat_count: playback.repeat_count,\n        repeat_while_held: playback.repeat_while_held,\n    }\n    .normalized()\n}\n\npub fn compile_macro_commands(steps: &[MacroStep]) -> Vec<SimulatorCommand> {\n    let mut commands = Vec::new();\n    for step in steps {\n        match step.action {\n            MacroAction::KeyDown { code } => commands.push(SimulatorCommand::PressKey(code)),\n            MacroAction::KeyUp { code } => commands.push(SimulatorCommand::ReleaseKey(code)),\n            MacroAction::MouseDown { code } => commands.push(SimulatorCommand::MousePress(code)),\n            MacroAction::MouseUp { code } => commands.push(SimulatorCommand::MouseRelease(code)),\n            MacroAction::MouseMove { dx, dy } => commands.push(SimulatorCommand::MouseMove { dx, dy }),\n            MacroAction::MouseScroll { delta } => commands.push(SimulatorCommand::MouseScroll { delta }),\n            MacroAction::MouseHScroll { delta } => commands.push(SimulatorCommand::MouseHScroll { delta }),\n            MacroAction::MouseToAbsolute { x, y } => commands.push(SimulatorCommand::MouseAbsolute { x, y }),\n        }\n        if step.delay_ms > 0 {\n            commands.push(SimulatorCommand::Delay(step.delay_ms));\n        }\n    }\n    commands\n}\n\nfn compile_action(action: &FrontendAction, macro_key: u64) -> EngineAction {\n''',
    1,
)
old_macro = '''        FrontendAction::RunMacro { steps } => {\n            let mut commands = Vec::new();\n            for step in steps {\n                match step.action {\n                    MacroAction::KeyDown { code } => commands.push(SimulatorCommand::PressKey(code)),\n                    MacroAction::KeyUp { code } => commands.push(SimulatorCommand::ReleaseKey(code)),\n                    MacroAction::MouseDown { code } => commands.push(SimulatorCommand::MousePress(code)),\n                    MacroAction::MouseUp { code } => commands.push(SimulatorCommand::MouseRelease(code)),\n                    MacroAction::MouseMove { dx, dy } => {\n                        commands.push(SimulatorCommand::MouseMove { dx, dy })\n                    }\n                    MacroAction::MouseScroll { delta } => {\n                        commands.push(SimulatorCommand::MouseScroll { delta })\n                    }\n                    MacroAction::MouseHScroll { delta } => {\n                        commands.push(SimulatorCommand::MouseHScroll { delta })\n                    }\n                    MacroAction::MouseToAbsolute { x, y } => {\n                        commands.push(SimulatorCommand::MouseAbsolute { x, y })\n                    }\n                }\n                if step.delay_ms > 0 {\n                    commands.push(SimulatorCommand::Delay(step.delay_ms));\n                }\n            }\n            EngineAction::MacroCommands { commands }\n        }\n'''
new_macro = '''        FrontendAction::RunMacro { steps, playback } => EngineAction::MacroCommands {\n            commands: compile_macro_commands(steps),\n            playback: compile_macro_playback(playback),\n            macro_key,\n        },\n'''
if old_macro not in s:
    raise RuntimeError('compiler RunMacro block not found')
s = s.replace(old_macro, new_macro, 1)
p.write_text(s, encoding='utf-8')

# Profile schema v3 migration adds explicit playback defaults to every macro action.
p = Path('src-tauri/src/shared/persistence.rs')
s = p.read_text(encoding='utf-8')
s = s.replace('pub const PROFILE_SCHEMA_VERSION: u32 = 2;', 'pub const PROFILE_SCHEMA_VERSION: u32 = 3;', 1)
marker = '''                object.insert("schemaVersion".to_string(), json!(2));\n                version = 2;\n            }\n            other => return Err(format!("Нет миграции для версии профиля {}", other)),\n'''
replacement = '''                object.insert("schemaVersion".to_string(), json!(2));\n                version = 2;\n            }\n            2 => {\n                // v2 -> v3: macro playback controls. Defaults reproduce the old\n                // one-shot 1.0x playback exactly.\n                if let Some(rules) = object.get_mut("rules").and_then(Value::as_array_mut) {\n                    for rule in rules {\n                        let Some(rule_obj) = rule.as_object_mut() else { continue; };\n                        for action_field in ["actions", "holdActions"] {\n                            let Some(actions) = rule_obj.get_mut(action_field).and_then(Value::as_array_mut) else {\n                                continue;\n                            };\n                            for action in actions {\n                                let Some(action_obj) = action.as_object_mut() else { continue; };\n                                if action_obj.get("type").and_then(Value::as_str) == Some("runMacro") {\n                                    action_obj.entry("playback".to_string()).or_insert_with(|| json!({\n                                        "speed": 1.0,\n                                        "repeatCount": 1,\n                                        "repeatWhileHeld": false\n                                    }));\n                                }\n                            }\n                        }\n                    }\n                }\n                object.insert("schemaVersion".to_string(), json!(3));\n                version = 3;\n            }\n            other => return Err(format!("Нет миграции для версии профиля {}", other)),\n'''
if marker not in s:
    raise RuntimeError('persistence migration marker not found')
p.write_text(s.replace(marker, replacement, 1), encoding='utf-8')

# Default macro creation in frontend.
replace_once(
    'src/pages/RulesPage.tsx',
    "      actions: [{ type: 'runMacro', steps: [] }],\n",
    "      actions: [{ type: 'runMacro', steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }],\n",
)
replace_once(
    'src/components/ruleBuilder/ActionEditor.tsx',
    "    case 'runMacro': return { type, steps: [] };\n",
    "    case 'runMacro': return { type, steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } };\n",
)

# Rust onboarding demo fixture.
replace_once(
    'src-tauri/src/daemon/router.rs',
    '                        MacroStep,\n',
    '                        MacroPlayback, MacroStep,\n',
)
replace_once(
    'src-tauri/src/daemon/router.rs',
    '''                                ],\n                            }],\n''',
    '''                                ],\n                                playback: MacroPlayback::default(),\n                            }],\n''',
)

print('v0.3.1 macro playback model staged')
