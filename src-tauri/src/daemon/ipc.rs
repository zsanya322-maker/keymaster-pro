/// IPC Named Pipe Server + JSON-RPC 2.0 Router
///
/// Listens to `\\.\pipe\keymaster-pro-ipc`, accepts JSON-RPC 2.0 requests
/// from GUI and routes them to handlers.
///
/// Protocol: Newline-delimited JSON (one JSON line + \n per message).

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tracing::{info, warn};

use crate::daemon::state::DaemonStateRef;
use crate::shared::constants;

use super::ipc_types::*;

fn pipe_options(first_instance: bool) -> ServerOptions {
    let mut options = ServerOptions::new();
    options
        .first_pipe_instance(first_instance)
        .max_instances(16)
        .out_buffer_size(65536)
        .in_buffer_size(65536);
    options
}

/// Захватить первый Named Pipe instance эксклюзивно.
///
/// Вызывается runner'ом синхронно внутри Tokio runtime ДО запуска simulator,
/// context tracker и global hooks. Поэтому второй daemon не успевает даже
/// временно установить второй hook engine.
pub fn reserve_first_pipe_instance() -> Result<NamedPipeServer, String> {
    let pipe_path = constants::IPC_PIPE_NAME;
    let server = pipe_options(true).create(pipe_path).map_err(|e| {
        format!(
            "Не удалось получить first Named Pipe instance '{}': {}. Вероятно, другой daemon уже запущен.",
            pipe_path, e
        )
    })?;
    info!("IPC: first pipe instance acquired exclusively");
    Ok(server)
}

/// Start the IPC server using an already-reserved first pipe instance.
pub async fn start_ipc_server(
    state: DaemonStateRef,
    mut server: NamedPipeServer,
) -> Result<(), String> {
    let pipe_path = constants::IPC_PIPE_NAME;
    info!("IPC сервер запускается на {}", pipe_path);

    loop {
        info!("IPC: waiting for client connection...");
        if let Err(e) = server.connect().await {
            warn!("Connection error: {}. Recreating listener in 50ms...", e);
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            server = loop {
                match pipe_options(false).create(pipe_path) {
                    Ok(next) => break next,
                    Err(create_error) => {
                        warn!("Failed to recreate Named Pipe listener: {}. Retrying in 100ms...", create_error);
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                }
            };
            continue;
        }
        info!("IPC: client connected");

        let state_for_client = state.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_client(server, state_for_client).await {
                warn!("IPC: client handling error: {}", e);
            }
        });

        server = loop {
            match pipe_options(false).create(pipe_path) {
                Ok(next) => break next,
                Err(e) => {
                    warn!("Failed to create next Named Pipe instance: {}. Retrying in 100ms...", e);
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        };
    }
}

/// Handle client connection.
///
/// Reads JSON-RPC requests line by line and sends responses.
async fn handle_client(pipe: NamedPipeServer, state: DaemonStateRef) -> Result<(), String> {
    let (reader, mut writer) = tokio::io::split(pipe);
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("Read error: {}", e))?
    {
        if line.is_empty() {
            continue;
        }

        let parsed = serde_json::from_str::<JsonRpcRequest>(&line);
        match parsed {
            Ok(req) => {
                if req.method == "subscribe_events" {
                    let id = req.id.unwrap_or(serde_json::Value::Null);
                    let response = JsonRpcResponse::success(
                        serde_json::json!({ "subscribed": true }),
                        id,
                    );
                    let mut response_bytes = serde_json::to_string(&response)
                        .map_err(|e| format!("Serialization error: {}", e))?;
                    response_bytes.push('\n');
                    writer
                        .write_all(response_bytes.as_bytes())
                        .await
                        .map_err(|e| format!("Send error: {}", e))?;
                    writer
                        .flush()
                        .await
                        .map_err(|e| format!("Flush error: {}", e))?;

                    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                    {
                        let mut listeners = crate::gui::events::EVENT_LISTENERS
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        listeners.push(tx);
                    }

                    while let Some(event_msg) = rx.recv().await {
                        if let Err(e) = writer.write_all(event_msg.as_bytes()).await {
                            warn!("IPC Event write error: {}", e);
                            break;
                        }
                        if let Err(e) = writer.flush().await {
                            warn!("IPC Event flush error: {}", e);
                            break;
                        }
                    }
                    return Ok(());
                } else {
                    // Shutdown is special: acknowledge and flush the JSON-RPC response
                    // before posting WM_QUIT. Otherwise a correct shutdown can look like
                    // a broken pipe to the GUI.
                    let shutdown_after_response = req.method == "shutdown";
                    let response = route_request(req, &state).await;
                    let mut response_bytes = serde_json::to_string(&response)
                        .map_err(|e| format!("Serialization error: {}", e))?;
                    response_bytes.push('\n');

                    let send_result: Result<(), String> = async {
                        writer
                            .write_all(response_bytes.as_bytes())
                            .await
                            .map_err(|e| format!("Send error: {}", e))?;
                        writer
                            .flush()
                            .await
                            .map_err(|e| format!("Flush error: {}", e))?;
                        Ok(())
                    }
                    .await;

                    if shutdown_after_response {
                        crate::daemon::runner::request_shutdown();
                    }

                    send_result?;
                    if shutdown_after_response {
                        return Ok(());
                    }
                }
            }
            Err(e) => {
                warn!("IPC: invalid JSON-RPC: {}", e);
                let response = JsonRpcResponse::error(
                    PARSE_ERROR,
                    format!("Parse error: {}", e),
                    serde_json::Value::Null,
                );
                let mut response_bytes = serde_json::to_string(&response)
                    .map_err(|e| format!("Serialization error: {}", e))?;
                response_bytes.push('\n');
                writer
                    .write_all(response_bytes.as_bytes())
                    .await
                    .map_err(|e| format!("Send error: {}", e))?;
                writer
                    .flush()
                    .await
                    .map_err(|e| format!("Flush error: {}", e))?;
            }
        }
    }

    Ok(())
}

