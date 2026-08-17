from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


# Collapse adjacent duplicate empty macro fields at ANY indentation. The initial
# schema pass intentionally targets several literal shapes, so this repair is
# indentation-agnostic and idempotent.
duplicate = re.compile(r'(?m)^(?P<indent>[ \t]*)macros: vec!\[\],\r?\n(?P=indent)macros: vec!\[\],\s*$')
for path in list(Path('src-tauri/src').rglob('*.rs')) + list(Path('src-tauri/tests').rglob('*.rs')):
    text = path.read_text(encoding='utf-8')
    while duplicate.search(text):
        text = duplicate.sub(lambda m: f'{m.group("indent")}macros: vec![],', text)
    path.write_text(text, encoding='utf-8')

# Compiler contract: a valid macroId resolves exactly the referenced library
# steps, while an unknown ID compiles to an empty macro command list.
p = 'src-tauri/src/daemon/compiler.rs'
text = read(p)
import_old = '''        FrontendAction, FrontendConfig, FrontendRule, FrontendTrigger, GestureDirection, KeyChord,
        MouseWheelDirection, key_modifiers,
'''
import_new = '''        FrontendAction, FrontendConfig, FrontendRule, FrontendTrigger, GestureDirection, KeyChord,
        MacroAction, MacroDefinition, MacroPlayback, MacroStep, MouseWheelDirection, key_modifiers,
'''
if import_old not in text:
    raise SystemExit('compiler test import anchor missing')
text = text.replace(import_old, import_new, 1)

anchor = '''    #[test]
    fn disabled_rules_are_not_compiled() {'''
test = r'''    #[test]
    fn macro_ids_resolve_only_the_referenced_library_object() {
        let playback = MacroPlayback::default();
        let config = FrontendConfig {
            rules: vec![
                rule(
                    "macro-valid",
                    10,
                    FrontendTrigger::KeyDown { chord: KeyChord::single(0x70) },
                    FrontendAction::RunMacro {
                        macro_id: "macro-a".into(),
                        playback: playback.clone(),
                    },
                ),
                rule(
                    "macro-missing",
                    9,
                    FrontendTrigger::KeyDown { chord: KeyChord::single(0x71) },
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
                    MacroStep { action: MacroAction::KeyDown { code: 0x41 }, delay_ms: 12 },
                    MacroStep { action: MacroAction::KeyUp { code: 0x41 }, delay_ms: 0 },
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
                    SimulatorCommand::Delay(12),
                    SimulatorCommand::PressKey(0x41),
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

'''
if anchor not in text:
    raise SystemExit('compiler test insertion anchor missing')
text = text.replace(anchor, test + anchor, 1)
write(p, text)

# Fail this staging fix itself if any adjacent duplicate survived.
for path in list(Path('src-tauri/src').rglob('*.rs')) + list(Path('src-tauri/tests').rglob('*.rs')):
    if duplicate.search(path.read_text(encoding='utf-8')):
        raise SystemExit(f'adjacent duplicate macros field remains in {path}')

print('v0.4.1 fix02 macro field normalization/compiler resolution test applied')
