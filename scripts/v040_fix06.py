from pathlib import Path

p = Path('src-tauri/src/daemon/input_state.rs')
text = p.read_text(encoding='utf-8')
old = '''        self.held_keys.clear();
        self.fired_chords.clear();
        self.suppressed_keyups.clear();
        self.gesture = None;'''
new = '''        self.held_keys.clear();
        self.fired_chords.clear();
        // A profile switch may happen after leader mode swallowed a physical
        // key-down. Keep those key-up obligations until the user actually releases
        // the keys; otherwise the target application would see an unmatched key-up.
        self.gesture = None;'''
if old not in text:
    raise SystemExit('advanced reset suppressed-keyup anchor not found')
text = text.replace(old, new, 1)

anchor = '''    #[test]
    fn window_change_clears_matching_history_but_keeps_suppressed_releases() {'''
test = '''    #[test]
    fn profile_reset_clears_matching_state_but_keeps_suppressed_releases() {
        let mut state = AdvancedInputState::default();
        let now = t0();
        state.prepare_window(1);
        state.start_leader(KeyChord { code: 0x14, modifiers: 0 }, now);
        state.push_leader_key(0x46);
        state.push_sequence(0x41, now);
        state.key_down(0x4A, now);
        state.reset();
        assert!(!state.leader_active());
        assert!(!state.sequence_matches(&[0x41], now, 1000));
        assert!(state.key_up(0x14));
        assert!(state.key_up(0x46));
        assert!(!state.chord_should_fire(1, &[0x4A, 0x4B, 0x4C], 100));
    }

    #[test]
    fn window_change_clears_matching_history_but_keeps_suppressed_releases() {'''
if anchor not in text:
    raise SystemExit('advanced profile-reset test insertion anchor not found')
text = text.replace(anchor, test, 1)
p.write_text(text, encoding='utf-8')
print('v040 fix06 applied: profile reset preserves captured key-up obligations')
