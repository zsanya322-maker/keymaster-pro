use keymaster_pro_lib::schemas::frontend::{FrontendAction, FrontendTrigger};
use keymaster_pro_lib::shared::persistence::{
    PROFILE_SCHEMA_VERSION, export_profile_value, import_profile_value,
};
use serde_json::json;

#[test]
fn v1_single_key_profile_migrates_without_behavior_change() {
    let legacy = json!({
        "schemaVersion": 1,
        "id": "migration-v1",
        "name": "Legacy v1",
        "isDefault": false,
        "linkedApps": [],
        "layers": [],
        "rules": [{
            "id": "rule-1",
            "name": "F2 to F3",
            "trigger": { "type": "keyDown", "code": 113 },
            "actions": [{ "type": "remapKey", "code": 114 }],
            "holdActions": null,
            "conditions": [],
            "priority": 10
        }]
    });

    let profile = import_profile_value(legacy).expect("v1 profile should migrate");
    assert!(profile.folders.is_empty());
    assert_eq!(profile.rules.len(), 1);

    let rule = &profile.rules[0];
    assert!(rule.enabled);
    assert_eq!(rule.folder_id, None);
    assert_eq!(rule.order, 0);

    match &rule.trigger {
        FrontendTrigger::KeyDown { chord } => {
            assert_eq!(chord.code, 113);
            assert_eq!(chord.modifiers, 0);
        }
        other => panic!("unexpected migrated trigger: {other:?}"),
    }

    match &rule.actions[0] {
        FrontendAction::RemapKey { chord } => {
            assert_eq!(chord.code, 114);
            assert_eq!(chord.modifiers, 0);
        }
        other => panic!("unexpected migrated action: {other:?}"),
    }

    let exported = export_profile_value(&profile).expect("migrated profile should export");
    assert_eq!(
        exported
            .get("schemaVersion")
            .and_then(|value| value.as_u64()),
        Some(PROFILE_SCHEMA_VERSION as u64)
    );
    assert_eq!(exported["rules"][0]["trigger"]["modifiers"], 0);
    assert_eq!(exported["rules"][0]["actions"][0]["modifiers"], 0);
    assert_eq!(exported["rules"][0]["enabled"], true);
    assert_eq!(exported["rules"][0]["order"], 0);
    assert_eq!(exported["folders"], json!([]));
}
