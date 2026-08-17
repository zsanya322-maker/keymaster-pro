from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


# The broad v7 initializer pass can touch FrontendConfig twice because both
# `rules -> layers` and `layers -> tap_hold_timeout_ms` patterns match. Collapse
# only literal empty duplicates; profile-backed configs are fixed explicitly.
for path in list(Path('src-tauri/src').rglob('*.rs')) + list(Path('src-tauri/tests').rglob('*.rs')):
    text = path.read_text(encoding='utf-8')
    while 'macros: vec![],\n            macros: vec![],' in text:
        text = text.replace('macros: vec![],\n            macros: vec![],', 'macros: vec![],')
    while 'macros: vec![],\n        macros: vec![],' in text:
        text = text.replace('macros: vec![],\n        macros: vec![],', 'macros: vec![],')
    while 'macros: vec![],\n                macros: vec![],' in text:
        text = text.replace('macros: vec![],\n                macros: vec![],', 'macros: vec![],')
    path.write_text(text, encoding='utf-8')

# Runtime compilation must use the active profile's real macro library.
p = 'src-tauri/src/daemon/profile_runtime.rs'
text = read(p)
text = text.replace(
    'macros: profile.macros.clone(),\n        macros: vec![],',
    'macros: profile.macros.clone(),',
)
write(p, text)

p = 'src-tauri/src/daemon/router.rs'
text = read(p)
# update_active_profile_runtime config: use profile macros instead of the two empty fields.
text = text.replace(
    'rules: profile.rules.clone(),\n            macros: vec![],\n            macros: vec![],\n            layers: profile.layers.clone(),',
    'rules: profile.rules.clone(),\n            macros: profile.macros.clone(),\n            layers: profile.layers.clone(),',
)
text = text.replace(
    'rules: profile.rules.clone(),\n            macros: vec![],\n            layers: profile.layers.clone(),',
    'rules: profile.rules.clone(),\n            macros: profile.macros.clone(),\n            layers: profile.layers.clone(),',
)

# Onboarding demo macro is now a first-class MacroDefinition plus a rule reference.
old = '''                        "macro" => FrontendRule {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: Some("Demo Macro".to_string()),
                            trigger: FrontendTrigger::KeyDown {
                                chord: KeyChord::single(123),
                            }, // F12
                            actions: vec![FrontendAction::RunMacro {
                                steps: vec![
                                    MacroStep {
                                        action: MacroAction::KeyDown { code: 72 },
                                        delay_ms: 50,
                                    }, // H
                                    MacroStep {
                                        action: MacroAction::KeyUp { code: 72 },
                                        delay_ms: 50,
                                    },
                                    MacroStep {
                                        action: MacroAction::KeyDown { code: 69 },
                                        delay_ms: 50,
                                    }, // E
                                    MacroStep {
                                        action: MacroAction::KeyUp { code: 69 },
                                        delay_ms: 50,
                                    },
                                ],
                                playback: MacroPlayback::default(),
                            }],
                            hold_actions: None,
                            conditions: vec![],
                            priority: 10,
                            enabled: true,
                            folder_id: None,
                            order: prof.rules.len() as i32,
                        },'''
new = '''                        "macro" => {
                            let macro_id = uuid::Uuid::new_v4().to_string();
                            prof.macros.push(MacroDefinition {
                                id: macro_id.clone(),
                                name: "Demo Macro".to_string(),
                                steps: vec![
                                    MacroStep {
                                        action: MacroAction::KeyDown { code: 72 },
                                        delay_ms: 50,
                                    }, // H
                                    MacroStep {
                                        action: MacroAction::KeyUp { code: 72 },
                                        delay_ms: 50,
                                    },
                                    MacroStep {
                                        action: MacroAction::KeyDown { code: 69 },
                                        delay_ms: 50,
                                    }, // E
                                    MacroStep {
                                        action: MacroAction::KeyUp { code: 69 },
                                        delay_ms: 50,
                                    },
                                ],
                            });
                            FrontendRule {
                                id: uuid::Uuid::new_v4().to_string(),
                                name: Some("Demo Macro".to_string()),
                                trigger: FrontendTrigger::KeyDown {
                                    chord: KeyChord::single(123),
                                }, // F12
                                actions: vec![FrontendAction::RunMacro {
                                    macro_id,
                                    playback: MacroPlayback::default(),
                                }],
                                hold_actions: None,
                                conditions: vec![],
                                priority: 10,
                                enabled: true,
                                folder_id: None,
                                order: prof.rules.len() as i32,
                            }
                        },'''
if old not in text:
    raise SystemExit('router onboarding macro anchor missing')
text = text.replace(old, new, 1)
text = text.replace(
    'FrontendAction, FrontendRule, FrontendTrigger, KeyChord, MacroAction,\n                        MacroPlayback, MacroStep,',
    'FrontendAction, FrontendRule, FrontendTrigger, KeyChord, MacroAction,\n                        MacroDefinition, MacroPlayback, MacroStep,',
    1,
)
# Profile identity regression fixture has layers before rules, so the generic pass misses it.
fixture_anchor = '''            order: 4,
            layers: vec![LayerMeta {'''
if fixture_anchor not in text:
    raise SystemExit('router Profile fixture anchor missing')
text = text.replace(fixture_anchor, '''            order: 4,
            macros: vec![],
            layers: vec![LayerMeta {''', 1)
write(p, text)

# Assert there are no duplicate empty macro fields left after the repair.
for path in list(Path('src-tauri/src').rglob('*.rs')) + list(Path('src-tauri/tests').rglob('*.rs')):
    text = path.read_text(encoding='utf-8')
    if 'macros: vec![],\n            macros: vec![],' in text or 'macros: vec![],\n        macros: vec![],' in text:
        raise SystemExit(f'duplicate macros field remains in {path}')

print('v0.4.1 fix01 Rust literal/macro demo repair applied')
