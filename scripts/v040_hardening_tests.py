from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


# Advanced state resets its volatile matching history on foreground-window changes,
# while preserving suppressed key-up bookkeeping so captured leader keys never leak
# a release event without their swallowed down event.
p = 'src-tauri/src/daemon/input_state.rs'
replace_once(
    p,
    '''pub struct AdvancedInputState {
    sequence: VecDeque<TimedKey>,''',
    '''pub struct AdvancedInputState {
    window_id: isize,
    sequence: VecDeque<TimedKey>,'''
)
replace_once(
    p,
    '''impl AdvancedInputState {
    pub fn reset(&mut self) {
        self.sequence.clear();''',
    '''impl AdvancedInputState {
    pub fn reset(&mut self) {
        self.window_id = 0;
        self.sequence.clear();'''
)
replace_once(
    p,
    '''        self.gesture = None;
    }

    pub fn expire(&mut self, now: Instant, sequence_timeout_ms: u32, leader_timeout_ms: u32) {''',
    '''        self.gesture = None;
    }

    pub fn prepare_window(&mut self, window_id: isize) {
        if self.window_id == window_id {
            return;
        }
        self.window_id = window_id;
        self.sequence.clear();
        self.leader = None;
        self.held_keys.clear();
        self.fired_chords.clear();
        self.gesture = None;
        // `suppressed_keyups` intentionally survives until physical release.
    }

    pub fn expire(&mut self, now: Instant, sequence_timeout_ms: u32, leader_timeout_ms: u32) {'''
)
replace_once(
    p,
    '''    fn sequence_timeout_is_per_match() {''',
    '''    fn window_change_clears_matching_history_but_keeps_suppressed_releases() {
        let mut state = AdvancedInputState::default();
        let now = t0();
        state.prepare_window(1);
        state.push_sequence(0x41, now);
        state.start_leader(KeyChord { code: 0x14, modifiers: 0 }, now);
        state.suppress_keyup(0x46);
        state.key_down(0x4A, now);
        state.prepare_window(2);
        assert!(!state.sequence_matches(&[0x41], now, 1000));
        assert!(!state.leader_active());
        assert!(state.key_up(0x46));
        assert!(!state.chord_should_fire(99, &[0x4A, 0x4B], 100));
    }

    #[test]
    fn sequence_timeout_is_per_match() {'''
)

# Engine prepares advanced state against the same normalized foreground window used
# by text expansion/context conditions.
p = 'src-tauri/src/daemon/engine.rs'
replace_once(
    p,
    '''        let max_sequence_timeout = engine_schema
            .key_sequence_rules''',
    '''        let window_id = try_read_ctx(&ctx_arc)
            .map(|ctx| ctx.active_window_id)
            .unwrap_or(0);
        let max_sequence_timeout = engine_schema
            .key_sequence_rules'''
)
replace_once(
    p,
    '''        if let Ok(mut input) = s.advanced_input.lock() {
            input.expire(now, max_sequence_timeout, max_leader_timeout);''',
    '''        if let Ok(mut input) = s.advanced_input.lock() {
            input.prepare_window(window_id);
            input.expire(now, max_sequence_timeout, max_leader_timeout);'''
)
# Prepare mouse gesture state on current foreground window before move/down/up use.
replace_once(
    p,
    '''    let ctx_arc = match crate::trackers::context_tracker::get_context() {
        Some(c) => c,
        None => return EventAction::PassThrough,
    };

    // Wheel/hwheel are standalone source events,''',
    '''    let ctx_arc = match crate::trackers::context_tracker::get_context() {
        Some(c) => c,
        None => return EventAction::PassThrough,
    };
    let window_id = try_read_ctx(&ctx_arc)
        .map(|ctx| ctx.active_window_id)
        .unwrap_or(0);
    if let Ok(mut input) = s.advanced_input.lock() {
        input.prepare_window(window_id);
    }

    // Wheel/hwheel are standalone source events,'''
)

