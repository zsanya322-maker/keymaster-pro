use keymaster_pro_lib::schemas::frontend::{
    FrontendAction, FrontendTrigger, TextDateFormat, TextExpansionMode, TextTimeFormat,
};
use keymaster_pro_lib::shared::persistence::{
    PROFILE_SCHEMA_VERSION, export_profile_value, import_profile_value,
};
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
        FrontendTrigger::TypedText {
            sequence,
            mode,
            case_sensitive,
            ..
        } => {
            assert_eq!(sequence, ";Mail");
            assert_eq!(*mode, TextExpansionMode::Instant);
            assert!(*case_sensitive);
        }
        other => panic!("unexpected trigger: {other:?}"),
    }
    match &profile.rules[0].actions[0] {
        FrontendAction::TypeText {
            text,
            date_format,
            time_format,
        } => {
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
        FrontendAction::TypeText {
            date_format,
            time_format,
            ..
        } => {
            assert_eq!(*date_format, TextDateFormat::Ymd);
            assert_eq!(*time_format, TextTimeFormat::Hms24);
        }
        other => panic!("unexpected action: {other:?}"),
    }
}
