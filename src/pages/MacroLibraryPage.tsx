import { useEffect, useMemo, useState } from 'react'
import { Copy, Play, Plus, Save, Square, Trash2 } from 'lucide-react'
import { invoke } from '../lib/ipc'
import type { MacroDefinition } from '../lib/types'
import { MacroEditor } from '../components/ruleBuilder/MacroEditor'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useProfileStore } from '../store/profileStore'
import { useKeyMasterStore } from '../store/keyMasterStore'

const inputClass = 'h-7 border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary'

function usageCount(macroId: string, rules: ReturnType<typeof useProfileStore.getState>['profiles'][number]['rules']): number {
  return rules.reduce((count, rule) => {
    const actions = [...rule.actions, ...(rule.holdActions ?? [])]
    return count + actions.filter((action) => action.type === 'runMacro' && action.macroId === macroId).length
  }, 0)
}

export function MacroLibraryPage() {
  const { profiles, activeProfileId, saveProfile } = useProfileStore()
  const setRulesDirty = useKeyMasterStore((state) => state.setRulesDirty)
  const profile = profiles.find((item) => item.id === activeProfileId) ?? null
  const macros = profile?.macros ?? []
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<MacroDefinition | null>(null)
  const [baseline, setBaseline] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MacroDefinition | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return macros
    return macros.filter((macro) => macro.name.toLocaleLowerCase().includes(needle))
  }, [macros, query])

  const dirty = Boolean(draft) && (isNew || JSON.stringify(draft) !== baseline)
  useEffect(() => { setRulesDirty(dirty) }, [dirty, setRulesDirty])
  useEffect(() => () => useKeyMasterStore.getState().setRulesDirty(false), [])

  const openMacro = (macro: MacroDefinition) => {
    const copy = structuredClone(macro)
    setSelectedId(macro.id)
    setDraft(copy)
    setBaseline(JSON.stringify(copy))
    setIsNew(false)
  }

  useEffect(() => {
    if (!profile) return
    const current = profile.macros.find((macro) => macro.id === selectedId)
    if (current && !isNew) {
      openMacro(current)
      return
    }
    if (profile.macros[0]) openMacro(profile.macros[0])
    else { setSelectedId(null); setDraft(null); setBaseline(''); setIsNew(false) }
    // Only reset when the active profile changes; saves are handled explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId])

  const createMacro = () => {
    const next: MacroDefinition = { id: crypto.randomUUID(), name: 'Новый макрос', steps: [] }
    setSelectedId(null)
    setDraft(next)
    setBaseline(JSON.stringify(next))
    setIsNew(true)
  }

  const saveDraft = async () => {
    if (!profile || !draft || saving) return
    const normalized = { ...draft, name: draft.name.trim() || 'Без названия' }
    const nextMacros = isNew
      ? [...profile.macros, normalized]
      : profile.macros.map((macro) => macro.id === normalized.id ? normalized : macro)
    setSaving(true)
    try {
      if (!await saveProfile({ ...profile, macros: nextMacros })) return
      setDraft(normalized)
      setSelectedId(normalized.id)
      setBaseline(JSON.stringify(normalized))
      setIsNew(false)
    } finally {
      setSaving(false)
    }
  }

  const duplicateDraft = () => {
    if (!draft) return
    const copy: MacroDefinition = { ...structuredClone(draft), id: crypto.randomUUID(), name: `${draft.name} — копия` }
    setSelectedId(null)
    setDraft(copy)
    setBaseline(JSON.stringify(copy))
    setIsNew(true)
  }

  const removeMacro = async (macro: MacroDefinition) => {
    if (!profile || saving) return
    if (usageCount(macro.id, profile.rules) > 0) return
    setSaving(true)
    try {
      const nextMacros = profile.macros.filter((item) => item.id !== macro.id)
      if (!await saveProfile({ ...profile, macros: nextMacros })) return
      const next = nextMacros[0] ?? null
      if (next) openMacro(next)
      else { setSelectedId(null); setDraft(null); setBaseline(''); setIsNew(false) }
      setDeleteTarget(null)
    } finally {
      setSaving(false)
    }
  }

  if (!profile) return <div className="h-full flex items-center justify-center text-[11px] text-app-muted">Нет активного профиля</div>

  const draftUsage = draft && !isNew ? usageCount(draft.id, profile.rules) : 0

  return (
    <>
      <div className="h-full min-h-0 flex bg-app-bg overflow-hidden">
        <aside className="w-[238px] shrink-0 border-r border-app-border bg-app-surface/15 flex flex-col min-h-0">
          <div className="h-9 px-2 flex items-center border-b border-app-border">
            <span className="text-[11px] font-semibold text-app-text">Макросы</span>
            <span className="ml-1.5 text-[9px] text-app-muted">{macros.length}</span>
            <button type="button" onClick={createMacro} className="ml-auto h-6 px-2 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface">
              <Plus size={10} /> Новый
            </button>
          </div>
          <div className="p-1.5 border-b border-app-border">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск макроса…" className={`${inputClass} w-full`} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-1">
            {filtered.length === 0 && <div className="px-2 py-3 text-[10px] text-app-muted">Макросов пока нет</div>}
            {filtered.map((macro) => {
              const active = !isNew && selectedId === macro.id
              const used = usageCount(macro.id, profile.rules)
              return (
                <button key={macro.id} type="button" onClick={() => openMacro(macro)} className={`w-full min-h-9 px-2 py-1 text-left border-l-2 ${active ? 'border-app-primary bg-app-primary/10' : 'border-transparent hover:bg-app-surface'}`}>
                  <div className="text-[10px] font-medium text-app-text truncate">{macro.name}</div>
                  <div className="mt-0.5 text-[9px] text-app-muted">{macro.steps.length} шаг. · правил: {used}</div>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="h-9 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
            <span className="text-[11px] font-semibold text-app-text">{isNew ? 'Новый макрос' : 'Редактор макроса'}</span>
            {dirty && <span className="ml-2 text-[9px] text-app-warning">● не сохранён</span>}
            {draft && (
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={duplicateDraft} className="h-6 px-2 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface"><Copy size={10} /> Копия</button>
                {!isNew && (
                  <button type="button" disabled={draftUsage > 0} onClick={() => setDeleteTarget(draft)} title={draftUsage > 0 ? `Используется в ${draftUsage} правилах` : 'Удалить'} className="h-6 w-6 inline-flex items-center justify-center border border-app-border bg-app-bg text-app-muted hover:text-app-danger disabled:opacity-30"><Trash2 size={11} /></button>
                )}
                <button type="button" disabled={!dirty || saving} onClick={() => void saveDraft()} className="h-6 px-2.5 inline-flex items-center gap-1 border border-app-primary bg-app-primary text-[9px] font-semibold text-white disabled:opacity-30"><Save size={10} /> Сохранить</button>
              </div>
            )}
          </div>

          {!draft ? (
            <div className="flex-1 flex items-center justify-center text-[10px] text-app-muted">Создайте первый макрос или выберите существующий.</div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              <div className="max-w-[900px] space-y-2">
                <section className="border border-app-border bg-app-bg">
                  <div className="h-7 px-2 flex items-center border-b border-app-border bg-app-surface/35 text-[10px] font-semibold">Макрос</div>
                  <div className="p-1.5 flex items-center gap-1.5">
                    <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={`${inputClass} flex-1`} placeholder="Название макроса" />
                    <span className="text-[9px] text-app-muted">Используется в {draftUsage} правил.</span>
                    <button type="button" disabled={draft.steps.length === 0} onClick={() => void invoke('ipc_call', { method: 'macro.preview', params: { steps: draft.steps, playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } } })} className="h-7 px-2 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[9px] text-app-text disabled:opacity-30"><Play size={10} /> Тест</button>
                    <button type="button" onClick={() => void invoke('ipc_call', { method: 'macro.stop_playback' })} className="h-7 px-2 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[9px] text-app-text"><Square size={9} /> Стоп</button>
                  </div>
                </section>
                <section className="border border-app-border bg-app-bg">
                  <div className="h-7 px-2 flex items-center border-b border-app-border bg-app-surface/35 text-[10px] font-semibold">Шаги и запись</div>
                  <div className="p-1.5"><MacroEditor steps={draft.steps} onChange={(steps) => setDraft({ ...draft, steps })} /></div>
                </section>
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить макрос"
        message={deleteTarget ? `Удалить макрос “${deleteTarget.name}”?` : ''}
        danger
        confirmLabel="Удалить"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) await removeMacro(deleteTarget) }}
      />
    </>
  )
}