# Profile recompiles/switches also invalidate partially entered advanced triggers.
p = 'src-tauri/src/daemon/router.rs'
replace_once(
    p,
    '''        s.engine_schema = crate::daemon::compiler::compile_schema(&frontend_config);
        s.active_profile = Some(profile);''',
    '''        s.engine_schema = crate::daemon::compiler::compile_schema(&frontend_config);
        if let Ok(mut input) = s.advanced_input.lock() {
            input.reset();
        }
        s.active_profile = Some(profile);'''
)
p = 'src-tauri/src/daemon/profile_runtime.rs'
replace_once(
    p,
    '''    daemon.active_profile_id = profile.id.clone();
    daemon.engine_schema = schema;
    daemon.active_profile = Some(profile);''',
    '''    daemon.active_profile_id = profile.id.clone();
    daemon.engine_schema = schema;
    if let Ok(mut input) = daemon.advanced_input.lock() {
        input.reset();
    }
    daemon.active_profile = Some(profile);'''
)

# Existing v5 migration regression should now expect the latest schema marker while
# preserving its original behavioral assertions.
p = 'src-tauri/tests/profile_schema_v5.rs'
text = read(p)
text = text.replace('assert_eq!(PROFILE_SCHEMA_VERSION, 5);', 'assert_eq!(PROFILE_SCHEMA_VERSION, 6);')
text = text.replace('assert_eq!(exported["schemaVersion"], 5);', 'assert_eq!(exported["schemaVersion"], 6);')
write(p, text)

V6_TEST = r'''use keymaster_pro_lib::schemas::frontend::{
    FrontendTrigger, GestureDirection,
};
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
        rule("old-key", json!({ "type": "keyDown", "code": 65, "modifiers": 0 })),
        rule("old-text", json!({
            "type": "typedText", "sequence": ";x", "mode": "instant",
            "delimiters": " ", "caseSensitive": true
        }))
    ]));
    let profile = import_profile_value(source).expect("v5 should migrate to v6");
    assert_eq!(PROFILE_SCHEMA_VERSION, 6);
    assert!(matches!(profile.rules[0].trigger, FrontendTrigger::KeyDown { .. }));
    assert!(matches!(profile.rules[1].trigger, FrontendTrigger::TypedText { .. }));
    let exported = export_profile_value(&profile).unwrap();
    assert_eq!(exported["schemaVersion"], 6);
    assert_eq!(exported["rules"][0]["trigger"]["type"], "keyDown");
    assert_eq!(exported["rules"][1]["trigger"]["caseSensitive"], true);
}

#[test]
fn frontend_advanced_trigger_contract_round_trips_all_variants() {
    let source = base_profile(json!([
        rule("leader", json!({
            "type": "leaderSequence",
            "leader": { "code": 20, "modifiers": 1 },
            "sequence": [70, 70], "timeoutMs": 900
        })),
        rule("sequence", json!({
            "type": "keySequence", "sequence": [71, 72, 73], "timeoutMs": 650
        })),
        rule("chord", json!({
            "type": "keyChordSet", "codes": [74, 75, 76], "maxSkewMs": 75
        })),
        rule("gesture", json!({
            "type": "mouseGesture", "code": 4,
            "directions": ["right", "down", "left"], "minDistance": 30
        }))
    ]));
    let profile = import_profile_value(source).expect("advanced trigger JSON parses");

    match &profile.rules[0].trigger {
        FrontendTrigger::LeaderSequence { leader, sequence, timeout_ms } => {
            assert_eq!(leader.code, 20);
            assert_eq!(leader.modifiers, 1);
            assert_eq!(sequence, &vec![70, 70]);
            assert_eq!(*timeout_ms, 900);
        }
        other => panic!("unexpected leader: {other:?}"),
    }
    match &profile.rules[1].trigger {
        FrontendTrigger::KeySequence { sequence, timeout_ms } => {
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
        FrontendTrigger::MouseGesture { code, directions, min_distance } => {
            assert_eq!(*code, 4);
            assert_eq!(directions, &vec![GestureDirection::Right, GestureDirection::Down, GestureDirection::Left]);
            assert_eq!(*min_distance, 30);
        }
        other => panic!("unexpected gesture: {other:?}"),
    }

    let exported = export_profile_value(&profile).unwrap();
    assert_eq!(exported["schemaVersion"], 6);
    assert_eq!(exported["rules"][0]["trigger"]["timeoutMs"], 900);
    assert_eq!(exported["rules"][2]["trigger"]["maxSkewMs"], 75);
    assert_eq!(exported["rules"][3]["trigger"]["minDistance"], 30);
    assert_eq!(exported["rules"][3]["trigger"]["directions"][1], "down");
}
'''
write('src-tauri/tests/profile_schema_v6.rs', V6_TEST)

print('v0.4.0 hardening + tests staging applied')
