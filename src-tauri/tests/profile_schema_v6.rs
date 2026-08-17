use keymaster_pro_lib::schemas::frontend::{FrontendTrigger, GestureDirection};
use keymaster_pro_lib::shared::persistence::{
    PROFILE_SCHEMA_VERSION, export_profile_value, import_profile_value,
};
use serde_json::json;

fn base_profile(rules: serde_json::Value) -> serde_json::Value {
    json!({
        "schemaVersion": 5,
        "id": "advanced-v6", "name": "Advanced", "isDefault": false,
        "linkedApps": [], "bindings": [], "order": 0, "layers": [], "folders": [],
        "rules": rules
    })
}

fn rule(id: &str, trigger: serde_json::Value) -> serde_json::Value {
    json!({
        "id": id, "name": id, "priority": 0, "enabled": true,
        "folderId": null, "order": 0, "holdActions": null, "conditions": [],
        "trigger": trigger,
        "actions": [{ "type": "typeText", "text": id, "dateFormat": "dmy", "timeFormat": "hm24" }]
    })
}

#[test]
fn v5_profiles_migrate_to_v6_without_rewriting_old_rules() {
    let source = base_profile(json!([
        rule(
            "old-key",
            json!({ "type": "keyDown", "code": 65, "modifiers": 0 })
        ),
        rule(
            "old-text",
            json!({
                "type": "typedText", "sequence": ";x", "mode": "instant",
                "delimiters": " ", "caseSensitive": true
            })
        )
    ]));
    let profile = import_profile_value(source).expect("v5 should migrate to v6");
    assert_eq!(PROFILE_SCHEMA_VERSION, 7);
    assert!(matches!(
        profile.rules[0].trigger,
        FrontendTrigger::KeyDown { .. }
    ));
    assert!(matches!(
        profile.rules[1].trigger,
        FrontendTrigger::TypedText { .. }
    ));
    let exported = export_profile_value(&profile).unwrap();
    assert_eq!(exported["schemaVersion"], 7);
    assert_eq!(exported["rules"][0]["trigger"]["type"], "keyDown");
    assert_eq!(exported["rules"][1]["trigger"]["caseSensitive"], true);
}

#[test]
fn frontend_advanced_trigger_contract_round_trips_all_variants() {
    let source = base_profile(json!([
        rule(
            "leader",
            json!({
                "type": "leaderSequence",
                "leader": { "code": 20, "modifiers": 1 },
                "sequence": [70, 70], "timeoutMs": 900
            })
        ),
        rule(
            "sequence",
            json!({
                "type": "keySequence", "sequence": [71, 72, 73], "timeoutMs": 650
            })
        ),
        rule(
            "chord",
            json!({
                "type": "keyChordSet", "codes": [74, 75, 76], "maxSkewMs": 75
            })
        ),
        rule(
            "gesture",
            json!({
                "type": "mouseGesture", "code": 4,
                "directions": ["right", "down", "left"], "minDistance": 30
            })
        )
    ]));
    let profile = import_profile_value(source).expect("advanced trigger JSON parses");

    match &profile.rules[0].trigger {
        FrontendTrigger::LeaderSequence {
            leader,
            sequence,
            timeout_ms,
        } => {
            assert_eq!(leader.code, 20);
            assert_eq!(leader.modifiers, 1);
            assert_eq!(sequence, &vec![70, 70]);
            assert_eq!(*timeout_ms, 900);
        }
        other => panic!("unexpected leader: {other:?}"),
    }
    match &profile.rules[1].trigger {
        FrontendTrigger::KeySequence {
            sequence,
            timeout_ms,
        } => {
            assert_eq!(sequence, &vec![71, 72, 73]);
            assert_eq!(*timeout_ms, 650);
        }
        other => panic!("unexpected sequence: {other:?}"),
    }
    match &profile.rules[2].trigger {
        FrontendTrigger::KeyChordSet { codes, max_skew_ms } => {
            assert_eq!(codes, &vec![74, 75, 76]);
            assert_eq!(*max_skew_ms, 75);
        }
        other => panic!("unexpected chord: {other:?}"),
    }
    match &profile.rules[3].trigger {
        FrontendTrigger::MouseGesture {
            code,
            directions,
            min_distance,
        } => {
            assert_eq!(*code, 4);
            assert_eq!(
                directions,
                &vec![
                    GestureDirection::Right,
                    GestureDirection::Down,
                    GestureDirection::Left
                ]
            );
            assert_eq!(*min_distance, 30);
        }
        other => panic!("unexpected gesture: {other:?}"),
    }

    let exported = export_profile_value(&profile).unwrap();
    assert_eq!(exported["schemaVersion"], 7);
    assert_eq!(exported["rules"][0]["trigger"]["timeoutMs"], 900);
    assert_eq!(exported["rules"][2]["trigger"]["maxSkewMs"], 75);
    assert_eq!(exported["rules"][3]["trigger"]["minDistance"], 30);
    assert_eq!(exported["rules"][3]["trigger"]["directions"][1], "down");
}
