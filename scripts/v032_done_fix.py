from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# 1) Rich context lifecycle: refresh the foreground context not only when the
# foreground HWND changes, but also when its title/geometry changes. This keeps
# title/fullscreen/monitor/size matching live without periodic Win32 polling.
# ---------------------------------------------------------------------------
p = "src-tauri/src/trackers/context_tracker.rs"
s = read(p)
old_cb = '''    unsafe extern "system" fn win_event_callback(\n        _: HWINEVENTHOOK,\n        _: u32,\n        hwnd: HWND,\n        _: i32,\n        _: i32,\n        _: u32,\n        _: u32,\n    ) {\n        refresh(hwnd);\n    }\n'''
new_cb = '''    // WinEvent constants intentionally kept local: windows-rs moved some of\n    // these constants between feature modules across releases, while the Win32\n    // ABI values are stable.\n    const EVENT_OBJECT_LOCATIONCHANGE_ID: u32 = 0x800B;\n    const EVENT_OBJECT_NAMECHANGE_ID: u32 = 0x800C;\n\n    unsafe extern "system" fn win_event_callback(\n        _: HWINEVENTHOOK,\n        event: u32,\n        hwnd: HWND,\n        _: i32,\n        _: i32,\n        _: u32,\n        _: u32,\n    ) {\n        if hwnd.0.is_null() {\n            return;\n        }\n        let foreground = unsafe { GetForegroundWindow() };\n        if event == EVENT_SYSTEM_FOREGROUND || hwnd == foreground {\n            refresh(hwnd);\n        }\n    }\n'''
if old_cb not in s:
    raise SystemExit("context tracker callback anchor missing")
s = s.replace(old_cb, new_cb, 1)
old_hook = '''            let hook = SetWinEventHook(\n                EVENT_SYSTEM_FOREGROUND,\n                EVENT_SYSTEM_FOREGROUND,\n                None,\n                Some(win_event_callback),\n                0,\n                0,\n                WINEVENT_OUTOFCONTEXT,\n            );\n\n            let mut message = MSG::default();\n            while GetMessageW(&mut message, None, 0, 0).as_bool() {\n                let _ = TranslateMessage(&message);\n                DispatchMessageW(&message);\n            }\n\n            if !hook.is_invalid() {\n                let _ = UnhookWinEvent(hook);\n            }\n'''
new_hook = '''            let foreground_hook = SetWinEventHook(\n                EVENT_SYSTEM_FOREGROUND,\n                EVENT_SYSTEM_FOREGROUND,\n                None,\n                Some(win_event_callback),\n                0,\n                0,\n                WINEVENT_OUTOFCONTEXT,\n            );\n            let location_hook = SetWinEventHook(\n                EVENT_OBJECT_LOCATIONCHANGE_ID,\n                EVENT_OBJECT_LOCATIONCHANGE_ID,\n                None,\n                Some(win_event_callback),\n                0,\n                0,\n                WINEVENT_OUTOFCONTEXT,\n            );\n            let name_hook = SetWinEventHook(\n                EVENT_OBJECT_NAMECHANGE_ID,\n                EVENT_OBJECT_NAMECHANGE_ID,\n                None,\n                Some(win_event_callback),\n                0,\n                0,\n                WINEVENT_OUTOFCONTEXT,\n            );\n\n            let mut message = MSG::default();\n            while GetMessageW(&mut message, None, 0, 0).as_bool() {\n                let _ = TranslateMessage(&message);\n                DispatchMessageW(&message);\n            }\n\n            for hook in [foreground_hook, location_hook, name_hook] {\n                if !hook.is_invalid() {\n                    let _ = UnhookWinEvent(hook);\n                }\n            }\n'''
if old_hook not in s:
    raise SystemExit("context tracker hook anchor missing")
s = s.replace(old_hook, new_hook, 1)
write(p, s)

