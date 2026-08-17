from pathlib import Path

p = Path('src-tauri/src/daemon/input_state.rs')
text = p.read_text(encoding='utf-8')
replacements = {
'''    fired_chords: HashSet<u64>,''': '''    fired_chords: HashMap<u64, Vec<u8>>,''',
'''        self.held_keys.remove(&code);
        self.fired_chords.clear();
        self.suppressed_keyups.remove(&code)''': '''        self.held_keys.remove(&code);
        self.fired_chords.retain(|_, members| !members.contains(&code));
        self.suppressed_keyups.remove(&code)''',
'''        if codes.len() < 2 || self.fired_chords.contains(&rule_id_hash) {''': '''        if codes.len() < 2 || self.fired_chords.contains_key(&rule_id_hash) {''',
'''        self.fired_chords.insert(rule_id_hash);
        true''': '''        self.fired_chords.insert(rule_id_hash, codes.to_vec());
        true''',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'chord latch anchor not found: {old!r}')
    text = text.replace(old, new, 1)

anchor = '''    #[test]
    fn leader_buffer_is_bounded_and_keyups_remain_suppressed() {'''
test = '''    #[test]
    fn fired_chord_stays_latched_until_one_of_its_members_is_released() {
        let mut state = AdvancedInputState::default();
        let now = t0();
        state.key_down(0x4A, now);
        state.key_down(0x4B, now + Duration::from_millis(10));
        state.key_down(0x4C, now + Duration::from_millis(20));
        assert!(state.chord_should_fire(77, &[0x4A, 0x4B, 0x4C], 50));

        // An unrelated key release must not re-arm J+K+L while its members
        // are still physically held.
        state.key_down(0x4D, now + Duration::from_millis(25));
        state.key_up(0x4D);
        assert!(!state.chord_should_fire(77, &[0x4A, 0x4B, 0x4C], 50));

        // Releasing a chord member intentionally re-arms it for the next full press.
        state.key_up(0x4A);
        state.key_down(0x4A, now + Duration::from_millis(30));
        assert!(state.chord_should_fire(77, &[0x4A, 0x4B, 0x4C], 50));
    }

    #[test]
    fn leader_buffer_is_bounded_and_keyups_remain_suppressed() {'''
if anchor not in text:
    raise SystemExit('chord latch test insertion anchor not found')
text = text.replace(anchor, test, 1)
p.write_text(text, encoding='utf-8')
print('v040 fix04 applied: chord fire latch is member-scoped')
