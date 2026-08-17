from pathlib import Path

# Compiler: advanced chord sets are deliberately 3+ ordinary keys. Two-key
# combinations already belong to the existing KeyChord/remap model.
p = Path('src-tauri/src/daemon/compiler.rs')
text = p.read_text(encoding='utf-8')
old = '''                if codes.len() >= 2 {
                    key_chord_set_rules.push(CompiledKeyChordSetRule {'''
new = '''                if codes.len() >= 3 {
                    key_chord_set_rules.push(CompiledKeyChordSetRule {'''
if old not in text:
    raise SystemExit('compiler chord min anchor not found')
p.write_text(text.replace(old, new, 1), encoding='utf-8')

# State machine follows the same invariant and its skew test uses J+K+L.
p = Path('src-tauri/src/daemon/input_state.rs')
text = p.read_text(encoding='utf-8')
old = '''        if codes.len() < 2 || self.fired_chords.contains_key(&rule_id_hash) {'''
new = '''        if codes.len() < 3 || self.fired_chords.contains_key(&rule_id_hash) {'''
if old not in text:
    raise SystemExit('state chord min anchor not found')
text = text.replace(old, new, 1)
old_test = '''        state.key_down(0x4A, now);
        state.key_down(0x4B, now + Duration::from_millis(40));
        assert!(state.chord_should_fire(1, &[0x4A, 0x4B], 50));
        assert!(!state.chord_should_fire(1, &[0x4A, 0x4B], 50));
        state.key_up(0x4A);
        state.key_up(0x4B);
        state.key_down(0x4A, now);
        state.key_down(0x4B, now + Duration::from_millis(80));
        assert!(!state.chord_should_fire(2, &[0x4A, 0x4B], 50));'''
new_test = '''        state.key_down(0x4A, now);
        state.key_down(0x4B, now + Duration::from_millis(20));
        state.key_down(0x4C, now + Duration::from_millis(40));
        assert!(state.chord_should_fire(1, &[0x4A, 0x4B, 0x4C], 50));
        assert!(!state.chord_should_fire(1, &[0x4A, 0x4B, 0x4C], 50));
        state.key_up(0x4A);
        state.key_up(0x4B);
        state.key_up(0x4C);
        state.key_down(0x4A, now);
        state.key_down(0x4B, now + Duration::from_millis(20));
        state.key_down(0x4C, now + Duration::from_millis(80));
        assert!(!state.chord_should_fire(2, &[0x4A, 0x4B, 0x4C], 50));'''
if old_test not in text:
    raise SystemExit('state chord skew test anchor not found')
text = text.replace(old_test, new_test, 1)
p.write_text(text, encoding='utf-8')

print('v040 fix05 applied: chord sets require 3+ keys')
