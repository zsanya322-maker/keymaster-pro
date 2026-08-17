from pathlib import Path

p = Path('src-tauri/tests/profile_schema_v3.rs')
text = p.read_text(encoding='utf-8')
replacements = {
    'assert_eq!(PROFILE_SCHEMA_VERSION, 5);': 'assert_eq!(PROFILE_SCHEMA_VERSION, 6);',
    'assert_eq!(exported["schemaVersion"], 5);': 'assert_eq!(exported["schemaVersion"], 6);',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'expected legacy-current assertion not found: {old}')
    text = text.replace(old, new)
p.write_text(text, encoding='utf-8')
print('v040 fix02 applied: legacy sources unchanged, latest-schema expectations are v6')