# ---------------------------------------------------------------------------
# 2) Remove obsolete numeric VirtualDesktop editor from new UI. Legacy schema
# remains readable; new editing uses Context Match + real desktop GUID.
# ---------------------------------------------------------------------------
p = "src/components/ruleBuilder/ConditionEditor.tsx"
s = read(p)
s = s.replace("            else if (type === 'virtualDesktop') onChange({ type: 'virtualDesktop', id: 0 });\n", '', 1)
s = s.replace("          <option value=\"virtualDesktop\">{t('ruleBuilder.condition_types.virtualDesktop', { defaultValue: 'Виртуальный рабочий стол' })}</option>\n", '', 1)
s = s.replace('''\n          {condition.type === 'virtualDesktop' && (\n            <input type="number" min={0} value={condition.id} onChange={(event) => onChange({ ...condition, id: Number(event.target.value) || 0 })} className={`${controlClass} w-full`} />\n          )}\n''', '', 1)
old_context = '''          {condition.type === 'contextMatch' && (\n            <div className="grid grid-cols-2 gap-1.5 items-start">\n              <input className={controlClass} placeholder="process.exe" value={condition.process || ''} onChange={(event) => onChange({ ...condition, process: event.target.value || undefined })} />\n              <input className={controlClass} placeholder="path contains" value={condition.path || ''} onChange={(event) => onChange({ ...condition, path: event.target.value || undefined })} />\n              <input className={controlClass} placeholder="title contains" value={condition.title || ''} onChange={(event) => onChange({ ...condition, title: event.target.value || undefined })} />\n              <input className={controlClass} placeholder="window class" value={condition.className || ''} onChange={(event) => onChange({ ...condition, className: event.target.value || undefined })} />\n              <input className={controlClass} placeholder="virtual desktop GUID" value={condition.virtualDesktopId || ''} onChange={(event) => onChange({ ...condition, virtualDesktopId: event.target.value || undefined })} />\n              <input className={controlClass} placeholder="monitor id" value={condition.monitorId || ''} onChange={(event) => onChange({ ...condition, monitorId: event.target.value || undefined })} />\n              <input className={controlClass} type="number" placeholder="min width" value={condition.minWidth ?? ''} onChange={(event) => onChange({ ...condition, minWidth: event.target.value ? Number(event.target.value) : undefined })} />\n              <input className={controlClass} type="number" placeholder="max width" value={condition.maxWidth ?? ''} onChange={(event) => onChange({ ...condition, maxWidth: event.target.value ? Number(event.target.value) : undefined })} />\n              <input className={controlClass} type="number" placeholder="min height" value={condition.minHeight ?? ''} onChange={(event) => onChange({ ...condition, minHeight: event.target.value ? Number(event.target.value) : undefined })} />\n              <input className={controlClass} type="number" placeholder="max height" value={condition.maxHeight ?? ''} onChange={(event) => onChange({ ...condition, maxHeight: event.target.value ? Number(event.target.value) : undefined })} />\n              <select className={controlClass} value={condition.fullscreen === undefined ? 'any' : condition.fullscreen ? 'true' : 'false'} onChange={(event) => onChange({ ...condition, fullscreen: event.target.value === 'any' ? undefined : event.target.value === 'true' })}>\n                <option value="any">Window mode: any</option><option value="true">Fullscreen</option><option value="false">Windowed</option>\n              </select>\n              <select className={controlClass} value={condition.mode} onChange={(event) => onChange({ ...condition, mode: event.target.value as 'any' | 'all' })}>\n                <option value="all">ALL</option><option value="any">ANY</option>\n              </select>\n              <div className="col-span-2 flex justify-end">{captureButton}</div>\n            </div>\n          )}\n'''
new_context = '''          {condition.type === 'contextMatch' && (\n            <div className="space-y-1.5">\n              <div className="grid grid-cols-[minmax(105px,1fr)_minmax(105px,1fr)_76px_auto] gap-1.5 items-start">\n                <input className={controlClass} placeholder="process.exe" value={condition.process || ''} onChange={(event) => onChange({ ...condition, process: event.target.value || undefined })} />\n                <input className={controlClass} placeholder="title contains" value={condition.title || ''} onChange={(event) => onChange({ ...condition, title: event.target.value || undefined })} />\n                <select className={controlClass} value={condition.mode} onChange={(event) => onChange({ ...condition, mode: event.target.value as 'any' | 'all' })}>\n                  <option value="all">ALL</option><option value="any">ANY</option>\n                </select>\n                {captureButton}\n              </div>\n              <details className="border border-app-border/60 bg-app-surface/20">\n                <summary className="h-6 px-2 flex items-center cursor-pointer select-none text-[10px] text-app-muted">Дополнительно</summary>\n                <div className="grid grid-cols-2 gap-1.5 p-1.5 border-t border-app-border/60">\n                  <input className={controlClass} placeholder="path contains" value={condition.path || ''} onChange={(event) => onChange({ ...condition, path: event.target.value || undefined })} />\n                  <input className={controlClass} placeholder="window class" value={condition.className || ''} onChange={(event) => onChange({ ...condition, className: event.target.value || undefined })} />\n                  <input className={controlClass} placeholder="virtual desktop GUID" value={condition.virtualDesktopId || ''} onChange={(event) => onChange({ ...condition, virtualDesktopId: event.target.value || undefined })} />\n                  <input className={controlClass} placeholder="monitor id" value={condition.monitorId || ''} onChange={(event) => onChange({ ...condition, monitorId: event.target.value || undefined })} />\n                  <input className={controlClass} type="number" placeholder="min width" value={condition.minWidth ?? ''} onChange={(event) => onChange({ ...condition, minWidth: event.target.value ? Number(event.target.value) : undefined })} />\n                  <input className={controlClass} type="number" placeholder="max width" value={condition.maxWidth ?? ''} onChange={(event) => onChange({ ...condition, maxWidth: event.target.value ? Number(event.target.value) : undefined })} />\n                  <input className={controlClass} type="number" placeholder="min height" value={condition.minHeight ?? ''} onChange={(event) => onChange({ ...condition, minHeight: event.target.value ? Number(event.target.value) : undefined })} />\n                  <input className={controlClass} type="number" placeholder="max height" value={condition.maxHeight ?? ''} onChange={(event) => onChange({ ...condition, maxHeight: event.target.value ? Number(event.target.value) : undefined })} />\n                  <select className={`${controlClass} col-span-2`} value={condition.fullscreen === undefined ? 'any' : condition.fullscreen ? 'true' : 'false'} onChange={(event) => onChange({ ...condition, fullscreen: event.target.value === 'any' ? undefined : event.target.value === 'true' })}>\n                    <option value="any">Window mode: any</option><option value="true">Fullscreen</option><option value="false">Windowed</option>\n                  </select>\n                </div>\n              </details>\n            </div>\n          )}\n'''
if old_context not in s:
    raise SystemExit("ConditionEditor contextMatch anchor missing")
