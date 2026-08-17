from pathlib import Path

p = Path('src-tauri/src/daemon/compiler.rs')
s = p.read_text(encoding='utf-8')
old = 'assert_eq!(schema.text_expansion_map.len(), 1);'
new = 'assert_eq!(schema.text_expansion_rules.len(), 1);'
count = s.count(old)
if count != 1:
    raise SystemExit(f'compiler text expansion assertion: expected 1 match, got {count}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('v0.3.3 compiler assertion fixed')
