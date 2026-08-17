from pathlib import Path
p = Path('scripts/v033_schema.py')
s = p.read_text(encoding='utf-8')
old = "    if path.as_posix().endswith('schemas/engine.rs'):\n        continue\n    text = path.read_text(encoding='utf-8')\n    text = re.sub(\n        r'EngineAction::TypeText"
new = "    if path.as_posix().endswith('schemas/engine.rs') or path.as_posix().endswith('daemon/compiler.rs'):\n        continue\n    text = path.read_text(encoding='utf-8')\n    text = re.sub(\n        r'EngineAction::TypeText"
if old not in s:
    raise SystemExit('schema EngineAction constructor loop anchor missing')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('v0.3.3 schema staging bootstrap applied')
