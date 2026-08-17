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


INPUT_STATE = r'''use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

use crate::schemas::frontend::{GestureDirection, KeyChord};

pub const MAX_SEQUENCE_EVENTS: usize = 32;
pub const MAX_LEADER_KEYS: usize = 16;
pub const MAX_GESTURE_STEPS: usize = 8;

#[derive(Debug, Clone, Copy)]
struct TimedKey {
    code: u8,
    at: Instant,
}

#[derive(Debug, Clone)]
struct ActiveLeader {
    source: KeyChord,
    started_at: Instant,
    keys: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct GestureSpec {
    pub rule_id_hash: u64,
    pub directions: Vec<GestureDirection>,
    pub min_distance: u16,
}

#[derive(Debug, Clone)]
struct GestureTrack {
    rule_id_hash: u64,
    expected: Vec<GestureDirection>,
    min_distance: i32,
    index: usize,
    accum_x: i32,
    accum_y: i32,
    failed: bool,
}

#[derive(Debug, Clone)]
struct GestureSession {
    button: u8,
    last_x: i32,
    last_y: i32,
    tracks: Vec<GestureTrack>,
}

#[derive(Debug, Default)]
pub struct AdvancedInputState {
    sequence: VecDeque<TimedKey>,
    leader: Option<ActiveLeader>,
    held_keys: HashMap<u8, Instant>,
    fired_chords: HashSet<u64>,
    suppressed_keyups: HashSet<u8>,
    gesture: Option<GestureSession>,
}

impl AdvancedInputState {
    pub fn reset(&mut self) {
        self.sequence.clear();
        self.leader = None;
        self.held_keys.clear();
        self.fired_chords.clear();
        self.suppressed_keyups.clear();
        self.gesture = None;
    }

    pub fn expire(&mut self, now: Instant, sequence_timeout_ms: u32, leader_timeout_ms: u32) {
        if sequence_timeout_ms == 0 {
            self.sequence.clear();
        } else {
            let timeout = Duration::from_millis(u64::from(sequence_timeout_ms));
            while self.sequence.front().is_some_and(|event| now.duration_since(event.at) > timeout) {
                self.sequence.pop_front();
            }
        }

        if self.leader.as_ref().is_some_and(|leader| {
            leader_timeout_ms == 0
                || now.duration_since(leader.started_at)
                    > Duration::from_millis(u64::from(leader_timeout_ms))
        }) {
            self.leader = None;
        }
    }

    /// Returns false for Windows key autorepeat while the same key is still held.
    pub fn key_down(&mut self, code: u8, now: Instant) -> bool {
        if self.held_keys.contains_key(&code) {
            return false;
        }
        self.held_keys.insert(code, now);
        true
    }

    /// Returns true when the matching key-down was intentionally swallowed by leader mode.
    pub fn key_up(&mut self, code: u8) -> bool {
        self.held_keys.remove(&code);
        self.fired_chords.clear();
        self.suppressed_keyups.remove(&code)
    }

    pub fn start_leader(&mut self, source: KeyChord, now: Instant) {
        self.leader = Some(ActiveLeader {
            source,
            started_at: now,
            keys: Vec::new(),
        });
        self.suppressed_keyups.insert(source.code);
        self.sequence.clear();
    }

    pub fn leader_active(&self) -> bool {
        self.leader.is_some()
    }

    pub fn suppress_keyup(&mut self, code: u8) {
        self.suppressed_keyups.insert(code);
    }

    pub fn push_leader_key(&mut self, code: u8) {
        if let Some(leader) = self.leader.as_mut() {
            if leader.keys.len() >= MAX_LEADER_KEYS {
                leader.keys.remove(0);
            }
            leader.keys.push(code);
            self.suppressed_keyups.insert(code);
        }
    }

    pub fn leader_snapshot(&self) -> Option<(KeyChord, Instant, Vec<u8>)> {
        self.leader
            .as_ref()
            .map(|leader| (leader.source, leader.started_at, leader.keys.clone()))
    }

    pub fn finish_leader(&mut self) {
        self.leader = None;
    }

    pub fn push_sequence(&mut self, code: u8, now: Instant) {
        if self.sequence.len() >= MAX_SEQUENCE_EVENTS {
            self.sequence.pop_front();
        }
        self.sequence.push_back(TimedKey { code, at: now });
    }

    pub fn sequence_matches(&self, expected: &[u8], now: Instant, timeout_ms: u32) -> bool {
        if expected.is_empty() || expected.len() > self.sequence.len() {
            return false;
        }
        let start = self.sequence.len() - expected.len();
        let slice = self.sequence.iter().skip(start).collect::<Vec<_>>();
        if !slice.iter().zip(expected).all(|(event, code)| event.code == *code) {
            return false;
        }
        now.duration_since(slice[0].at) <= Duration::from_millis(u64::from(timeout_ms))
    }

    pub fn chord_should_fire(&mut self, rule_id_hash: u64, codes: &[u8], max_skew_ms: u32) -> bool {
        if codes.len() < 2 || self.fired_chords.contains(&rule_id_hash) {
            return false;
        }
        let mut earliest: Option<Instant> = None;
        let mut latest: Option<Instant> = None;
        for code in codes {
            let Some(at) = self.held_keys.get(code).copied() else {
                return false;
            };
            earliest = Some(earliest.map_or(at, |value| value.min(at)));
            latest = Some(latest.map_or(at, |value| value.max(at)));
        }
        let (Some(earliest), Some(latest)) = (earliest, latest) else {
            return false;
        };
        if latest.duration_since(earliest) > Duration::from_millis(u64::from(max_skew_ms)) {
            return false;
        }
        self.fired_chords.insert(rule_id_hash);
        true
    }

    pub fn start_gesture(&mut self, button: u8, x: i32, y: i32, specs: Vec<GestureSpec>) {
        if specs.is_empty() {
            return;
        }
        let tracks = specs
            .into_iter()
            .filter(|spec| !spec.directions.is_empty())
            .map(|spec| GestureTrack {
                rule_id_hash: spec.rule_id_hash,
                expected: spec.directions.into_iter().take(MAX_GESTURE_STEPS).collect(),
                min_distance: i32::from(spec.min_distance.max(1)),
                index: 0,
                accum_x: 0,
                accum_y: 0,
                failed: false,
            })
            .collect::<Vec<_>>();
        if !tracks.is_empty() {
            self.gesture = Some(GestureSession {
                button,
                last_x: x,
                last_y: y,
                tracks,
            });
        }
    }

    pub fn gesture_move(&mut self, x: i32, y: i32) {
        let Some(session) = self.gesture.as_mut() else {
            return;
        };
        let dx = x.saturating_sub(session.last_x);
        let dy = y.saturating_sub(session.last_y);
        session.last_x = x;
        session.last_y = y;

        for track in &mut session.tracks {
            if track.failed || track.index >= track.expected.len() {
                continue;
            }
            track.accum_x = track.accum_x.saturating_add(dx);
            track.accum_y = track.accum_y.saturating_add(dy);
            let ax = track.accum_x.abs();
            let ay = track.accum_y.abs();
            if ax < track.min_distance && ay < track.min_distance {
                continue;
            }
            let direction = if ax >= ay {
                if track.accum_x >= 0 { GestureDirection::Right } else { GestureDirection::Left }
            } else if track.accum_y >= 0 {
                GestureDirection::Down
            } else {
                GestureDirection::Up
            };

            if track.expected[track.index] == direction {
                track.index += 1;
                track.accum_x = 0;
                track.accum_y = 0;
            } else {
                track.failed = true;
            }
        }
    }

    pub fn finish_gesture(&mut self, button: u8) -> Vec<u64> {
        let Some(session) = self.gesture.take() else {
            return Vec::new();
        };
        if session.button != button {
            self.gesture = Some(session);
            return Vec::new();
        }
        session
            .tracks
            .into_iter()
            .filter(|track| !track.failed && track.index == track.expected.len())
            .map(|track| track.rule_id_hash)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> Instant { Instant::now() }

    #[test]
    fn sequence_history_is_bounded() {
        let mut state = AdvancedInputState::default();
        let now = t0();
        for i in 0..100u8 {
            state.push_sequence(i, now);
        }
        assert_eq!(state.sequence.len(), MAX_SEQUENCE_EVENTS);
        assert_eq!(state.sequence.front().map(|event| event.code), Some(68));
    }

    #[test]
    fn sequence_timeout_is_per_match() {
        let mut state = AdvancedInputState::default();
        let now = t0();
        state.push_sequence(0x41, now);
        state.push_sequence(0x42, now + Duration::from_millis(90));
        assert!(state.sequence_matches(&[0x41, 0x42], now + Duration::from_millis(90), 100));
        assert!(!state.sequence_matches(&[0x41, 0x42], now + Duration::from_millis(150), 100));
    }

    #[test]
    fn autorepeat_does_not_duplicate_sequence_or_chord_down() {
        let mut state = AdvancedInputState::default();
        let now = t0();
        assert!(state.key_down(0x41, now));
        assert!(!state.key_down(0x41, now + Duration::from_millis(10)));
        state.push_sequence(0x41, now);
        assert_eq!(state.sequence.len(), 1);
    }

    #[test]
    fn chord_requires_all_keys_inside_skew_window() {
        let mut state = AdvancedInputState::default();
        let now = t0();
        state.key_down(0x4A, now);
        state.key_down(0x4B, now + Duration::from_millis(40));
        assert!(state.chord_should_fire(1, &[0x4A, 0x4B], 50));
        assert!(!state.chord_should_fire(1, &[0x4A, 0x4B], 50));
        state.key_up(0x4A);
        state.key_up(0x4B);
        state.key_down(0x4A, now);
        state.key_down(0x4B, now + Duration::from_millis(80));
        assert!(!state.chord_should_fire(2, &[0x4A, 0x4B], 50));
    }

    #[test]
    fn leader_buffer_is_bounded_and_keyups_remain_suppressed() {
        let mut state = AdvancedInputState::default();
        let now = t0();
        state.start_leader(KeyChord { code: 0x14, modifiers: 0 }, now);
        for code in 1..=30u8 {
            state.push_leader_key(code);
        }
        let (_, _, keys) = state.leader_snapshot().unwrap();
        assert_eq!(keys.len(), MAX_LEADER_KEYS);
        state.finish_leader();
        assert!(state.key_up(30));
    }

    #[test]
    fn gesture_matches_direction_chain_and_rejects_wrong_turn() {
        let mut state = AdvancedInputState::default();
        state.start_gesture(4, 0, 0, vec![GestureSpec {
            rule_id_hash: 7,
            directions: vec![GestureDirection::Right, GestureDirection::Down],
            min_distance: 10,
        }]);
        state.gesture_move(12, 0);
        state.gesture_move(12, 12);
        assert_eq!(state.finish_gesture(4), vec![7]);

        state.start_gesture(4, 0, 0, vec![GestureSpec {
            rule_id_hash: 8,
            directions: vec![GestureDirection::Right, GestureDirection::Down],
            min_distance: 10,
        }]);
        state.gesture_move(-12, 0);
        assert!(state.finish_gesture(4).is_empty());
    }
}
'''
write('src-tauri/src/daemon/input_state.rs', INPUT_STATE)

