use serde_json::json;

use crate::daemon::router::dispatch;
use crate::daemon::state::DaemonState;
use crate::shared::persistence;
use crate::shared::types::Profile;

fn test_profile(id: String, name: &str, is_default: bool) -> Profile {
    Profile {
        id,
        name: name.to_string(),
        is_default,
        linked_apps: vec![],
        bindings: vec![],
        order: 0,
        rules: vec![],
        macros: vec![],
        layers: vec![],
        folders: vec![],
    }
}

#[tokio::test]
async fn profile_create_rejects_existing_id_without_overwrite() {
    let id = format!("test-create-{}", uuid::Uuid::new_v4());
    let original = test_profile(id.clone(), "Original", false);
    persistence::save_profile(&original).unwrap();

    let state = DaemonState::default().into_ref();
    let result = dispatch(
        "profile.create",
        Some(json!({
            "id": id,
            "name": "Replacement",
            "isDefault": false,
            "linkedApps": []
        })),
        &state,
    )
    .await;

    assert!(result.is_err());
    assert_eq!(
        persistence::load_profile(&original.id).unwrap().name,
        "Original"
    );
    let _ = persistence::delete_profile(&original.id);
}

#[tokio::test]
async fn profile_import_rejects_existing_id_without_overwrite() {
    let id = format!("test-import-{}", uuid::Uuid::new_v4());
    let original = test_profile(id.clone(), "Original import target", false);
    persistence::save_profile(&original).unwrap();

    let state = DaemonState::default().into_ref();
    let result = dispatch(
        "profile.import",
        Some(json!({
            "id": id,
            "name": "Imported replacement",
            "isDefault": false,
            "linkedApps": [],
            "rules": [],
            "layers": []
        })),
        &state,
    )
    .await;

    assert!(result.is_err());
    assert_eq!(
        persistence::load_profile(&original.id).unwrap().name,
        "Original import target"
    );
    let _ = persistence::delete_profile(&original.id);
}

#[tokio::test]
async fn profile_save_rejects_nonexistent_profile() {
    let id = format!("test-save-missing-{}", uuid::Uuid::new_v4());
    let state = DaemonState::default().into_ref();

    let result = dispatch(
        "profile.save",
        Some(json!({
            "id": id,
            "name": "Must not be created by save",
            "isDefault": false,
            "linkedApps": [],
            "rules": [],
            "layers": []
        })),
        &state,
    )
    .await;

    assert!(result.is_err());
    assert!(
        !persistence::list_profiles()
            .unwrap()
            .iter()
            .any(|existing| existing == &id)
    );
}

#[tokio::test]
async fn profile_delete_rejects_active_profile() {
    let id = format!("test-active-delete-{}", uuid::Uuid::new_v4());
    let profile = test_profile(id.clone(), "Active", false);
    persistence::save_profile(&profile).unwrap();

    let mut daemon_state = DaemonState::default();
    daemon_state.active_profile_id = id.clone();
    let state = daemon_state.into_ref();

    let result = dispatch("profile.delete", Some(json!({ "id": id })), &state).await;
    assert!(result.is_err());
    assert!(persistence::load_profile(&profile.id).is_ok());
    let _ = persistence::delete_profile(&profile.id);
}

#[tokio::test]
async fn profile_delete_rejects_default_profile() {
    let id = format!("test-default-delete-{}", uuid::Uuid::new_v4());
    let profile = test_profile(id.clone(), "Protected default", true);
    persistence::save_profile(&profile).unwrap();

    let state = DaemonState::default().into_ref();
    let result = dispatch("profile.delete", Some(json!({ "id": id })), &state).await;

    assert!(result.is_err());
    assert!(persistence::load_profile(&profile.id).is_ok());
    let _ = persistence::delete_profile(&profile.id);
}

#[tokio::test]
async fn profile_create_rejects_second_default_profile() {
    let existing_id = format!("test-default-existing-{}", uuid::Uuid::new_v4());
    let new_id = format!("test-default-second-{}", uuid::Uuid::new_v4());
    let existing = test_profile(existing_id.clone(), "Existing default", true);
    persistence::save_profile(&existing).unwrap();

    let state = DaemonState::default().into_ref();
    let result = dispatch(
        "profile.create",
        Some(json!({
            "id": new_id,
            "name": "Second default",
            "isDefault": true,
            "linkedApps": []
        })),
        &state,
    )
    .await;

    assert!(result.is_err());
    assert!(
        !persistence::list_profiles()
            .unwrap()
            .iter()
            .any(|id| id == &new_id)
    );
    let _ = persistence::delete_profile(&existing_id);
}

#[tokio::test]
async fn profile_save_rejects_default_flag_change() {
    let id = format!("test-default-mutate-{}", uuid::Uuid::new_v4());
    let original = test_profile(id.clone(), "Default identity", true);
    persistence::save_profile(&original).unwrap();

    let state = DaemonState::default().into_ref();
    let result = dispatch(
        "profile.save",
        Some(json!({
            "id": id,
            "name": "Attempted mutation",
            "isDefault": false,
            "linkedApps": [],
            "rules": [],
            "layers": []
        })),
        &state,
    )
    .await;

    assert!(result.is_err());
    let loaded = persistence::load_profile(&original.id).unwrap();
    assert!(loaded.is_default);
    assert_eq!(loaded.name, "Default identity");
    let _ = persistence::delete_profile(&original.id);
}

#[tokio::test]
async fn profile_import_downgrades_second_default_to_regular_profile() {
    let existing_id = format!("test-import-default-existing-{}", uuid::Uuid::new_v4());
    let imported_id = format!("test-import-default-new-{}", uuid::Uuid::new_v4());
    let existing = test_profile(existing_id.clone(), "Existing default", true);
    persistence::save_profile(&existing).unwrap();

    let state = DaemonState::default().into_ref();
    let result = dispatch(
        "profile.import",
        Some(json!({
            "id": imported_id,
            "name": "Imported default",
            "isDefault": true,
            "linkedApps": [],
            "rules": [],
            "layers": []
        })),
        &state,
    )
    .await;

    assert!(result.is_ok());
    let imported = persistence::load_profile(&imported_id).unwrap();
    assert!(!imported.is_default);

    let _ = persistence::delete_profile(&imported_id);
    let _ = persistence::delete_profile(&existing_id);
}
