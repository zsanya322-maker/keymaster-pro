use crate::context::AppContext;
use crate::daemon::state::DaemonStateRef;
use crate::schemas::frontend::FrontendConfig;
use crate::shared::types::{MatchMode, Profile, ProfileBinding};

fn contains_ci(value: &str, needle: &str) -> bool {
    value.to_lowercase().contains(&needle.to_lowercase())
}

pub fn binding_matches(binding: &ProfileBinding, ctx: &AppContext) -> bool {
    let mut checks = Vec::new();
    if let Some(value) = binding.process.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(ctx.active_process.eq_ignore_ascii_case(value.trim()));
    }
    if let Some(value) = binding.path.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(contains_ci(&ctx.active_process_path, value.trim()));
    }
    if let Some(value) = binding.title.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(contains_ci(&ctx.active_window_title, value.trim()));
    }
    if let Some(value) = binding.class_name.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(ctx.active_window_class.eq_ignore_ascii_case(value.trim()));
    }
    if let Some(value) = binding
        .virtual_desktop_id
        .as_ref()
        .filter(|v| !v.trim().is_empty())
    {
        checks.push(ctx.virtual_desktop_id.eq_ignore_ascii_case(value.trim()));
    }
    if let Some(value) = binding.monitor_id.as_ref().filter(|v| !v.trim().is_empty()) {
        checks.push(ctx.monitor_id == value.trim());
    }
    if let Some(value) = binding.fullscreen {
        checks.push(ctx.fullscreen == value);
    }

    if checks.is_empty() {
        return false;
    }
    match binding.mode {
        MatchMode::Any => checks.iter().any(|value| *value),
        MatchMode::All => checks.iter().all(|value| *value),
    }
}

pub fn profile_matches(profile: &Profile, ctx: &AppContext) -> bool {
    if !profile.bindings.is_empty() {
        return profile
            .bindings
            .iter()
            .any(|binding| binding_matches(binding, ctx));
    }
    profile
        .linked_apps
        .iter()
        .any(|process| ctx.active_process.eq_ignore_ascii_case(process))
}

pub fn activate_runtime(state: &DaemonStateRef, profile: Profile) -> Result<(), String> {
    let schema = crate::daemon::compiler::compile_schema(&FrontendConfig {
        rules: profile.rules.clone(),
        layers: profile.layers.clone(),
        tap_hold_timeout_ms: 200,
    });
    let mut daemon = state
        .write()
        .map_err(|_| "Failed to lock daemon state".to_string())?;
    daemon.active_profile_id = profile.id.clone();
    daemon.engine_schema = schema;
    daemon.active_profile = Some(profile);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binding_any_and_all_cover_every_context_field() {
        let ctx = AppContext {
            active_process: "code.exe".into(),
            active_process_path: "C:\\Apps\\Code.exe".into(),
            active_window_title: "Project - Code".into(),
            active_window_class: "Chrome_WidgetWin_1".into(),
            virtual_desktop_id: "desktop-a".into(),
            monitor_id: "0,0,1920,1080".into(),
            fullscreen: true,
            ..Default::default()
        };
        let all = ProfileBinding {
            process: Some("CODE.EXE".into()),
            path: Some("apps\\code".into()),
            title: Some("project".into()),
            class_name: Some("chrome_widgetwin_1".into()),
            virtual_desktop_id: Some("DESKTOP-A".into()),
            monitor_id: Some("0,0,1920,1080".into()),
            fullscreen: Some(true),
            mode: MatchMode::All,
        };
        assert!(binding_matches(&all, &ctx));

        let mut broken_all = all.clone();
        broken_all.monitor_id = Some("wrong-monitor".into());
        assert!(!binding_matches(&broken_all, &ctx));

        broken_all.mode = MatchMode::Any;
        assert!(binding_matches(&broken_all, &ctx));
    }

    #[test]
    fn empty_structured_binding_does_not_match() {
        assert!(!binding_matches(
            &ProfileBinding::default(),
            &AppContext::default()
        ));
    }
}
