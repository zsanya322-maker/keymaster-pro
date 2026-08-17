from pathlib import Path

p = Path('src-tauri/tests/profile_schema_v3.rs')
text = p.read_text(encoding='utf-8')
old = '''    match &profile.rules[0].actions[0] {
        FrontendAction::RunMacro { steps, playback } => {
            assert_eq!(steps.len(), 2);
            assert_eq!(playback.speed, 1.0);
            assert_eq!(playback.repeat_count, 1);
            assert!(!playback.repeat_while_held);
        }
        other => panic!("unexpected migrated action: {other:?}"),
    }
'''
new = '''    assert_eq!(profile.macros.len(), 1);
    match &profile.rules[0].actions[0] {
        FrontendAction::RunMacro { macro_id, playback } => {
            let macro_def = profile
                .macros
                .iter()
                .find(|item| &item.id == macro_id)
                .expect("migrated runMacro must reference its library object");
            assert_eq!(macro_def.steps.len(), 2);
            assert_eq!(playback.speed, 1.0);
            assert_eq!(playback.repeat_count, 1);
            assert!(!playback.repeat_while_held);
        }
        other => panic!("unexpected migrated action: {other:?}"),
    }
'''
if old not in text:
    raise SystemExit('legacy v2 macro assertion anchor missing')
text = text.replace(old, new, 1)

# Schema staging has already moved the expected latest marker from 6 to 7.
anchor = '''    assert_eq!(exported["rules"][0]["actions"][0]["playback"]["speed"], 1.0);'''
extra = '''    assert_eq!(exported["macros"].as_array().unwrap().len(), 1);
    assert!(exported["rules"][0]["actions"][0]["macroId"].is_string());
    assert!(exported["rules"][0]["actions"][0].get("steps").is_none());
'''
if anchor not in text:
    raise SystemExit('v2 export assertion anchor missing')
text = text.replace(anchor, extra + anchor, 1)

anchor2 = '''    assert_eq!(exported["rules"][0]["actions"][0]["playback"]["speed"], 2.0);'''
extra2 = '''    assert_eq!(exported["macros"].as_array().unwrap().len(), 1);
    assert!(exported["rules"][0]["actions"][0]["macroId"].is_string());
    assert!(exported["rules"][0]["actions"][0].get("steps").is_none());
'''
if anchor2 not in text:
    raise SystemExit('v3 export assertion anchor missing')
text = text.replace(anchor2, extra2 + anchor2, 1)

p.write_text(text, encoding='utf-8')
print('v0.4.1 fix04 legacy macro migration tests adapted to v7 library')