s = s.replace(old_context, new_context, 1)
write(p, s)

# ---------------------------------------------------------------------------
# 3) Compact profile bindings. Rebuild the binding list using stable markers;
# rare fields live under "Дополнительно".
# ---------------------------------------------------------------------------
p = "src/components/ProfileAutomationPanel.tsx"
s = read(p)
start = s.find('''        {bindings.map((binding, index) => (''')
end_marker = '''        ))}\n      </div>'''
end = s.find(end_marker, start)
if start == -1 or end == -1:
    raise SystemExit("ProfileAutomationPanel bindings block markers missing")
replacement = r'''        {bindings.map((binding, index) => (
          <div key={index} className="border border-app-border/60 p-1 space-y-1">
            <div className="grid grid-cols-[minmax(100px,1fr)_minmax(100px,1fr)_70px_auto] gap-1">
              <input className={fieldClass} placeholder="process.exe" value={binding.process || ''} onChange={(event) => updateBinding(index, { process: event.target.value || undefined })} />
              <input className={fieldClass} placeholder="title contains" value={binding.title || ''} onChange={(event) => updateBinding(index, { title: event.target.value || undefined })} />
              <select className={fieldClass} value={binding.mode || 'any'} onChange={(event) => updateBinding(index, { mode: event.target.value as 'any' | 'all' })}><option value="any">ANY</option><option value="all">ALL</option></select>
              <button className="h-6 w-6 text-app-muted hover:text-app-danger" onClick={() => setBindings(bindings.filter((_, itemIndex) => itemIndex !== index))}>×</button>
            </div>
            <details className="border border-app-border/50 bg-app-surface/15">
              <summary className="h-5 px-1.5 flex items-center cursor-pointer select-none text-[9px] text-app-muted">Дополнительно</summary>
              <div className="grid grid-cols-2 gap-1 p-1 border-t border-app-border/50">
                <input className={fieldClass} placeholder="path contains" value={binding.path || ''} onChange={(event) => updateBinding(index, { path: event.target.value || undefined })} />
                <input className={fieldClass} placeholder="window class" value={binding.className || ''} onChange={(event) => updateBinding(index, { className: event.target.value || undefined })} />
                <input className={fieldClass} placeholder="virtual desktop GUID" value={binding.virtualDesktopId || ''} onChange={(event) => updateBinding(index, { virtualDesktopId: event.target.value || undefined })} />
                <input className={fieldClass} placeholder="monitor id" value={binding.monitorId || ''} onChange={(event) => updateBinding(index, { monitorId: event.target.value || undefined })} />
                <select className={`${fieldClass} col-span-2`} value={binding.fullscreen === undefined ? 'any' : binding.fullscreen ? 'true' : 'false'} onChange={(event) => updateBinding(index, { fullscreen: event.target.value === 'any' ? undefined : event.target.value === 'true' })}>
                  <option value="any">Any window mode</option><option value="true">Fullscreen</option><option value="false">Windowed</option>
                </select>
              </div>
            </details>
          </div>
        ))}
'''
s = s[:start] + replacement + s[end + len('''        ))}\n'''):]
write(p, s)

print("v0.3.2 DONE functional/UI fixes applied")
