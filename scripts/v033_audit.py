from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')

# Exact deletion policy is a pure function so instant/delimiter counts are
# independently unit-tested instead of being inferred from rendered output.
p = 'src-tauri/src/daemon/text_expansion.rs'
s = read(p)
anchor = '''pub fn suffix_chars(value: &str, count: usize) -> String {
    let total = value.chars().count();
    value.chars().skip(total.saturating_sub(count)).collect()
}
'''
addition = anchor + '''
pub fn backspaces_for(mode: crate::schemas::frontend::TextExpansionMode, sequence_chars: usize) -> usize {
    match mode {
        crate::schemas::frontend::TextExpansionMode::Instant => sequence_chars.saturating_sub(1),
        crate::schemas::frontend::TextExpansionMode::Delimiter => sequence_chars,
    }
}
'''
if anchor not in s:
    raise SystemExit('text helper anchor missing')
s = s.replace(anchor, addition, 1)
test_anchor = '''    #[test]
    fn delimiter_config_supports_literal_and_escaped_whitespace() {'''
test = '''    #[test]
    fn exact_backspace_counts_match_blocking_semantics() {
        use crate::schemas::frontend::TextExpansionMode;
        assert_eq!(backspaces_for(TextExpansionMode::Instant, 5), 4);
        assert_eq!(backspaces_for(TextExpansionMode::Delimiter, 5), 5);
        assert_eq!(backspaces_for(TextExpansionMode::Instant, 1), 0);
    }

    #[test]
    fn delimiter_config_supports_literal_and_escaped_whitespace() {'''
if test_anchor not in s:
    raise SystemExit('text tests anchor missing')
s = s.replace(test_anchor, test, 1)
write(p, s)

p = 'src-tauri/src/daemon/engine.rs'
s = read(p)
s = s.replace(
    'use crate::daemon::text_expansion::{delimiter_contains, materialize_text_actions, suffix_chars, suffix_matches, TextUndoRecord};',
    'use crate::daemon::text_expansion::{backspaces_for, delimiter_contains, materialize_text_actions, suffix_chars, suffix_matches, TextUndoRecord};',
    1,
)
s = s.replace(
    '''                let (source, backspaces, delimiter) = match candidate.mode {
                    TextExpansionMode::Instant => (&prospective, seq_chars.saturating_sub(1), None),
                    TextExpansionMode::Delimiter => (&before, seq_chars, Some(c)),
                };''',
    '''                let (source, delimiter) = match candidate.mode {
                    TextExpansionMode::Instant => (&prospective, None),
                    TextExpansionMode::Delimiter => (&before, Some(c)),
                };
                let backspaces = backspaces_for(candidate.mode, seq_chars);''',
    1,
)
write(p, s)

# Keep the delimiter hint a one-line JS string even though it displays escaped
# whitespace names to the user.
p = 'src/pages/RulesPage.tsx'
s = read(p)
s = re.sub(
    r"\{t\('textExpansion\.delimiters',\s*\{\s*defaultValue:\s*'Разделители \(.*?поддерживаются\)'\s*\}\)\}",
    r"{t('textExpansion.delimiters', { defaultValue: 'Разделители: пробел, \\t, \\n и знаки' })}",
    s,
    count=1,
    flags=re.S,
)
write(p, s)

# Fail staging early if an old unbounded text implementation survived.
checks = {
    'src-tauri/src/daemon/engine.rs': ['text_expansion_map', 'typed_buffer'],
    'src-tauri/src/daemon/state.rs': ['typed_buffer'],
}
for path, forbidden in checks.items():
    text = read(path)
    for needle in forbidden:
        if needle in text:
            raise SystemExit(f'{path}: legacy marker still present: {needle}')

print('v0.3.3 acceptance audit staged')
