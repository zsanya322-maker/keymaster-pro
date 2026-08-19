//! KeyMaster Pro MCP bridge.
//!
//! `--mcp` exposes inspection/validation tools only. `--mcp-write` is an
//! explicit opt-in that additionally exposes profile activation, macro execution
//! and rule application. The transport is newline-delimited JSON-RPC over stdio.

use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::io::{BufRead, Write};

const MODERN_PROTOCOL: &str = "2026-07-28";
const LEGACY_PROTOCOL: &str = "2025-11-25";

#[derive(Debug, Deserialize)]
struct RpcRequest {
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.into() }
    })
}

fn tool_result(value: Value) -> Value {
    let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
    json!({
        "resultType": "complete",
        "content": [{ "type": "text", "text": text }],
        "structuredContent": value,
        "isError": false
    })
}

fn tool_failure(message: impl Into<String>) -> Value {
    json!({
        "resultType": "complete",
        "content": [{ "type": "text", "text": message.into() }],
        "isError": true
    })
}

fn tool_definition(
    name: &str,
    description: &str,
    properties: Value,
    required: &[&str],
    read_only: bool,
) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        },
        "annotations": {
            "readOnlyHint": read_only,
            "destructiveHint": false,
            "idempotentHint": read_only
        }
    })
}

fn tool_catalog(write_enabled: bool) -> Vec<Value> {
    let mut catalog = vec![
        tool_definition(
            "keymaster_list_profiles",
            "List KeyMaster profiles and compact rule/macro/layer counts.",
            json!({}),
            &[],
            true,
        ),
        tool_definition(
            "keymaster_get_profile",
            "Read a complete KeyMaster profile. Omit id to read the active profile.",
            json!({ "id": { "type": "string" } }),
            &[],
            true,
        ),
        tool_definition(
            "keymaster_runtime_status",
            "Read active/preferred profile plus auto-switch/manual-lock state.",
            json!({}),
            &[],
            true,
        ),
        tool_definition(
            "keymaster_validate_rule",
            "Validate and normalize a KeyMaster rule without saving it.",
            json!({ "rule": { "type": "object" } }),
            &["rule"],
            true,
        ),
    ];

    if write_enabled {
        catalog.extend([
            tool_definition(
                "keymaster_activate_profile",
                "Activate a KeyMaster profile. This changes runtime/preferred profile state.",
                json!({ "id": { "type": "string" } }),
                &["id"],
                false,
            ),
            tool_definition(
                "keymaster_run_macro",
                "Run a macro through KeyMaster's production macro preview path.",
                json!({
                    "macroId": { "type": "string" },
                    "profileId": { "type": "string" },
                    "speed": { "type": "number", "minimum": 0.05, "maximum": 20 },
                    "repeatCount": { "type": "integer", "minimum": 1, "maximum": 100 }
                }),
                &["macroId"],
                false,
            ),
            tool_definition(
                "keymaster_apply_rule",
                "Validate and append one rule to a profile. KeyMaster replaces id/order. Call only after explicit user approval.",
                json!({
                    "profileId": { "type": "string" },
                    "rule": { "type": "object" }
                }),
                &["rule"],
                false,
            ),
        ]);
    }

    catalog
}

fn arguments(params: Option<&Value>) -> Map<String, Value> {
    params
        .and_then(|value| value.get("arguments"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

async fn profile_list() -> Result<Value, String> {
    crate::daemon::ipc_client::call("profile.list", None).await
}

fn profiles_from_list(value: &Value) -> Result<Vec<crate::shared::types::Profile>, String> {
    let profiles = value
        .get("profiles")
        .cloned()
        .ok_or_else(|| "profile.list response has no profiles".to_string())?;
    serde_json::from_value(profiles).map_err(|error| format!("Invalid profile.list payload: {error}"))
}

fn active_id(value: &Value) -> Option<String> {
    value.get("active").and_then(Value::as_str).map(str::to_string)
}

fn resolve_profile(
    list: &Value,
    requested: Option<&str>,
) -> Result<crate::shared::types::Profile, String> {
    let id = requested
        .map(str::to_string)
        .or_else(|| active_id(list))
        .ok_or_else(|| "No active profile".to_string())?;
    profiles_from_list(list)?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| format!("Profile not found: {id}"))
}

fn normalize_rule_value(
    mut value: Value,
    order: i32,
) -> Result<crate::schemas::frontend::FrontendRule, String> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| "rule must be an object".to_string())?;
    object.insert("id".to_string(), json!(uuid::Uuid::new_v4().to_string()));
    object.insert("order".to_string(), json!(order));
    object.entry("priority".to_string()).or_insert(json!(10));
    object.entry("enabled".to_string()).or_insert(json!(true));
    object.entry("conditions".to_string()).or_insert(json!([]));
    object.entry("holdActions".to_string()).or_insert(Value::Null);
    object.entry("folderId".to_string()).or_insert(Value::Null);
    serde_json::from_value(value).map_err(|error| format!("Invalid KeyMaster rule: {error}"))
}

