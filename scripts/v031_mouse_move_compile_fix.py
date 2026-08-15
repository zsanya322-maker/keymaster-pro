from pathlib import Path

path = Path('src-tauri/src/daemon/compiler.rs')
text = path.read_text(encoding='utf-8')
old = '        actions: rule.actions.iter().map(compile_action).collect(),\n'
new = '''        actions: rule
            .actions
            .iter()
            .enumerate()
            .map(|(index, action)| compile_action(action, macro_action_key(&rule.id, false, index)))
            .collect(),
'''
if text.count(old) != 1:
    raise SystemExit(f'expected one legacy mouse-move action mapper, got {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('mouse-move action compiler fixed')
