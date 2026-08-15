from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected one occurrence, got {text.count(old)}: {old!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

replace_once(
    'src/lib/types.ts',
    "  | { type: 'mouseScroll'; delta: number }\n",
    "  | { type: 'mouseScroll'; delta: number }\n  | { type: 'mouseHScroll'; delta: number }\n",
)

replace_once(
    'src-tauri/src/schemas/frontend.rs',
    '    MouseScroll { delta: i32 },\n',
    '    MouseScroll { delta: i32 },\n    MouseHScroll { delta: i32 },\n',
)

replace_once(
    'src-tauri/src/schemas/engine.rs',
    '    MouseScroll { delta: i32 },\n',
    '    MouseScroll { delta: i32 },\n    MouseHScroll { delta: i32 },\n',
)

replace_once(
    'src-tauri/src/daemon/compiler.rs',
    '                    MacroAction::MouseScroll { delta } => {\n                        commands.push(SimulatorCommand::MouseScroll { delta })\n                    }\n',
    '                    MacroAction::MouseScroll { delta } => {\n                        commands.push(SimulatorCommand::MouseScroll { delta })\n                    }\n                    MacroAction::MouseHScroll { delta } => {\n                        commands.push(SimulatorCommand::MouseHScroll { delta })\n                    }\n',
)

replace_once(
    'src-tauri/src/daemon/hooks.rs',
    '                } else if delta != 0 {\n                    action_to_record = Some(crate::schemas::frontend::MacroAction::MouseScroll { delta });\n',
    '                } else if delta != 0 {\n                    action_to_record = Some(if msg_type == WM_MOUSEHWHEEL as u32 {\n                        crate::schemas::frontend::MacroAction::MouseHScroll { delta }\n                    } else {\n                        crate::schemas::frontend::MacroAction::MouseScroll { delta }\n                    });\n',
)

replace_once(
    'src-tauri/src/simulator/mod.rs',
    '    MOUSEEVENTF_MOVE, MOUSEEVENTF_WHEEL, MOUSEEVENTF_ABSOLUTE,\n',
    '    MOUSEEVENTF_MOVE, MOUSEEVENTF_WHEEL, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_ABSOLUTE,\n',
)
replace_once(
    'src-tauri/src/simulator/mod.rs',
    '        SimulatorCommand::MouseScroll { delta } => scroll_mouse(delta),\n',
    '        SimulatorCommand::MouseScroll { delta } => scroll_mouse(delta, false),\n        SimulatorCommand::MouseHScroll { delta } => scroll_mouse(delta, true),\n',
)
replace_once(
    'src-tauri/src/simulator/mod.rs',
    'fn scroll_mouse(delta: i32) {\n',
    'fn scroll_mouse(delta: i32, horizontal: bool) {\n',
)
replace_once(
    'src-tauri/src/simulator/mod.rs',
    '                dwFlags: MOUSEEVENTF_WHEEL,\n',
    '                dwFlags: if horizontal { MOUSEEVENTF_HWHEEL } else { MOUSEEVENTF_WHEEL },\n',
)
replace_once(
    'src-tauri/src/simulator/mod.rs',
    'fn scroll_mouse(_delta: i32) {}\n',
    'fn scroll_mouse(_delta: i32, _horizontal: bool) {}\n',
)

p = Path('src/components/ruleBuilder/MacroEditor.tsx')
text = p.read_text(encoding='utf-8')
text = text.replace(
    "    if (type === 'mouseScroll') return { type, delta: 0 };\n",
    "    if (type === 'mouseScroll' || type === 'mouseHScroll') return { type, delta: 0 };\n",
    1,
)
text = text.replace(
    "      case 'mouseScroll':\n",
    "      case 'mouseScroll':\n      case 'mouseHScroll':\n",
    1,
)
text = text.replace(
    "                type: 'mouseScroll',\n                delta: Number.parseInt(event.target.value, 10) || 0,\n",
    "                type: action.type,\n                delta: Number.parseInt(event.target.value, 10) || 0,\n",
    1,
)
text = text.replace(
    '                <option value="mouseScroll">{t(\'macro.step_types.mouseScroll\')}</option>\n',
    '                <option value="mouseScroll">{t(\'macro.step_types.mouseScroll\')}</option>\n                <option value="mouseHScroll">{t(\'macro.step_types.mouseHScroll\', { defaultValue: \'Гориз. колесо\' })}</option>\n',
    1,
)
p.write_text(text, encoding='utf-8')

print('horizontal macro scroll fix staged')