/// Route JSON-RPC request to handler
async fn route_request(req: JsonRpcRequest, state: &DaemonStateRef) -> JsonRpcResponse {
    let id = req.id.unwrap_or(serde_json::Value::Null);

    info!("IPC → {} (id={})", req.method, id);

    let result = match req.method.as_str() {
        // === System ===
        "ping" => Ok(serde_json::json!({ "pong": true })),
        "get_status" => handle_get_status(state).await,
        "shutdown" => handle_shutdown(state).await,

        // === Legacy profile aliases ===
        "get_active_profile" => handle_get_active_profile(state).await,
        "set_active_profile" => handle_set_active_profile(state, req.params).await,
        "list_profiles" => handle_list_profiles().await,

        // === Legacy config aliases ===
        "get_config" => handle_get_config(state).await,
        "update_config" => handle_update_config(state, req.params).await,

        // === Canonical router ===
        _ => match crate::daemon::router::dispatch(req.method.as_str(), req.params, state).await {
            Ok(val) => Ok(val),
            Err(err) => {
                warn!("IPC Router error for {}: {}", req.method, err);
                Err(JsonRpcError {
                    code: INTERNAL_ERROR,
                    message: err,
                    data: None,
                })
            }
        },
    };

    match result {
        Ok(value) => JsonRpcResponse::success(value, id),
        Err(err) => JsonRpcResponse::error(err.code, err.message, id),
    }
}

fn filetime_to_u64(ft: &windows::Win32::Foundation::FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

fn get_current_cpu_usage_percent(state: &DaemonStateRef) -> f64 {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes, GetSystemTimes};

    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();

    unsafe {
        if GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
        .is_err()
        {
            return 0.0;
        }
        let mut sys_idle = FILETIME::default();
        let mut sys_kernel = FILETIME::default();
        let mut sys_user = FILETIME::default();
        if GetSystemTimes(
            Some(&mut sys_idle),
            Some(&mut sys_kernel),
            Some(&mut sys_user),
        )
        .is_err()
        {
            return 0.0;
        }

        let proc_t = filetime_to_u64(&kernel) + filetime_to_u64(&user);
        let sys_t = filetime_to_u64(&sys_kernel) + filetime_to_u64(&sys_user);

        let now = std::time::Instant::now();

        if let Ok(s) = state.read() {
            if let Ok(mut last_lock) = s.cpu_tracking.lock() {
                if let Some((last_proc, last_sys, last_time)) = *last_lock {
                    let proc_diff = proc_t.saturating_sub(last_proc);
                    let sys_diff = sys_t.saturating_sub(last_sys);
                    let time_diff = now.duration_since(last_time).as_secs_f64();

                    *last_lock = Some((proc_t, sys_t, now));

                    if sys_diff > 0 && time_diff > 0.0 {
                        let usage = (proc_diff as f64 / sys_diff as f64) * 100.0;
                        return (usage * 100.0).round() / 100.0;
                    }
                } else {
                    *last_lock = Some((proc_t, sys_t, now));
                }
            }
        }
    }
    0.0
}