fn validate_rule_references(
    rule: &crate::schemas::frontend::FrontendRule,
    profile: &crate::shared::types::Profile,
) -> Result<(), String> {
    use crate::schemas::frontend::{FrontendAction, FrontendCondition};
    let macro_ids = profile
        .macros
        .iter()
        .map(|item| item.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let layer_ids = profile
        .layers
        .iter()
        .map(|item| item.id.as_str())
        .collect::<std::collections::HashSet<_>>();

    for action in rule.actions.iter().chain(rule.hold_actions.iter().flatten()) {
        match action {
            FrontendAction::RunMacro { macro_id, .. } if !macro_ids.contains(macro_id.as_str()) => {
                return Err(format!("Unknown macroId: {macro_id}"));
            }
            FrontendAction::ToggleLayer { layer_id } | FrontendAction::HoldLayer { layer_id }
                if !layer_ids.contains(layer_id.as_str()) =>
            {
                return Err(format!("Unknown layerId: {layer_id}"));
            }
            _ => {}
        }
    }

    for condition in &rule.conditions {
        if let FrontendCondition::LayerActive { layer_id } = condition {
            if !layer_ids.contains(layer_id.as_str()) {
                return Err(format!("Unknown layerId: {layer_id}"));
            }
        }
    }
    Ok(())
}

async fn list_profiles_tool() -> Result<Value, String> {
    let list = profile_list().await?;
    let active = active_id(&list);
    let compact = profiles_from_list(&list)?
        .into_iter()
        .map(|profile| {
            let is_active = active.as_deref() == Some(profile.id.as_str());
            json!({
                "id": profile.id,
                "name": profile.name,
                "active": is_active,
                "isDefault": profile.is_default,
                "rules": profile.rules.len(),
                "macros": profile.macros.len(),
                "layers": profile.layers.len()
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "profiles": compact }))
}

async fn get_profile_tool(args: &Map<String, Value>) -> Result<Value, String> {
    let list = profile_list().await?;
    let requested = args.get("id").and_then(Value::as_str);
    let profile = resolve_profile(&list, requested)?;
    serde_json::to_value(profile).map_err(|error| error.to_string())
}

async fn validate_rule_tool(args: &Map<String, Value>) -> Result<Value, String> {
    let value = args
        .get("rule")
        .cloned()
        .ok_or_else(|| "Missing rule".to_string())?;
    let rule = normalize_rule_value(value, 0)?;
    serde_json::to_value(rule).map_err(|error| error.to_string())
}

async fn activate_profile_tool(args: &Map<String, Value>) -> Result<Value, String> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing id".to_string())?;
    crate::daemon::ipc_client::call("profile.activate", Some(json!({ "id": id }))).await
}

async fn run_macro_tool(args: &Map<String, Value>) -> Result<Value, String> {
    let macro_id = args
        .get("macroId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing macroId".to_string())?;
    let list = profile_list().await?;
    let profile = resolve_profile(&list, args.get("profileId").and_then(Value::as_str))?;
    let macro_def = profile
        .macros
        .into_iter()
        .find(|item| item.id == macro_id)
        .ok_or_else(|| format!("Macro not found: {macro_id}"))?;
    let speed = args
        .get("speed")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.05, 20.0);
    let repeat_count = args
        .get("repeatCount")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 100) as u32;

    crate::daemon::ipc_client::call(
        "macro.preview",
        Some(json!({
            "steps": macro_def.steps,
            "playback": {
                "speed": speed,
                "repeatCount": repeat_count,
                "repeatWhileHeld": false
            }
        })),
    )
    .await
}

async fn apply_rule_tool(args: &Map<String, Value>) -> Result<Value, String> {
    let list = profile_list().await?;
    let mut profile = resolve_profile(&list, args.get("profileId").and_then(Value::as_str))?;
    let value = args
        .get("rule")
        .cloned()
        .ok_or_else(|| "Missing rule".to_string())?;
    let rule = normalize_rule_value(value, profile.rules.len() as i32)?;
    validate_rule_references(&rule, &profile)?;
    let result_rule = serde_json::to_value(&rule).map_err(|error| error.to_string())?;
    profile.rules.push(rule);
    crate::daemon::ipc_client::call(
        "profile.save",
        Some(serde_json::to_value(profile).map_err(|error| error.to_string())?),
    )
    .await?;
    Ok(json!({ "success": true, "rule": result_rule }))
}