# Engine imports the state-machine gesture spec.
p = 'src-tauri/src/daemon/engine.rs'
replace_once(
    p,
    '''use crate::daemon::mouse_triggers::{
    DoubleClickDetector, MoveGate, system_double_click_limits, wheel_key,
};''',
    '''use crate::daemon::input_state::GestureSpec;
use crate::daemon::mouse_triggers::{
    DoubleClickDetector, MoveGate, system_double_click_limits, wheel_key,
};'''
)

# Insert advanced keyboard handling before text expansion. Leader mode is the only
# suppressing mode; sequence/chord triggers are additive to avoid broken key-up lifecycles.
anchor = '''    // Text expansion matching. State is bounded and in-memory only.
    if is_key_down {'''
block = r'''    // v0.4.0 advanced triggers use one bounded state machine. Ordinary
    // sequences/chords observe input; leader mode intentionally captures it.
    {
        let now = Instant::now();
        let max_sequence_timeout = engine_schema
            .key_sequence_rules
            .iter()
            .map(|rule| rule.timeout_ms)
            .max()
            .unwrap_or(0);
        let max_leader_timeout = engine_schema
            .leader_sequence_rules
            .iter()
            .map(|rule| rule.timeout_ms)
            .max()
            .unwrap_or(0);
        let mut additive_actions: Option<Vec<EngineAction>> = None;
        let mut capture = false;

        if let Ok(mut input) = s.advanced_input.lock() {
            input.expire(now, max_sequence_timeout, max_leader_timeout);

            if !is_key_down {
                if input.key_up(vk_code) {
                    return EventAction::Block;
                }
            } else {
                let fresh_press = input.key_down(vk_code, now);

                if input.leader_active() {
                    capture = true;
                    if fresh_press {
                        input.suppress_keyup(vk_code);
                        if vk_code == 0x1B {
                            input.finish_leader();
                        } else if !is_modifier_vk(vk_code) {
                            input.push_leader_key(vk_code);
                            if let Some((source, started_at, keys)) = input.leader_snapshot() {
                                let mut has_prefix = false;
                                if let Some(ctx) = try_read_ctx(&ctx_arc) {
                                    for candidate in &engine_schema.leader_sequence_rules {
                                        if candidate.leader.code != source.code
                                            || !modifiers_match(candidate.leader.modifiers, source.modifiers)
                                            || now.duration_since(started_at)
                                                > Duration::from_millis(u64::from(candidate.timeout_ms))
                                        {
                                            continue;
                                        }
                                        if candidate.sequence.starts_with(&keys) {
                                            has_prefix = true;
                                        }
                                        if candidate.sequence == keys
                                            && check_conditions(&candidate.rule.conditions, &ctx)
                                        {
                                            additive_actions = Some(candidate.rule.actions.clone());
                                            break;
                                        }
                                    }
                                }
                                if additive_actions.is_some() || !has_prefix {
                                    input.finish_leader();
                                }
                            }
                        }
                    }
                } else if fresh_press && !is_modifier_vk(vk_code) {
                    // Enter leader mode only if at least one rule is eligible in the
                    // current context, so an inactive leader never swallows a key.
                    if let Some(ctx) = try_read_ctx(&ctx_arc) {
                        if engine_schema.leader_sequence_rules.iter().any(|candidate| {
                            candidate.leader.code == vk_code
                                && modifiers_match(candidate.leader.modifiers, event_modifiers)
                                && check_conditions(&candidate.rule.conditions, &ctx)
                        }) {
                            input.start_leader(
                                crate::schemas::frontend::KeyChord {
                                    code: vk_code,
                                    modifiers: event_modifiers,
                                },
                                now,
                            );
                            capture = true;
                        }
                    }

                    if !capture {
                        input.push_sequence(vk_code, now);
                        if let Some(ctx) = try_read_ctx(&ctx_arc) {
                            for candidate in &engine_schema.key_sequence_rules {
                                if input.sequence_matches(
                                    &candidate.sequence,
                                    now,
                                    candidate.timeout_ms,
                                ) && check_conditions(&candidate.rule.conditions, &ctx)
                                {
                                    additive_actions = Some(candidate.rule.actions.clone());
                                    break;
                                }
                            }

                            if additive_actions.is_none() {
                                for candidate in &engine_schema.key_chord_set_rules {
                                    if input.chord_should_fire(
                                        candidate.rule_id_hash,
                                        &candidate.codes,
                                        candidate.max_skew_ms,
                                    ) && check_conditions(&candidate.rule.conditions, &ctx)
                                    {
                                        additive_actions = Some(candidate.rule.actions.clone());
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(actions) = additive_actions {
            execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
            execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
        }
        if capture {
            return EventAction::Block;
        }
    }

    // Text expansion matching. State is bounded and in-memory only.
    if is_key_down {'''
