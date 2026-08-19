use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::daemon::state::DaemonStateRef;
use crate::schemas::frontend::{
    FrontendAction, FrontendCondition, FrontendRule, LayerMeta, MacroDefinition, RuleFolder,
};
use crate::shared::types::Profile;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationAdditions {
    #[serde(default)]
    pub rules: Vec<FrontendRule>,
    #[serde(default)]
    pub macros: Vec<MacroDefinition>,
    #[serde(default)]
    pub layers: Vec<LayerMeta>,
    #[serde(default)]
    pub folders: Vec<RuleFolder>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdditionsRequest {
    profile_id: String,
    additions: AutomationAdditions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleRequest {
    #[serde(default)]
    profile_id: Option<String>,
    rule: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoRequest {
    profile_id: String,
    backup_name: String,
    expected_revision: String,
}

fn selected_profile_id(
    requested: Option<String>,
    state: &DaemonStateRef,
) -> Result<String, String> {
    if let Some(id) = requested.filter(|id| !id.trim().is_empty()) {
        return Ok(id);
    }
    let daemon = state.read().map_err(|_| "Failed to lock state")?;
    if daemon.active_profile_id.trim().is_empty() {
        Err("No active profile".to_string())
    } else {
        Ok(daemon.active_profile_id.clone())
    }
}

fn profile_revision(profile: &Profile) -> Result<String, String> {
    let canonical = crate::shared::persistence::export_profile_value(profile)?;
    let serialized = serde_json::to_string(&canonical)
        .map_err(|error| format!("Failed to serialize profile revision: {error}"))?;
    Ok(format!(
        "{:016x}",
        crate::shared::calculate_hash(&serialized)
    ))
}

fn refresh_active_runtime(profile: &Profile, state: &DaemonStateRef) -> Result<(), String> {
    let active = {
        let daemon = state.read().map_err(|_| "Failed to lock state")?;
        daemon.active_profile_id == profile.id
    };
    if active {
        crate::daemon::profile_runtime::activate_runtime(state, profile.clone())?;
    }
    Ok(())
}

fn non_empty(value: &str) -> bool {
    !value.trim().is_empty()
}

fn collect_unique<'a>(
    kind: &str,
    values: impl Iterator<Item = &'a str>,
) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    for value in values {
        if !non_empty(value) {
            return Err(format!("{kind} id cannot be empty"));
        }
        if !ids.insert(value.to_string()) {
            return Err(format!("Duplicate {kind} id: {value}"));
        }
    }
    Ok(ids)
}

fn validate_folder_graph(profile: &Profile, folder_ids: &HashSet<String>) -> Result<(), String> {
    let mut parents: HashMap<&str, Option<&str>> = HashMap::new();
    for folder in &profile.folders {
        if !non_empty(&folder.name) {
            return Err(format!("Folder '{}' has an empty name", folder.id));
        }
        if let Some(parent_id) = folder.parent_id.as_deref() {
            if !folder_ids.contains(parent_id) {
                return Err(format!(
                    "Folder '{}' references missing parent folderId: {}",
                    folder.id, parent_id
                ));
            }
            if parent_id == folder.id {
                return Err(format!("Folder '{}' cannot be its own parent", folder.id));
            }
        }
        parents.insert(&folder.id, folder.parent_id.as_deref());
    }

    for folder in &profile.folders {
        let mut seen = HashSet::new();
        let mut current = Some(folder.id.as_str());
        while let Some(id) = current {
            if !seen.insert(id) {
                return Err(format!(
                    "Folder cycle detected near folderId: {}",
                    folder.id
                ));
            }
            current = parents.get(id).copied().flatten();
        }
    }
    Ok(())
}

fn validate_action(
    action: &FrontendAction,
    macro_ids: &HashSet<String>,
    layer_ids: &HashSet<String>,
) -> Result<(), String> {
    match action {
        FrontendAction::RunMacro { macro_id, playback } => {
            if !macro_ids.contains(macro_id) {
                return Err(format!("Unknown macroId: {macro_id}"));
            }
            if !playback.speed.is_finite() || playback.speed <= 0.0 {
                return Err(format!(
                    "Invalid macro playback speed for macroId: {macro_id}"
                ));
            }
            if playback.repeat_count == 0 {
                return Err(format!("repeatCount must be >= 1 for macroId: {macro_id}"));
            }
        }
        FrontendAction::ToggleLayer { layer_id } | FrontendAction::HoldLayer { layer_id } => {
            if !layer_ids.contains(layer_id) {
                return Err(format!("Unknown layerId: {layer_id}"));
            }
        }
        FrontendAction::SystemVolume { action } => {
            if !matches!(action.as_str(), "mute" | "up" | "down") {
                return Err(format!("Unknown systemVolume action: {action}"));
            }
        }
        FrontendAction::MediaKey { key } => {
            if !matches!(key.as_str(), "play_pause" | "next" | "prev" | "stop") {
                return Err(format!("Unknown mediaKey value: {key}"));
            }
        }
        FrontendAction::WindowAction { action } => {
            if !matches!(
                action.as_str(),
                "snap_left" | "snap_right" | "snap_center" | "minimize" | "maximize" | "close"
            ) {
                return Err(format!("Unknown windowAction value: {action}"));
            }
        }
        FrontendAction::LaunchApp { path } if !non_empty(path) => {
            return Err("launchApp path cannot be empty".to_string());
        }
        FrontendAction::FocusProcess { process, title } => {
            let has_process = process.as_deref().is_some_and(non_empty);
            let has_title = title.as_deref().is_some_and(non_empty);
            if !has_process && !has_title {
                return Err("focusProcess requires process or title".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_condition(
    condition: &FrontendCondition,
    layer_ids: &HashSet<String>,
) -> Result<(), String> {
    match condition {
        FrontendCondition::LayerActive { layer_id } => {
            if !layer_ids.contains(layer_id) {
                return Err(format!("Unknown layerId: {layer_id}"));
            }
        }
        FrontendCondition::WindowMatch { process, title } => {
            let has_process = process.as_deref().is_some_and(non_empty);
            let has_title = title.as_deref().is_some_and(non_empty);
            if !has_process && !has_title {
                return Err("windowMatch requires process or title".to_string());
            }
        }
        FrontendCondition::ContextMatch {
            process,
            path,
            title,
            class_name,
            virtual_desktop_id,
            monitor_id,
            min_width,
            max_width,
            min_height,
            max_height,
            fullscreen,
            ..
        } => {
            let has_selector = [
                process.as_deref(),
                path.as_deref(),
                title.as_deref(),
                class_name.as_deref(),
                virtual_desktop_id.as_deref(),
                monitor_id.as_deref(),
            ]
            .into_iter()
            .flatten()
            .any(non_empty)
                || min_width.is_some()
                || max_width.is_some()
                || min_height.is_some()
                || max_height.is_some()
                || fullscreen.is_some();
            if !has_selector {
                return Err("contextMatch requires at least one selector".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

/// Canonical semantic validator for automation writes. JSON shape/ranges are
/// enforced first by serde against the same Rust runtime structs used by the
/// compiler; this function owns cross-reference and runtime invariants.
pub fn validate_profile_automation(profile: &Profile) -> Result<(), String> {
    let macro_ids = collect_unique("macro", profile.macros.iter().map(|item| item.id.as_str()))?;
    let layer_ids = collect_unique("layer", profile.layers.iter().map(|item| item.id.as_str()))?;
    let folder_ids = collect_unique(
        "folder",
        profile.folders.iter().map(|item| item.id.as_str()),
    )?;
    collect_unique("rule", profile.rules.iter().map(|item| item.id.as_str()))?;

    for macro_definition in &profile.macros {
        if !non_empty(&macro_definition.name) {
            return Err(format!("Macro '{}' has an empty name", macro_definition.id));
        }
    }
    for layer in &profile.layers {
        if !non_empty(&layer.name) {
            return Err(format!("Layer '{}' has an empty name", layer.id));
        }
    }
    validate_folder_graph(profile, &folder_ids)?;

    for rule in &profile.rules {
        if rule.actions.is_empty() {
            return Err(format!(
                "Rule '{}' must contain at least one action",
                rule.id
            ));
        }
        if let Some(folder_id) = rule.folder_id.as_deref() {
            if !folder_ids.contains(folder_id) {
                return Err(format!(
                    "Rule '{}' references missing folderId: {folder_id}",
                    rule.id
                ));
            }
        }
        for action in rule
            .actions
            .iter()
            .chain(rule.hold_actions.iter().flatten())
        {
            validate_action(action, &macro_ids, &layer_ids)?;
        }
        for condition in &rule.conditions {
            validate_condition(condition, &layer_ids)?;
        }
    }
    Ok(())
}

fn candidate_with_additions(mut profile: Profile, additions: AutomationAdditions) -> Profile {
    profile.rules.extend(additions.rules);
    profile.macros.extend(additions.macros);
    profile.layers.extend(additions.layers);
    profile.folders.extend(additions.folders);
    profile
}

fn parse_additions_request(params: Option<Value>) -> Result<AdditionsRequest, String> {
    serde_json::from_value(params.ok_or_else(|| "Missing parameters".to_string())?)
        .map_err(|error| format!("Automation payload does not match Rust runtime schema: {error}"))
}

fn normalize_rule_value(mut value: Value, order: i32) -> Result<FrontendRule, String> {
    let object: &mut Map<String, Value> = value
        .as_object_mut()
        .ok_or_else(|| "rule must be an object".to_string())?;
    object.insert("id".to_string(), json!(uuid::Uuid::new_v4().to_string()));
    object.entry("priority".to_string()).or_insert(json!(10));
    object.entry("enabled".to_string()).or_insert(json!(true));
    object.entry("conditions".to_string()).or_insert(json!([]));
    object
        .entry("holdActions".to_string())
        .or_insert(Value::Null);
    object.entry("folderId".to_string()).or_insert(Value::Null);
    object.insert("order".to_string(), json!(order));
    serde_json::from_value(value)
        .map_err(|error| format!("Rule does not match Rust runtime schema: {error}"))
}

fn latest_backup_name(profile_id: &str) -> Result<String, String> {
    crate::shared::persistence::list_profile_backups(profile_id)?
        .into_iter()
        .next()
        .ok_or_else(|| {
            format!("Mandatory backup for profile '{profile_id}' was not found after save")
        })
}

fn install_additions(request: AdditionsRequest, state: &DaemonStateRef) -> Result<Value, String> {
    let profile = crate::shared::persistence::load_profile_checked(&request.profile_id)?;
    let candidate = candidate_with_additions(profile, request.additions);
    validate_profile_automation(&candidate)?;
    crate::shared::persistence::save_profile(&candidate)?;
    let backup_name = latest_backup_name(&candidate.id)?;
    let post_revision = profile_revision(&candidate)?;
    refresh_active_runtime(&candidate, state)?;
    Ok(json!({
        "success": true,
        "profileId": candidate.id,
        "backupName": backup_name,
        "postRevision": post_revision
    }))
}

fn append_rule(request: RuleRequest, state: &DaemonStateRef) -> Result<Value, String> {
    let profile_id = selected_profile_id(request.profile_id, state)?;
    let mut profile = crate::shared::persistence::load_profile_checked(&profile_id)?;
    let rule = normalize_rule_value(request.rule, profile.rules.len() as i32)?;
    profile.rules.push(rule.clone());
    validate_profile_automation(&profile)?;
    crate::shared::persistence::save_profile(&profile)?;
    let backup_name = latest_backup_name(&profile.id)?;
    let post_revision = profile_revision(&profile)?;
    refresh_active_runtime(&profile, state)?;
    Ok(json!({
        "success": true,
        "rule": rule,
        "profileId": profile.id,
        "backupName": backup_name,
        "postRevision": post_revision
    }))
}

fn validate_rule(request: RuleRequest, state: &DaemonStateRef) -> Result<Value, String> {
    let profile_id = selected_profile_id(request.profile_id, state)?;
    let mut profile = crate::shared::persistence::load_profile_checked(&profile_id)?;
    let rule = normalize_rule_value(request.rule, profile.rules.len() as i32)?;
    profile.rules.push(rule.clone());
    validate_profile_automation(&profile)?;
    serde_json::to_value(rule).map_err(|error| error.to_string())
}

fn undo_install(request: UndoRequest, state: &DaemonStateRef) -> Result<Value, String> {
    let current = crate::shared::persistence::load_profile_checked(&request.profile_id)?;
    let revision = profile_revision(&current)?;
    if revision != request.expected_revision {
        return Err(format!(
            "AUTOMATION_UNDO_STALE: profile changed after installation (expected {}, current {})",
            request.expected_revision, revision
        ));
    }
    let restored = crate::shared::persistence::restore_profile_backup(
        &request.profile_id,
        &request.backup_name,
    )?;
    validate_profile_automation(&restored)?;
    refresh_active_runtime(&restored, state)?;
    Ok(json!({
        "success": true,
        "profileId": restored.id,
        "revision": profile_revision(&restored)?
    }))
}

pub async fn dispatch(
    method: &str,
    params: Option<Value>,
    state: &DaemonStateRef,
) -> Result<Value, String> {
    match method {
        "automation.validate" => {
            let request = parse_additions_request(params)?;
            let current = crate::shared::persistence::load_profile_checked(&request.profile_id)?;
            let candidate = candidate_with_additions(current, request.additions);
            validate_profile_automation(&candidate)?;
            Ok(json!({ "valid": true }))
        }
        "automation.install" => install_additions(parse_additions_request(params)?, state),
        "automation.validate_rule" => {
            let request: RuleRequest =
                serde_json::from_value(params.ok_or_else(|| "Missing parameters".to_string())?)
                    .map_err(|error| error.to_string())?;
            validate_rule(request, state)
        }
        "automation.append_rule" => {
            let request: RuleRequest =
                serde_json::from_value(params.ok_or_else(|| "Missing parameters".to_string())?)
                    .map_err(|error| error.to_string())?;
            append_rule(request, state)
        }
        "automation.undo_install" => {
            let request: UndoRequest =
                serde_json::from_value(params.ok_or_else(|| "Missing parameters".to_string())?)
                    .map_err(|error| error.to_string())?;
            undo_install(request, state)
        }
        _ => Err(format!("Unsupported automation method: {method}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schemas::frontend::{
        FrontendAction, FrontendCondition, FrontendTrigger, KeyChord, MacroPlayback,
    };

    fn base_profile() -> Profile {
        Profile {
            id: "p".into(),
            name: "P".into(),
            is_default: false,
            linked_apps: vec![],
            bindings: vec![],
            order: 0,
            rules: vec![],
            macros: vec![MacroDefinition {
                id: "m".into(),
                name: "Macro".into(),
                steps: vec![],
            }],
            layers: vec![LayerMeta {
                id: "l".into(),
                name: "Layer".into(),
            }],
            folders: vec![RuleFolder {
                id: "f".into(),
                name: "Folder".into(),
                parent_id: None,
                order: 0,
            }],
        }
    }

    fn valid_rule() -> FrontendRule {
        FrontendRule {
            id: "r".into(),
            name: Some("Rule".into()),
            trigger: FrontendTrigger::KeyDown {
                chord: KeyChord::single(65),
            },
            actions: vec![FrontendAction::RunMacro {
                macro_id: "m".into(),
                playback: MacroPlayback::default(),
            }],
            hold_actions: None,
            conditions: vec![FrontendCondition::LayerActive {
                layer_id: "l".into(),
            }],
            priority: 10,
            enabled: true,
            folder_id: Some("f".into()),
            order: 0,
        }
    }

    #[test]
    fn canonical_validator_accepts_valid_references() {
        let mut profile = base_profile();
        profile.rules.push(valid_rule());
        assert!(validate_profile_automation(&profile).is_ok());
    }

    #[test]
    fn canonical_validator_rejects_empty_actions() {
        let mut profile = base_profile();
        let mut rule = valid_rule();
        rule.actions.clear();
        profile.rules.push(rule);
        assert!(
            validate_profile_automation(&profile)
                .unwrap_err()
                .contains("at least one action")
        );
    }

    #[test]
    fn canonical_validator_rejects_dangling_macro_layer_and_folder() {
        for kind in ["macro", "layer", "folder"] {
            let mut profile = base_profile();
            let mut rule = valid_rule();
            match kind {
                "macro" => {
                    rule.actions = vec![FrontendAction::RunMacro {
                        macro_id: "missing".into(),
                        playback: MacroPlayback::default(),
                    }]
                }
                "layer" => {
                    rule.conditions = vec![FrontendCondition::LayerActive {
                        layer_id: "missing".into(),
                    }]
                }
                "folder" => rule.folder_id = Some("missing".into()),
                _ => unreachable!(),
            }
            profile.rules.push(rule);
            assert!(validate_profile_automation(&profile).is_err(), "{kind}");
        }
    }

    #[test]
    fn canonical_validator_rejects_folder_cycles() {
        let mut profile = base_profile();
        profile.folders = vec![
            RuleFolder {
                id: "a".into(),
                name: "A".into(),
                parent_id: Some("b".into()),
                order: 0,
            },
            RuleFolder {
                id: "b".into(),
                name: "B".into(),
                parent_id: Some("a".into()),
                order: 1,
            },
        ];
        assert!(
            validate_profile_automation(&profile)
                .unwrap_err()
                .contains("cycle")
        );
    }
}
