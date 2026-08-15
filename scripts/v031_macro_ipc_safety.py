from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one marker, got {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Persisted GUI/daemon config.
replace_once(
    'src/lib/types.ts',
    '  restoreMouseAfterMacro?: boolean\n',
    '  restoreMouseAfterMacro?: boolean\n  macroEmergencyStopVk?: number\n',
)
replace_once(
    'src-tauri/src/shared/types.rs',
    '    pub restore_mouse_after_macro: bool,\n',
    '    pub restore_mouse_after_macro: bool,\n    /// Single VK used to cancel every queued/running macro. 0 disables it.\n    pub macro_emergency_stop_vk: u8,\n',
)
replace_once(
    'src-tauri/src/shared/types.rs',
    '            restore_mouse_after_macro: true,\n',
    '            restore_mouse_after_macro: true,\n            macro_emergency_stop_vk: 0x13, // Pause\n',
)

# Daemon runtime state.
replace_once(
    'src-tauri/src/daemon/state.rs',
    '    pub restore_mouse_after_macro: bool,\n',
    '    pub restore_mouse_after_macro: bool,\n    /// Emergency macro-stop VK (0 = disabled).\n    pub macro_emergency_stop_vk: u8,\n',
)
replace_once(
    'src-tauri/src/daemon/state.rs',
    '            restore_mouse_after_macro: config.restore_mouse_after_macro,\n',
    '            restore_mouse_after_macro: config.restore_mouse_after_macro,\n            macro_emergency_stop_vk: config.macro_emergency_stop_vk,\n',
)
replace_once(
    'src-tauri/src/daemon/state.rs',
    '            restore_mouse_after_macro: true,\n',
    '            restore_mouse_after_macro: true,\n            macro_emergency_stop_vk: 0x13,\n',
)

# Hot-reload the emergency key with the existing runtime settings.
p = Path('src-tauri/src/daemon/runner.rs')
s = p.read_text(encoding='utf-8')
s = s.replace(
    '''                    || s.restore_mouse_after_macro != updated.restore_mouse_after_macro;\n\n                s.kb_hook_enabled = updated.kb_hook_enabled;\n                s.mouse_hook_enabled = updated.mouse_hook_enabled;\n                s.restore_mouse_after_macro = updated.restore_mouse_after_macro;\n''',
    '''                    || s.restore_mouse_after_macro != updated.restore_mouse_after_macro\n                    || s.macro_emergency_stop_vk != updated.macro_emergency_stop_vk;\n\n                s.kb_hook_enabled = updated.kb_hook_enabled;\n                s.mouse_hook_enabled = updated.mouse_hook_enabled;\n                s.restore_mouse_after_macro = updated.restore_mouse_after_macro;\n                s.macro_emergency_stop_vk = updated.macro_emergency_stop_vk;\n''',
    1,
)
s = s.replace(
    '''                        "Runtime config applied: keyboard={}, mouse={}, restore_mouse_after_macro={}",\n                        s.kb_hook_enabled,\n                        s.mouse_hook_enabled,\n                        s.restore_mouse_after_macro\n''',
    '''                        "Runtime config applied: keyboard={}, mouse={}, restore_mouse_after_macro={}, macro_emergency_stop_vk={}",\n                        s.kb_hook_enabled,\n                        s.mouse_hook_enabled,\n                        s.restore_mouse_after_macro,\n                        s.macro_emergency_stop_vk\n''',
    1,
)
p.write_text(s, encoding='utf-8')

# Keyboard emergency stop. Key-capture stays first so the setting itself can be edited.
p = Path('src-tauri/src/daemon/hooks.rs')
s = p.read_text(encoding='utf-8')
marker = '''                return LRESULT(1);\n            }\n\n            // Перехват F12 для запуска / остановки записи макроса\n'''
replacement = '''                return LRESULT(1);\n            }\n\n            // Emergency stop is handled before recording/rule dispatch. It is a\n            // constant-time atomic/mutex signal into macro-player; no macro work\n            // happens inside the LL hook callback. 0 disables the hotkey.\n            if is_key_down\n                && s.macro_emergency_stop_vk != 0\n                && vk_code == s.macro_emergency_stop_vk\n            {\n                if let Some(simulator) = &s.simulator {\n                    simulator.cancel_all_macros();\n                }\n                tracing::warn!("Macro emergency stop triggered (VK={})", vk_code);\n                return LRESULT(1);\n            }\n\n            // Перехват F12 для запуска / остановки записи макроса\n'''
if marker not in s:
    raise RuntimeError('keyboard capture/emergency insertion marker not found')
p.write_text(s.replace(marker, replacement, 1), encoding='utf-8')

# Router: production-path preview + stop controls.
p = Path('src-tauri/src/daemon/router.rs')
s = p.read_text(encoding='utf-8')
marker = '''        // Macro recording\n        "macro.start_recording" => {\n'''
replacement = '''        // Macro playback / preview. Preview compiles through the same compiler\n        // helpers and executes through the same macro-player as a real rule.\n        "macro.preview" => {\n            #[derive(Deserialize)]\n            #[serde(rename_all = "camelCase")]\n            struct MacroPreviewInput {\n                steps: Vec<crate::schemas::frontend::MacroStep>,\n                #[serde(default)]\n                playback: crate::schemas::frontend::MacroPlayback,\n            }\n\n            let input: MacroPreviewInput = serde_json::from_value(\n                params.ok_or_else(|| "Missing parameters".to_string())?\n            ).map_err(|e| e.to_string())?;\n            let commands = crate::daemon::compiler::compile_macro_commands(&input.steps);\n            let mut playback = crate::daemon::compiler::compile_macro_playback(&input.playback);\n            // A preview must always be bounded. Repeat count/speed are preserved,\n            // while "while held" is a source-input lifecycle concept.\n            playback.repeat_while_held = false;\n            let simulator = {\n                let s = state.read().map_err(|_| "Failed to lock state")?;\n                s.simulator.clone().ok_or_else(|| "Simulator is not ready".to_string())?\n            };\n            let job_id = simulator.send_macro(\n                commands,\n                playback,\n                crate::shared::calculate_hash(&"__macro_preview__"),\n            )?;\n            Ok(json!({ "success": true, "jobId": job_id }))\n        }\n        "macro.stop_playback" => {\n            let simulator = {\n                let s = state.read().map_err(|_| "Failed to lock state")?;\n                s.simulator.clone().ok_or_else(|| "Simulator is not ready".to_string())?\n            };\n            simulator.cancel_current_macro();\n            Ok(json!({ "success": true }))\n        }\n        "macro.emergency_stop" => {\n            let simulator = {\n                let s = state.read().map_err(|_| "Failed to lock state")?;\n                s.simulator.clone().ok_or_else(|| "Simulator is not ready".to_string())?\n            };\n            simulator.cancel_all_macros();\n            Ok(json!({ "success": true }))\n        }\n\n        // Macro recording\n        "macro.start_recording" => {\n'''
if marker not in s:
    raise RuntimeError('router macro recording marker not found')
p.write_text(s.replace(marker, replacement, 1), encoding='utf-8')

print('macro IPC and emergency safety staged')
