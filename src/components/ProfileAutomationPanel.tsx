import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ArrowDown, ArrowUp, Copy, RotateCcw, Save } from 'lucide-react'
import { useProfileStore } from '../store/profileStore'
import { useAppStore } from '../store/appStore'
import type { ProfileBinding } from '../lib/types'

type CapturedContext = {
  process: string
  path: string
  title: string
  className: string
  virtualDesktopId: string
  monitorId: string
  fullscreen: boolean
}

const fieldClass = 'h-6 min-w-0 border border-app-border bg-app-bg px-1'

export const ProfileAutomationPanel: React.FC = () => {
  const { profiles, activeProfileId, saveProfile, renameProfile, duplicateProfile, reorderProfiles } = useProfileStore()
  const { config, setConfig } = useAppStore()
  const active = profiles.find((profile) => profile.id === activeProfileId)
  const [backups, setBackups] = useState<string[]>([])

  const loadBackups = async () => {
    if (!active) return
    const result = await invoke<{ backups: string[] }>('ipc_call', {
      method: 'profile.backups',
      params: { id: active.id },
    })
    setBackups(result.backups)
  }

  useEffect(() => {
    void loadBackups()
  }, [activeProfileId])

  if (!active) return null

  const bindings = active.bindings || []
  const setBindings = (next: ProfileBinding[]) => void saveProfile({ ...active, bindings: next })
  const updateBinding = (index: number, patch: Partial<ProfileBinding>) => {
    const next = [...bindings]
    next[index] = { ...next[index], ...patch }
    setBindings(next)
  }
  const capture = async () => {
    const context = await invoke<CapturedContext>('ipc_call', { method: 'get_active_window' })
    setBindings([
      ...bindings,
      {
        process: context.process,
        path: context.path,
        title: context.title,
        className: context.className,
        virtualDesktopId: context.virtualDesktopId,
        monitorId: context.monitorId,
        fullscreen: context.fullscreen,
        mode: 'all',
      },
    ])
  }
  const move = async (delta: number) => {
    const ids = profiles.map((profile) => profile.id)
    const from = ids.indexOf(active.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    await reorderProfiles(ids)
  }

  return (
    <div className="space-y-2 text-[10px]">
      <div className="flex flex-wrap gap-1">
        <button className="h-7 px-2 border border-app-border" onClick={() => {
          const name = prompt('Profile name', active.name)
          if (name?.trim()) void renameProfile(active.id, name.trim())
        }}>Rename</button>
        <button className="h-7 px-2 border border-app-border flex items-center gap-1" onClick={() => void duplicateProfile(active.id, `${active.name} copy`)}><Copy size={10} /> Duplicate</button>
        <button onClick={() => void move(-1)} className="h-7 w-7 border border-app-border"><ArrowUp size={11} /></button>
        <button onClick={() => void move(1)} className="h-7 w-7 border border-app-border"><ArrowDown size={11} /></button>
      </div>

      <label className="flex gap-2 items-center"><input type="checkbox" checked={Boolean(config.autoSwitchProfiles)} onChange={(event) => setConfig({ autoSwitchProfiles: event.target.checked })} />Auto-switch profiles</label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={Boolean(config.manualProfileLock)} onChange={(event) => setConfig({ manualProfileLock: event.target.checked })} />Manual profile lock</label>

      <div className="border border-app-border p-2 space-y-1">
        <div className="flex justify-between gap-2"><b>App/window bindings</b><button onClick={() => void capture()} className="border border-app-border px-2 h-6">Capture active context</button></div>
        {bindings.map((binding, index) => (
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
      </div>

      <div className="border border-app-border p-2">
        <button onClick={async () => { await invoke('ipc_call', { method: 'profile.backup.create', params: { id: active.id } }); await loadBackups() }} className="h-6 px-2 border border-app-border flex items-center gap-1"><Save size={10} /> Backup</button>
        {backups.slice(0, 5).map((name) => <div key={name} className="flex justify-between mt-1 gap-2"><span className="truncate">{name}</span><button title="Restore" onClick={async () => { await invoke('ipc_call', { method: 'profile.backup.restore', params: { id: active.id, name } }); await useProfileStore.getState().loadProfiles() }}><RotateCcw size={10} /></button></div>)}
      </div>
    </div>
  )
}
