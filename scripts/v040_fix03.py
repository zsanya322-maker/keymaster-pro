from pathlib import Path

p = Path('src-tauri/src/schemas/frontend.rs')
text = p.read_text(encoding='utf-8')
replacements = {
'''        #[serde(default = "default_advanced_timeout")]
        timeout_ms: u32,''': '''        #[serde(rename = "timeoutMs", default = "default_advanced_timeout")]
        timeout_ms: u32,''',
'''        #[serde(default = "default_chord_skew")]
        max_skew_ms: u32,''': '''        #[serde(rename = "maxSkewMs", default = "default_chord_skew")]
        max_skew_ms: u32,''',
'''        #[serde(default = "default_gesture_distance")]
        min_distance: u16,''': '''        #[serde(rename = "minDistance", default = "default_gesture_distance")]
        min_distance: u16,''',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'advanced serde anchor not found: {old!r}')
    text = text.replace(old, new)

# There are two advanced timeout fields (leader + ordinary sequence); make sure both
# were converted rather than silently leaving one on the default 800 ms path.
if text.count('rename = "timeoutMs"') < 2:
    raise SystemExit('expected both advanced timeoutMs fields to be explicitly renamed')

p.write_text(text, encoding='utf-8')
print('v040 fix03 applied: advanced trigger camelCase serde contract fixed')
