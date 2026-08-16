from pathlib import Path

editor_path = Path('src/components/ruleBuilder/ConditionEditor.tsx')
text = editor_path.read_text(encoding='utf-8')
start_marker = "            {condition.type === 'contextMatch' && ("
end_marker = "            {condition.type === 'windowMatch' && ("
start = text.find(start_marker)
end = text.find(end_marker, start + 1)
if start < 0 or end <= start:
    raise SystemExit(f'ConditionEditor markers missing: start={start}, end={end}')

rich_editor = r'''            {condition.type === 'contextMatch' && (
              <div className="flex-1 min-w-0 grid grid-cols-2 gap-1">
                <input className={controlClass} placeholder="process.exe" value={condition.process || ''} onChange={(e) => onChange({ ...condition, process: e.target.value || undefined })} />
                <input className={controlClass} placeholder="path contains" value={condition.path || ''} onChange={(e) => onChange({ ...condition, path: e.target.value || undefined })} />
                <input className={controlClass} placeholder="title contains" value={condition.title || ''} onChange={(e) => onChange({ ...condition, title: e.target.value || undefined })} />
                <input className={controlClass} placeholder="window class" value={condition.className || ''} onChange={(e) => onChange({ ...condition, className: e.target.value || undefined })} />
                <input className={controlClass} placeholder="virtual desktop GUID" value={condition.virtualDesktopId || ''} onChange={(e) => onChange({ ...condition, virtualDesktopId: e.target.value || undefined })} />
                <input className={controlClass} placeholder="monitor id" value={condition.monitorId || ''} onChange={(e) => onChange({ ...condition, monitorId: e.target.value || undefined })} />
                <input className={controlClass} type="number" placeholder="min width" value={condition.minWidth ?? ''} onChange={(e) => onChange({ ...condition, minWidth: e.target.value ? Number(e.target.value) : undefined })} />
                <input className={controlClass} type="number" placeholder="max width" value={condition.maxWidth ?? ''} onChange={(e) => onChange({ ...condition, maxWidth: e.target.value ? Number(e.target.value) : undefined })} />
                <input className={controlClass} type="number" placeholder="min height" value={condition.minHeight ?? ''} onChange={(e) => onChange({ ...condition, minHeight: e.target.value ? Number(e.target.value) : undefined })} />
                <input className={controlClass} type="number" placeholder="max height" value={condition.maxHeight ?? ''} onChange={(e) => onChange({ ...condition, maxHeight: e.target.value ? Number(e.target.value) : undefined })} />
                <select className={selectClass} value={condition.fullscreen === undefined ? 'any' : condition.fullscreen ? 'true' : 'false'} onChange={(e) => onChange({ ...condition, fullscreen: e.target.value === 'any' ? undefined : e.target.value === 'true' })}><option value="any">Window mode: any</option><option value="true">Fullscreen</option><option value="false">Windowed</option></select>
                <select className={selectClass} value={condition.mode} onChange={(e) => onChange({ ...condition, mode: e.target.value as 'any' | 'all' })}><option value="all">ALL</option><option value="any">ANY</option></select>
                <button type="button" className="h-7 px-2 border border-app-border col-span-2" onClick={async () => { const c = await invoke<any>('ipc_call', { method: 'get_active_window' }); onChange({ ...condition, process: c.process, path: c.path, title: c.title, className: c.className, virtualDesktopId: c.virtualDesktopId, monitorId: c.monitorId, fullscreen: c.fullscreen }) }}>Capture active context</button>
              </div>
            )}
'''
editor_path.write_text(text[:start] + rich_editor + text[end:], encoding='utf-8')

# The main audit script still contains its older regex attempt. Make its guard
# idempotent: this pre-step has already installed the full rich editor.
fix_path = Path('scripts/v032_current_fix.py')
fix = fix_path.read_text(encoding='utf-8')
old = '''if count != 1:\n    raise SystemExit(f"ContextMatch editor replacement count={count}")'''
new = '''if count != 1 and "Capture active context" not in s:\n    raise SystemExit(f"ContextMatch editor replacement count={count}")'''
if old not in fix:
    raise SystemExit('current-fix ContextMatch guard anchor missing')
fix_path.write_text(fix.replace(old, new, 1), encoding='utf-8')
print('Format-independent rich ContextMatch editor installed')