replace_once(p, anchor, block)

# Mouse gestures: track while the anchor button is held, but keep native mouse
# down/up/move pass-through semantics. This avoids stuck buttons and delayed clicks.
replace_once(
    p,
    '''    // Movement triggers are additive. Blocking WM_MOUSEMOVE would freeze the
    // pointer; no waiting or platform query happens in this hot path.
    if is_move {
        if !engine_schema.mouse_move_rules.is_empty() {''',
    '''    // Feed any active gesture before ordinary mouse-move triggers. The gesture
    // state is bounded by configured rules and max 8 directions per rule.
    if is_move {
        if let Ok(mut input) = s.advanced_input.lock() {
            input.gesture_move(x, y);
        }
        if !engine_schema.mouse_move_rules.is_empty() {'''
)
replace_once(
    p,
    '''    // Double-click detection is also additive: the first click is never delayed
    // while waiting for a possible second click.
    if is_down && button != 255 {''',
    '''    // Start an observational mouse-gesture session on anchor-button down.
    if is_down && button != 255 {
        let specs = engine_schema
            .mouse_gesture_rules
            .iter()
            .filter(|rule| rule.code == button)
            .map(|rule| GestureSpec {
                rule_id_hash: rule.rule_id_hash,
                directions: rule.directions.clone(),
                min_distance: rule.min_distance,
            })
            .collect::<Vec<_>>();
        if let Ok(mut input) = s.advanced_input.lock() {
            input.start_gesture(button, x, y, specs);
        }
    }

    // Finish gestures on anchor release and fire the highest-priority eligible
    // completed rule. The physical button event itself remains pass-through.
    if !is_down && button != 255 {
        let completed = s
            .advanced_input
            .lock()
            .map(|mut input| input.finish_gesture(button))
            .unwrap_or_default();
        if !completed.is_empty() {
            if let Some(ctx) = try_read_ctx(&ctx_arc) {
                for rule in &engine_schema.mouse_gesture_rules {
                    if completed.contains(&rule.rule_id_hash)
                        && check_conditions(&rule.rule.conditions, &ctx)
                    {
                        let actions = rule.rule.actions.clone();
                        drop(ctx);
                        execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                        execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
                        break;
                    }
                }
            }
        }
    }

    // Double-click detection is also additive: the first click is never delayed
    // while waiting for a possible second click.
    if is_down && button != 255 {'''
)

print('v0.4.0 runtime staging applied')