fn get_current_ram_usage_mb() -> f64 {
    use windows::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    let mut counters = PROCESS_MEMORY_COUNTERS::default();
    unsafe {
        if GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
        .is_ok()
        {
            let bytes = counters.WorkingSetSize;
            let mb = bytes as f64 / 1024.0 / 1024.0;
            return (mb * 10.0).round() / 10.0;
        }
    }
    0.0
}

// === Command Handlers ===

/// Get current daemon status
async fn handle_get_status(state: &DaemonStateRef) -> Result<serde_json::Value, JsonRpcError> {
    // CPU tracking acquires state internally. Compute it before taking the
    // snapshot lock below so get_status never recursively acquires the same
    // Windows RwLock on one request path.
    let cpu_usage = get_current_cpu_usage_percent(state);
    let ram_usage = get_current_ram_usage_mb();

    let s = state.read().map_err(|_| JsonRpcError {
        code: INTERNAL_ERROR,
        message: "Failed to read state".into(),
        data: None,
    })?;

    Ok(serde_json::json!({
        "running": s.running,
        "pid": std::process::id(),
        "version": env!("CARGO_PKG_VERSION"),
        "hooks_installed": s.hooks_installed,
        "kb_hook_enabled": s.kb_hook_enabled,
        "mouse_hook_enabled": s.mouse_hook_enabled,
        "active_profile_id": s.active_profile_id,
        "active_layers": s.active_layers,
        "cpu_usage": cpu_usage,
        "memory_usage_mb": ram_usage,
        "keystrokes_processed": s.keystrokes_processed.load(std::sync::atomic::Ordering::Relaxed),
        "last_latency_us": s.last_latency_us.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

/// Mark daemon shutdown as requested. The actual WM_QUIT is posted by
/// handle_client only after the JSON-RPC response has been flushed.
async fn handle_shutdown(state: &DaemonStateRef) -> Result<serde_json::Value, JsonRpcError> {
    info!("IPC: shutdown command received");

    let mut s = state.write().map_err(|_| JsonRpcError {
        code: INTERNAL_ERROR,
        message: "Failed to write state".into(),
        data: None,
    })?;
    s.running = false;

    Ok(serde_json::json!({
        "success": true,
        "message": "Daemon shutting down"
    }))
}

/// Get active profile ID (legacy alias).
async fn handle_get_active_profile(
    state: &DaemonStateRef,
) -> Result<serde_json::Value, JsonRpcError> {
    let s = state.read().map_err(|_| JsonRpcError {
        code: INTERNAL_ERROR,
        message: "Failed to read state".into(),
        data: None,
    })?;

    Ok(serde_json::json!({
        "profile_id": s.active_profile_id
    }))
}

/// Set active profile ID (legacy alias).
///
/// Do not mutate only `active_profile_id`: that used to leave the compiled
/// engine schema and persisted config pointing at different profiles. Translate
/// the old request into the canonical profile.activate command instead.
async fn handle_set_active_profile(
    state: &DaemonStateRef,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, JsonRpcError> {
    let params = params.ok_or(JsonRpcError {
        code: INVALID_PARAMS,
        message: "Missing params".into(),
        data: None,
    })?;

    let profile_id = params
        .get("profile_id")
        .and_then(|v| v.as_str())
        .ok_or(JsonRpcError {
            code: INVALID_PARAMS,
            message: "Missing 'profile_id'".into(),
            data: None,
        })?;

    crate::daemon::router::dispatch(
        "profile.activate",
        Some(serde_json::json!({ "id": profile_id })),
        state,
    )
    .await
    .map_err(|message| JsonRpcError {
        code: INTERNAL_ERROR,
        message,
        data: None,
    })?;

    info!("IPC legacy set_active_profile -> {}", profile_id);
    Ok(serde_json::json!({
        "success": true,
        "profile_id": profile_id
    }))
}

/// List profile IDs (legacy alias).
async fn handle_list_profiles() -> Result<serde_json::Value, JsonRpcError> {
    match crate::shared::persistence::list_profiles() {
        Ok(profiles) => Ok(serde_json::json!({
            "profiles": profiles
        })),
        Err(e) => Err(JsonRpcError {
            code: INTERNAL_ERROR,
            message: format!("Failed to list profiles: {}", e),
            data: None,
        }),
    }
}

/// Get daemon configuration (legacy alias).
async fn handle_get_config(_state: &DaemonStateRef) -> Result<serde_json::Value, JsonRpcError> {
    match crate::shared::config::load_config() {
        Ok(config) => Ok(serde_json::to_value(config).unwrap_or(serde_json::Value::Null)),
        Err(e) => Err(JsonRpcError {
            code: INTERNAL_ERROR,
            message: format!("Failed to load config: {}", e),
            data: None,
        }),
    }
}

/// Update daemon configuration (legacy alias).
async fn handle_update_config(
    state: &DaemonStateRef,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, JsonRpcError> {
    let params = params.ok_or_else(|| JsonRpcError {
        code: INVALID_PARAMS,
        message: "Missing parameters".to_string(),
        data: None,
    })?;
    let obj = params.as_object().ok_or_else(|| JsonRpcError {
        code: INVALID_PARAMS,
        message: "Configuration update must be a JSON object".to_string(),
        data: None,
    })?;

    let mut config = crate::shared::config::load_config().map_err(|e| JsonRpcError {
        code: INTERNAL_ERROR,
        message: format!("Failed to load config: {}", e),
        data: None,
    })?;

    let old_timeout = config.tap_hold_timeout_ms;

    if let Some(lang) = obj.get("language").and_then(|v| v.as_str()) {
        config.language = lang.to_string();
    }
    if let Some(theme) = obj.get("theme").and_then(|v| v.as_str()) {
        config.theme = theme.to_string();
    }
    if let Some(autostart) = obj.get("autostart").and_then(|v| v.as_bool()) {
        config.autostart = autostart;
    }
    if let Some(minimize) = obj.get("minimizeToTray").and_then(|v| v.as_bool()) {
        config.minimize_to_tray = minimize;
    }
    if let Some(kb) = obj.get("kbHookEnabled").and_then(|v| v.as_bool()) {
        config.kb_hook_enabled = kb;
    }
    if let Some(mouse) = obj.get("mouseHookEnabled").and_then(|v| v.as_bool()) {
        config.mouse_hook_enabled = mouse;
    }
    if let Some(debug) = obj.get("debugMode").and_then(|v| v.as_bool()) {
        config.debug_mode = debug;
    }
    if let Some(active_id) = obj.get("activeProfileId").and_then(|v| v.as_str()) {
        let exists = crate::shared::persistence::list_profiles()
            .map_err(|e| JsonRpcError {
                code: INTERNAL_ERROR,
                message: format!("Failed to list profiles: {}", e),
                data: None,
            })?
            .iter()
            .any(|id| id == active_id);
        if !exists {
            return Err(JsonRpcError {
                code: INVALID_PARAMS,
                message: format!("Profile '{}' does not exist", active_id),
                data: None,
            });
        }
        config.active_profile_id = active_id.to_string();
    }
    if let Some(scale) = obj.get("scale").and_then(|v| v.as_f64()) {
        config.scale = scale;
    }
    if let Some(restore) = obj.get("restoreMouseAfterMacro").and_then(|v| v.as_bool()) {
        config.restore_mouse_after_macro = restore;
    }
    if let Some(onboarding) = obj.get("onboardingComplete").and_then(|v| v.as_bool()) {
        config.onboarding_complete = onboarding;
    }
    if let Some(timeout) = obj.get("tapHoldTimeoutMs").and_then(|v| v.as_u64()) {
        config.tap_hold_timeout_ms = timeout;
    }
    if let Some(font_size) = obj.get("fontSize").and_then(|v| v.as_u64()) {
        config.font_size = font_size as u32;
    }
    if let Some(row_padding) = obj.get("rowPadding").and_then(|v| v.as_u64()) {
        config.row_padding = row_padding as u32;
    }

    crate::shared::config::save_config(&config).map_err(|e| JsonRpcError {
        code: INTERNAL_ERROR,
        message: format!("Failed to save config: {}", e),
        data: None,
    })?;

    if let Ok(mut s) = state.write() {
        s.kb_hook_enabled = config.kb_hook_enabled;
        s.mouse_hook_enabled = config.mouse_hook_enabled;
        s.restore_mouse_after_macro = config.restore_mouse_after_macro;

        if config.tap_hold_timeout_ms != old_timeout {
            if let Some(ref prof) = s.active_profile {
                let frontend_config = crate::schemas::frontend::FrontendConfig {
                    rules: prof.rules.clone(),
                    layers: prof.layers.clone(),
                    tap_hold_timeout_ms: config.tap_hold_timeout_ms,
                };
                s.engine_schema = crate::daemon::compiler::compile_schema(&frontend_config);
            }
        }
    }

    Ok(serde_json::json!({ "success": true }))
}
