use keymaster_pro_lib::schemas::frontend::FrontendAction;
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
    assert_eq!(
        profile.macros.len(),
        2,
        "identical legacy macros must stay independent"
    );
    assert_ne!(profile.macros[0].id, profile.macros[1].id);
    assert_eq!(profile.macros[0].steps.len(), 1);

    let FrontendAction::RunMacro {
        macro_id: first_id, ..
    } = &profile.rules[0].actions[0]
    else {
        panic!("first action should be library macro");
    };
    let FrontendAction::RunMacro {
        macro_id: second_id,
        ..
    } = &profile.rules[0].actions[1]
    else {
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