async fn call_tool(name: &str, params: Option<&Value>, write_enabled: bool) -> Value {
    let args = arguments(params);
    let result = match name {
        "keymaster_list_profiles" => list_profiles_tool().await,
        "keymaster_get_profile" => get_profile_tool(&args).await,
        "keymaster_runtime_status" => crate::daemon::ipc_client::call("profile.runtime_status", None).await,
        "keymaster_validate_rule" => validate_rule_tool(&args).await,
        "keymaster_activate_profile" if write_enabled => activate_profile_tool(&args).await,
        "keymaster_run_macro" if write_enabled => run_macro_tool(&args).await,
        "keymaster_apply_rule" if write_enabled => apply_rule_tool(&args).await,
        "keymaster_activate_profile" | "keymaster_run_macro" | "keymaster_apply_rule" => Err(
            "This MCP process is read-only. Use --mcp-write only when write/execute access is explicitly intended."
                .to_string(),
        ),
        _ => Err(format!("Unknown tool: {name}")),
    };

    match result {
        Ok(value) => tool_result(value),
        Err(error) => tool_failure(error),
    }
}

async fn handle_request(request: RpcRequest, write_enabled: bool) -> Option<Value> {
    let id = request.id.clone();

    if request.method == "notifications/initialized" {
        return None;
    }

    match request.method.as_str() {
        "server/discover" => id.map(|id| {
            rpc_result(
                id,
                json!({
                    "resultType": "complete",
                    "supportedVersions": [MODERN_PROTOCOL],
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "KeyMaster Pro", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": if write_enabled {
                        "KeyMaster MCP bridge with explicit write/execute tools enabled. Read and validate before mutating."
                    } else {
                        "KeyMaster MCP bridge in read-only mode. Inspect profiles and validate proposed rules."
                    },
                    "ttlMs": 60_000,
                    "cacheScope": "private"
                }),
            )
        }),
        "initialize" => id.map(|id| {
            let requested = request
                .params
                .as_ref()
                .and_then(|params| params.get("protocolVersion"))
                .and_then(Value::as_str)
                .unwrap_or(LEGACY_PROTOCOL);
            let negotiated = if matches!(
                requested,
                "2025-11-25" | "2025-06-18" | "2025-03-26" | "2024-11-05"
            ) {
                requested
            } else {
                LEGACY_PROTOCOL
            };
            rpc_result(
                id,
                json!({
                    "protocolVersion": negotiated,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "KeyMaster Pro", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "KeyMaster automation bridge"
                }),
            )
        }),
        "tools/list" => id.map(|id| {
            rpc_result(
                id,
                json!({
                    "resultType": "complete",
                    "tools": tool_catalog(write_enabled),
                    "ttlMs": 30_000,
                    "cacheScope": "private"
                }),
            )
        }),
        "tools/call" => {
            let Some(id) = id else { return None };
            let Some(name) = request
                .params
                .as_ref()
                .and_then(|params| params.get("name"))
                .and_then(Value::as_str)
            else {
                return Some(rpc_error(id, -32602, "tools/call missing params.name"));
            };
            let result = call_tool(name, request.params.as_ref(), write_enabled).await;
            Some(rpc_result(id, result))
        }
        _ => id.map(|id| rpc_error(id, -32601, format!("Method not found: {}", request.method))),
    }
}

pub fn run_stdio(write_enabled: bool) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Failed to create MCP runtime: {error}"))?;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();

    for line in stdin.lock().lines() {
        let line = line.map_err(|error| format!("MCP stdin error: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => runtime.block_on(handle_request(request, write_enabled)),
            Err(error) => Some(rpc_error(Value::Null, -32700, format!("Parse error: {error}"))),
        };
        if let Some(response) = response {
            let encoded = serde_json::to_string(&response)
                .map_err(|error| format!("MCP response serialization failed: {error}"))?;
            stdout
                .write_all(encoded.as_bytes())
                .and_then(|_| stdout.write_all(b"\n"))
                .and_then(|_| stdout.flush())
                .map_err(|error| format!("MCP stdout error: {error}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_catalog_hides_mutators() {
        let names = tool_catalog(false)
            .into_iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>();
        assert!(names.contains(&"keymaster_list_profiles".to_string()));
        assert!(!names.contains(&"keymaster_apply_rule".to_string()));
        assert!(!names.contains(&"keymaster_run_macro".to_string()));
    }

    #[test]
    fn write_catalog_requires_explicit_mode() {
        let names = tool_catalog(true)
            .into_iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>();
        assert!(names.contains(&"keymaster_apply_rule".to_string()));
        assert!(names.contains(&"keymaster_run_macro".to_string()));
    }
}
