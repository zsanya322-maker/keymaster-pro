use keymaster_pro_lib::schemas::frontend::FrontendAction;
use keymaster_pro_lib::shared::persistence::{
    PROFILE_SCHEMA_VERSION, export_profile_value, import_profile_value,
};
use serde_json::json;

#[test]
fn v2_macro_profile_gets_backward_compatible_playback_defaults() {
    let legacy = json!({
        "schemaVersion": 2,
        "id": "migration-v2-macro",
        "name": "Legacy v2 macro",
        "isDefault": false,
        "linkedApps": [],
        "layers": [],
        "folders": [],
        "rules": [{
            "id": "macro-rule",
            "name": "Legacy macro",
            "trigger": { "type": "keyDown", "code": 112, "modifiers": 0 },
            "actions": [{
                "type": "runMacro",
                "steps": [
                    { "action": { "type": "keyDown", "code": 65 }, "delayMs": 120 },
                    { "action": { "type": "keyUp", "code": 65 }, "delayMs": 0 }
                ]
            }],
            "holdActions": null,
            "conditions": [],
            "priority": 0,
            "enabled": true,
            "folderId": null,
            "order": 0
        }]
    });

    let profile = import_profile_value(legacy).expect("v2 macro profile should migrate");
    assert_eq!(PROFILE_SCHEMA_VERSION, 5);
    assert_eq!(profile.rules.len(), 1);

    match &profile.rules[0].actions[0] {
        FrontendAction::RunMacro { steps, playback } => {
            assert_eq!(steps.len(), 2);
            assert_eq!(playback.speed, 1.0);
            assert_eq!(playback.repeat_count, 1);
            assert!(!playback.repeat_while_held);
        }
        other => panic!("unexpected migrated action: {other:?}"),
    }

    let exported = export_profile_value(&profile).expect("migrated profile should export");
    assert_eq!(exported["schemaVersion"], 5);
    assert_eq!(exported["rules"][0]["actions"][0]["playback"]["speed"], 1.0);
    assert_eq!(
        exported["rules"][0]["actions"][0]["playback"]["repeatCount"],
        1
    );
    assert_eq!(
        exported["rules"][0]["actions"][0]["playback"]["repeatWhileHeld"],
        false
    );
}

#[test]
fn v3_macro_playback_values_round_trip_without_being_rewritten() {
    let current = json!({
        "schemaVersion": 3,
        "id": "current-v3-macro",
        "name": "Current v3 macro",
        "isDefault": false,
        "linkedApps": [],
        "layers": [],
        "folders": [],
        "rules": [{
            "id": "macro-rule",
            "name": "Fast repeated macro",
            "trigger": { "type": "keyDown", "code": 113, "modifiers": 0 },
            "actions": [{
                "type": "runMacro",
                "steps": [],
                "playback": {
                    "speed": 2.0,
                    "repeatCount": 5,
                    "repeatWhileHeld": false
                }
            }],
            "holdActions": null,
            "conditions": [],
            "priority": 0,
            "enabled": true,
            "folderId": null,
            "order": 0
        }]
    });

    let profile = import_profile_value(current).expect("v3 macro profile should parse");
    let exported = export_profile_value(&profile).expect("v3 macro profile should export");

    assert_eq!(exported["schemaVersion"], 5);
    assert_eq!(exported["rules"][0]["actions"][0]["playback"]["speed"], 2.0);
    assert_eq!(
        exported["rules"][0]["actions"][0]["playback"]["repeatCount"],
        5
    );
    assert_eq!(
        exported["rules"][0]["actions"][0]["playback"]["repeatWhileHeld"],
        false
    );
}
