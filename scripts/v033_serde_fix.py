from pathlib import Path

p = Path('src-tauri/src/schemas/frontend.rs')
s = p.read_text(encoding='utf-8')
old = '''        #[serde(default = "default_case_sensitive")]
        case_sensitive: bool,'''
new = '''        #[serde(rename = "caseSensitive", default = "default_case_sensitive")]
        case_sensitive: bool,'''
if old not in s:
    raise SystemExit('caseSensitive serde anchor missing')
s = s.replace(old, new, 1)
old = '''        #[serde(default)]
        date_format: TextDateFormat,
        #[serde(default)]
        time_format: TextTimeFormat,'''
new = '''        #[serde(rename = "dateFormat", default)]
        date_format: TextDateFormat,
        #[serde(rename = "timeFormat", default)]
        time_format: TextTimeFormat,'''
if old not in s:
    raise SystemExit('date/time serde anchor missing')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Strengthen v5 round-trip so UI contract regressions cannot hide behind serde defaults.
p = Path('src-tauri/tests/profile_schema_v5.rs')
s = p.read_text(encoding='utf-8')
anchor = '''    assert_eq!(exported["rules"][0]["trigger"]["caseSensitive"], true);
}'''
replacement = '''    assert_eq!(exported["rules"][0]["trigger"]["caseSensitive"], true);
    assert_eq!(exported["rules"][0]["actions"][0]["dateFormat"], "dmy");
    assert_eq!(exported["rules"][0]["actions"][0]["timeFormat"], "hm24");

    // A frontend-authored false value must survive deserialization; otherwise
    // case-insensitive expansion would silently behave as case-sensitive.
    let frontend = json!({
        "schemaVersion": 5,
        "id": "frontend-v5", "name": "Frontend v5", "isDefault": false,
        "linkedApps": [], "bindings": [], "order": 0, "layers": [], "folders": [],
        "rules": [{
            "id": "ci", "name": "CI", "priority": 0, "enabled": true,
            "folderId": null, "order": 0, "holdActions": null, "conditions": [],
            "trigger": { "type": "typedText", "sequence": ";ABC", "mode": "instant", "delimiters": " ", "caseSensitive": false },
            "actions": [{ "type": "typeText", "text": "{{date}}", "dateFormat": "ymd", "timeFormat": "hms24" }]
        }]
    });
    let profile = import_profile_value(frontend).expect("frontend v5 contract parses");
    match &profile.rules[0].trigger {
        FrontendTrigger::TypedText { case_sensitive, .. } => assert!(!case_sensitive),
        other => panic!("unexpected trigger: {other:?}"),
    }
    match &profile.rules[0].actions[0] {
        FrontendAction::TypeText { date_format, time_format, .. } => {
            assert_eq!(*date_format, TextDateFormat::Ymd);
            assert_eq!(*time_format, TextTimeFormat::Hms24);
        }
        other => panic!("unexpected action: {other:?}"),
    }
}'''
if anchor not in s:
    raise SystemExit('v5 round-trip assertion anchor missing')
p.write_text(s.replace(anchor, replacement, 1), encoding='utf-8')
print('v0.3.3 frontend serde contract fixed')
