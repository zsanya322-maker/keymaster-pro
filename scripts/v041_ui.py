from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:160]!r}')
    write(path, text.replace(old, new, 1))


# ---------------- compact searchable type pickers ----------------
Path('src/components/ruleBuilder/RuleTypePickers.tsx').write_text(r'''import { useEffect, useMemo, useRef, useState } from 'react'
import type { FrontendAction, FrontendCondition, FrontendTrigger } from '../../lib/types'

type Option = {
  value: string
  label: string
  description: string
  group: string
  keywords?: string
}

interface PickerProps {
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  widthClass?: string
}

function CompactTypePicker({ value, options, onChange, disabled, widthClass = 'w-[190px]' }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [])

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const filtered = needle
      ? options.filter((option) => `${option.label} ${option.description} ${option.keywords ?? ''}`.toLocaleLowerCase().includes(needle))
      : options
    const grouped = new Map<string, Option[]>()
    for (const option of filtered) grouped.set(option.group, [...(grouped.get(option.group) ?? []), option])
    return [...grouped.entries()]
  }, [options, query])

  return (
    <div ref={rootRef} className={`relative shrink-0 ${widthClass}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((value) => !value); setQuery('') }}
        className="h-7 w-full px-2 border border-app-border bg-app-surface/35 text-[10px] text-left text-app-text hover:bg-app-surface disabled:opacity-50 flex items-center gap-2"
      >
        <span className="truncate">{selected?.label ?? 'Выбрать…'}</span>
        <span className="ml-auto text-app-muted">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-8 w-[340px] max-w-[70vw] border border-app-border bg-app-bg shadow-xl">
          <div className="p-1.5 border-b border-app-border">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти…"
              className="h-7 w-full border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto py-1">
            {groups.length === 0 && <div className="px-2 py-3 text-[10px] text-app-muted">Ничего не найдено</div>}
            {groups.map(([group, items]) => (
              <div key={group} className="pb-1">
                <div className="px-2 pt-1.5 pb-1 text-[9px] uppercase tracking-wide text-app-muted">{group}</div>
                {items.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { onChange(option.value); setOpen(false) }}
                    className={`w-full px-2 py-1.5 text-left hover:bg-app-surface ${option.value === value ? 'bg-app-primary/8' : ''}`}
                  >
                    <div className="text-[10px] font-medium text-app-text">{option.label}</div>
                    <div className="mt-0.5 text-[9px] leading-4 text-app-muted">{option.description}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const triggerOptions: Option[] = [
  { value: 'keyDown', label: 'Клавиша / комбинация', description: 'Обычная горячая клавиша, например Ctrl+F8.', group: 'Основные', keywords: 'hotkey keyboard' },
  { value: 'mouseDown', label: 'Кнопка мыши', description: 'Левая, правая, средняя или боковая кнопка.', group: 'Основные', keywords: 'mouse' },
  { value: 'typedText', label: 'Введено сокращение', description: 'Текстовая подстановка после набора последовательности.', group: 'Основные', keywords: 'text expansion' },
  { value: 'tapHoldKeyDown', label: 'Короткое / долгое нажатие', description: 'Разные действия для tap и hold одной клавиши.', group: 'Клавиатура' },
  { value: 'keySequence', label: 'Последовательность клавиш', description: 'Несколько клавиш строго по порядку.', group: 'Клавиатура' },
  { value: 'leaderSequence', label: 'Лидер + последовательность', description: 'Сначала leader, затем короткая последовательность.', group: 'Клавиатура' },
  { value: 'keyChordSet', label: 'Аккорд из 3+ клавиш', description: 'Несколько клавиш, нажатых почти одновременно.', group: 'Клавиатура' },
  { value: 'keyUp', label: 'Клавиша отпущена', description: 'Продвинутый триггер на отпускание клавиши.', group: 'Клавиатура · дополнительно' },
  { value: 'mouseWheel', label: 'Колесо мыши', description: 'Вертикальное или горизонтальное колесо.', group: 'Мышь' },
  { value: 'mouseDoubleClick', label: 'Двойной клик', description: 'Двойное нажатие выбранной кнопки мыши.', group: 'Мышь' },
  { value: 'mouseGesture', label: 'Жест мышью', description: 'Удержание кнопки + цепочка направлений.', group: 'Мышь' },
  { value: 'mouseUp', label: 'Кнопка мыши отпущена', description: 'Продвинутый триггер на отпускание.', group: 'Мышь · дополнительно' },
  { value: 'mouseMove', label: 'Движение мыши', description: 'Срабатывание после заданной дистанции.', group: 'Мышь · дополнительно' },
]

const actionOptions: Option[] = [
  { value: 'remapKey', label: 'Клавиша / комбинация', description: 'Нажать другую клавишу или сочетание.', group: 'Часто используемые', keywords: 'remap keyboard' },
  { value: 'remapMouse', label: 'Кнопка мыши', description: 'Нажать другую кнопку мыши.', group: 'Часто используемые' },
  { value: 'runMacro', label: 'Запустить макрос', description: 'Запустить макрос из библиотеки.', group: 'Часто используемые', keywords: 'macro' },
  { value: 'typeText', label: 'Ввести текст', description: 'Напечатать текст, дату, время или буфер обмена.', group: 'Часто используемые' },
  { value: 'launchApp', label: 'Запустить программу', description: 'Открыть EXE, ярлык, BAT или CMD.', group: 'Приложения и окна' },
  { value: 'focusProcess', label: 'Переключиться на окно', description: 'Найти уже открытое приложение или окно.', group: 'Приложения и окна' },
  { value: 'windowAction', label: 'Управление окном', description: 'Свернуть, развернуть, закрыть или привязать окно.', group: 'Приложения и окна' },
  { value: 'systemVolume', label: 'Громкость', description: 'Громче, тише или mute.', group: 'Медиа и система' },
  { value: 'mediaKey', label: 'Мультимедиа', description: 'Play/Pause, следующий, предыдущий, стоп.', group: 'Медиа и система' },
  { value: 'monitorOff', label: 'Выключить монитор', description: 'Системная команда отключения дисплея.', group: 'Медиа и система' },
  { value: 'toggleLayer', label: 'Переключить слой', description: 'Включить или выключить слой.', group: 'Слои' },
  { value: 'holdLayer', label: 'Удерживать слой', description: 'Активировать слой на время удержания.', group: 'Слои' },
  { value: 'sleep', label: 'Пауза', description: 'Системная пауза в цепочке действий.', group: 'Дополнительно' },
]

const conditionOptions: Option[] = [
  { value: 'contextMatch', label: 'Приложение / окно', description: 'Ограничить правило процессом, заголовком или контекстом окна.', group: 'Ограничения', keywords: 'window process app context' },
  { value: 'layerActive', label: 'Активен слой', description: 'Выполнять правило только при активном слое.', group: 'Ограничения' },
]

export function TriggerTypePicker({ value, onChange, disabled }: { value: FrontendTrigger['type']; onChange: (value: FrontendTrigger['type']) => void; disabled?: boolean }) {
  return <CompactTypePicker value={value} options={triggerOptions} onChange={(next) => onChange(next as FrontendTrigger['type'])} disabled={disabled} />
}

export function ActionTypePicker({ value, onChange, disabled }: { value: FrontendAction['type']; onChange: (value: FrontendAction['type']) => void; disabled?: boolean }) {
  return <CompactTypePicker value={value} options={actionOptions} onChange={(next) => onChange(next as FrontendAction['type'])} disabled={disabled} widthClass="w-[170px]" />
}

export function ConditionTypePicker({ value, onChange, disabled }: { value: FrontendCondition['type']; onChange: (value: FrontendCondition['type']) => void; disabled?: boolean }) {
  const effective = value === 'windowMatch' ? 'contextMatch' : value
  return <CompactTypePicker value={effective} options={conditionOptions} onChange={(next) => onChange(next as FrontendCondition['type'])} disabled={disabled} widthClass="w-[170px]" />
}
''', encoding='utf-8')

# ---------------- real macro library page ----------------
Path('src/pages/MacroLibraryPage.tsx').write_text(r'''import { useEffect, useMemo, useState } from 'react'
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
''', encoding='utf-8')

# ---------------- navigation shell ----------------
p = 'src/store/keyMasterStore.ts'
text = read(p).replace("export type Category = 'rules' | 'layers' | 'macros' | 'text' | 'settings';", "export type Category = 'rules' | 'layers' | 'macros' | 'settings';", 1)
write(p, text)

p = 'src/app/ShellSidebar.tsx'
text = read(p)
text = text.replace("import { Activity, FileText, Keyboard, Layers, Settings } from 'lucide-react'", "import { Activity, Keyboard, Layers, Settings } from 'lucide-react'", 1)
text = text.replace(
'''    { id: 'rules' as const, label: t('nav.rules'), icon: Keyboard },
    { id: 'layers' as const, label: t('nav.layers'), icon: Layers },
    { id: 'macros' as const, label: t('nav.macros'), icon: Activity },
    { id: 'text' as const, label: t('nav.text'), icon: FileText },
    { id: 'settings' as const, label: t('nav.settings'), icon: Settings },''',
'''    { id: 'rules' as const, label: t('nav.rules'), icon: Keyboard },
    { id: 'macros' as const, label: t('nav.macros'), icon: Activity },
    { id: 'layers' as const, label: t('nav.layers'), icon: Layers },
    { id: 'settings' as const, label: t('nav.settings'), icon: Settings },''',
1,
)
write(p, text)

p = 'src/app/App.tsx'
text = read(p)
text = text.replace("import { RulesPage } from '../pages/RulesPage'", "import { RulesPage } from '../pages/RulesPage'\nimport { MacroLibraryPage } from '../pages/MacroLibraryPage'", 1)
text = text.replace('const PROFILE_SCHEMA_VERSION = 6', 'const PROFILE_SCHEMA_VERSION = 7', 1)
text = text.replace(
'''  const macroCount = activeProfile?.rules.filter((rule) => rule.actions.some((action) => action.type === 'runMacro')).length ?? 0''',
'''  const macroCount = activeProfile?.macros?.length ?? 0''',
1,
)
text = text.replace(
'''  const isRulesWorkspace = activeCategory === 'rules' || activeCategory === 'macros' || activeCategory === 'text' ''',
'''  const isRulesWorkspace = activeCategory === 'rules' ''',
1,
) if "activeCategory === 'rules' || activeCategory === 'macros' || activeCategory === 'text' " in text else text
text = text.replace(
"  const isRulesWorkspace = activeCategory === 'rules' || activeCategory === 'macros' || activeCategory === 'text'",
"  const isRulesWorkspace = activeCategory === 'rules'",
1,
)
text = text.replace(
'''          {activeCategory === 'rules' && <RulesPage mode="all" />}
          {activeCategory === 'macros' && <RulesPage mode="macros" />}
          {activeCategory === 'text' && <RulesPage mode="text" />}
          {activeCategory === 'layers' && <LayersPanel />}''',
'''          {activeCategory === 'rules' && <RulesPage mode="all" />}
          {activeCategory === 'macros' && <MacroLibraryPage />}
          {activeCategory === 'layers' && <LayersPanel />}''',
1,
)
write(p, text)

# ---------------- action editor ----------------
p = 'src/components/ruleBuilder/ActionEditor.tsx'
text = read(p)
text = text.replace("import { MacroEditor } from './MacroEditor';\n", '', 1)
text = text.replace("import { useProfileStore } from '../../store/profileStore';", "import { useProfileStore } from '../../store/profileStore';\nimport { ActionTypePicker } from './RuleTypePickers';", 1)
text = text.replace(
'''  const layers = activeProfile?.layers || [];
  const showContentBelow = action.type === 'runMacro';''',
'''  const layers = activeProfile?.layers || [];
  const macros = activeProfile?.macros || [];
  const selectedMacro = action.type === 'runMacro' ? macros.find((macro) => macro.id === action.macroId) : undefined;
  const showContentBelow = false;''',
1,
)
text = text.replace(
'''    } else if (type === 'runMacro') {
      onChange({ type, steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } });''',
'''    } else if (type === 'runMacro') {
      onChange({ type, macroId: macros[0]?.id ?? '', playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } });''',
1,
)
# Replace the flat action type select.
text, count = re.subn(
    r'''        <select\n          value=\{action\.type\}.*?        </select>''',
    '''        <ActionTypePicker value={action.type} onChange={changeType} />''',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('Action type select replacement failed')
# Add compact macro reference controls before remapKey fields.
anchor = '''            {action.type === 'remapKey' && ('''
macro_ui = r'''            {action.type === 'runMacro' && (
              <>
                {macros.length === 0 ? (
                  <div className="h-7 flex-1 flex items-center text-[10px] text-app-danger">Сначала создайте макрос во вкладке «Макросы».</div>
                ) : (
                  <select value={action.macroId} onChange={(event) => onChange({ ...action, macroId: event.target.value })} className={`${selectClass} flex-1 min-w-0`}>
                    {!action.macroId && <option value="">Выберите макрос…</option>}
                    {macros.map((macro) => <option key={macro.id} value={macro.id}>{macro.name}</option>)}
                  </select>
                )}
                <button
                  type="button"
                  disabled={!selectedMacro || selectedMacro.steps.length === 0}
                  onClick={() => {
                    if (!selectedMacro) return;
                    void invoke('ipc_call', { method: 'macro.preview', params: { steps: selectedMacro.steps, playback: action.playback } })
                      .catch((error) => console.error('Macro preview failed', error));
                  }}
                  className="h-7 px-2 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface disabled:opacity-35"
                >
                  <Play size={10} /> Тест
                </button>
                <button type="button" onClick={() => void invoke('ipc_call', { method: 'macro.stop_playback' })} className="h-7 w-7 inline-flex items-center justify-center border border-app-border bg-app-bg text-app-muted hover:bg-app-surface" title="Стоп"><Square size={9} /></button>
                <details className="relative shrink-0">
                  <summary className="list-none h-7 px-2 inline-flex items-center border border-app-border bg-app-bg text-[9px] text-app-muted hover:bg-app-surface cursor-pointer">Доп.</summary>
                  <div className="absolute z-40 right-0 top-8 w-60 border border-app-border bg-app-bg shadow-lg p-2 space-y-2">
                    <label className="block"><span className="block mb-1 text-[9px] text-app-muted">Скорость</span>
                      <select value={action.playback.speed} onChange={(event) => onChange({ ...action, playback: { ...action.playback, speed: Number.parseFloat(event.target.value) || 1 } })} className={`${selectClass} w-full`}>
                        {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
                      </select>
                    </label>
                    <label className="block"><span className="block mb-1 text-[9px] text-app-muted">Повторов</span>
                      <input type="number" min={1} max={10000} value={action.playback.repeatCount} disabled={action.playback.repeatWhileHeld} onChange={(event) => onChange({ ...action, playback: { ...action.playback, repeatCount: Math.max(1, Math.min(10000, Number.parseInt(event.target.value, 10) || 1)) } })} className={`${controlClass} w-full font-mono disabled:opacity-40`} />
                    </label>
                    <label className="flex items-center gap-2 text-[10px] text-app-text cursor-pointer"><input type="checkbox" checked={action.playback.repeatWhileHeld} onChange={(event) => onChange({ ...action, playback: { ...action.playback, repeatWhileHeld: event.target.checked } })} />Повторять, пока удерживается триггер</label>
                  </div>
                </details>
              </>
            )}

'''
if anchor not in text:
    raise SystemExit('remapKey anchor missing in ActionEditor')
text = text.replace(anchor, macro_ui + anchor, 1)
# Remove old below-the-rule inline MacroEditor block entirely.
text, count = re.subn(
    r'''\n      \{action\.type === 'runMacro' && \(\n        <div className="border-t border-app-border/70 p-1\.5">.*?\n      \)\}\n''',
    '\n',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('old inline MacroEditor block removal failed')
write(p, text)

# ---------------- condition editor ----------------
p = 'src/components/ruleBuilder/ConditionEditor.tsx'
text = read(p)
text = text.replace("import { useProfileStore } from '../../store/profileStore';", "import { useProfileStore } from '../../store/profileStore';\nimport { ConditionTypePicker } from './RuleTypePickers';", 1)
text, count = re.subn(
    r'''        <select\n          value=\{condition\.type\}.*?        </select>''',
    '''        <ConditionTypePicker
          value={condition.type}
          onChange={(type) => {
            if (type === 'layerActive') onChange({ type: 'layerActive', layerId: '' });
            else onChange({ type: 'contextMatch', mode: 'all' });
          }}
        />''',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('Condition type select replacement failed')
text = text.replace('placeholder="process.exe"', 'placeholder="Процесс, например chrome.exe"')
text = text.replace('placeholder="title contains"', 'placeholder="Заголовок содержит…"')
text = text.replace('<option value="all">ALL</option><option value="any">ANY</option>', '<option value="all">Все поля</option><option value="any">Любое поле</option>')
text = text.replace('placeholder="path contains"', 'placeholder="Путь содержит…"')
text = text.replace('placeholder="window class"', 'placeholder="Класс окна"')
text = text.replace('placeholder="virtual desktop GUID"', 'placeholder="ID рабочего стола"')
text = text.replace('placeholder="monitor id"', 'placeholder="ID монитора"')
text = text.replace('<option value="any">Window mode: any</option><option value="true">Fullscreen</option><option value="false">Windowed</option>', '<option value="any">Режим окна: любой</option><option value="true">Полный экран</option><option value="false">Оконный режим</option>')
write(p, text)

# ---------------- rule editor: WHEN -> IF -> DO + filters + starter templates ----------------
p = 'src/pages/RulesPage.tsx'
text = read(p)
text = text.replace("import { AdvancedTriggerEditor } from '../components/ruleBuilder/AdvancedTriggerEditor';", "import { AdvancedTriggerEditor } from '../components/ruleBuilder/AdvancedTriggerEditor';\nimport { TriggerTypePicker } from '../components/ruleBuilder/RuleTypePickers';", 1)
text = text.replace("    case 'runMacro': return `${t('ruleBuilder.action_types.runMacro')} (${action.steps.length})`;", "    case 'runMacro': return t('ruleBuilder.action_types.runMacro');", 1)
text = text.replace("actions: [{ type: 'runMacro', steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }],", "actions: [{ type: 'runMacro', macroId: '', playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }],", 1)
# Human context label.
text = text.replace('return `Context (${condition.mode.toUpperCase()}): ${parts.length ? parts.join(\' / \') : \'—\'}`', 'return `Приложение / окно: ${parts.length ? parts.join(\' / \') : \'—\'}`', 1)
# Kind helper after matchesMode.
anchor = '''function baseRule(order = 0): Pick<FrontendRule, 'id' | 'name' | 'holdActions' | 'conditions' | 'priority' | 'enabled' | 'folderId' | 'order'> {'''
helper = r'''type RuleKindFilter = 'all' | 'keyboard' | 'mouse' | 'text' | 'macro';

function matchesKind(rule: FrontendRule, kind: RuleKindFilter): boolean {
  if (kind === 'all') return true;
  if (kind === 'text') return rule.trigger.type === 'typedText' || rule.actions.some((action) => action.type === 'typeText');
  if (kind === 'macro') return [...rule.actions, ...(rule.holdActions ?? [])].some((action) => action.type === 'runMacro');
  if (kind === 'mouse') return ['mouseDown', 'mouseUp', 'mouseWheel', 'mouseDoubleClick', 'mouseMove', 'mouseGesture'].includes(rule.trigger.type);
  return ['keyDown', 'keyUp', 'tapHoldKeyDown', 'leaderSequence', 'keySequence', 'keyChordSet'].includes(rule.trigger.type);
}

'''
if anchor not in text:
    raise SystemExit('baseRule anchor missing')
text = text.replace(anchor, helper + anchor, 1)
text = text.replace("  const [query, setQuery] = useState('');", "  const [query, setQuery] = useState('');\n  const [ruleKind, setRuleKind] = useState<RuleKindFilter>('all');", 1)
text = text.replace(
'''    if (!needle) return modeRules;

    return modeRules.filter((rule) => {''',
'''    const kindRules = modeRules.filter((rule) => matchesKind(rule, ruleKind));
    if (!needle) return kindRules;

    return kindRules.filter((rule) => {''',
1,
)
text = text.replace('  }, [modeRules, query, t]);', '  }, [modeRules, query, ruleKind, t]);', 1)
# Trigger title and flat select -> searchable picker.
text = text.replace("<EditorSection title={t('ruleBuilder.tabs.trigger')}>", '<EditorSection title="КОГДА">', 1)
text, count = re.subn(
    r'''                    <select\n                      value=\{draftRule\.trigger\.type\}.*?                    </select>''',
    '''                    <TriggerTypePicker
                      value={draftRule.trigger.type}
                      disabled={saving}
                      onChange={(type) => setDraftRule(changeTriggerType(draftRule, type))}
                    />''',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('Trigger type select replacement failed')
# Replace old Advanced+conditions block with visible IF plus compact advanced rule settings.
pattern = r'''                <details className="border border-app-border bg-app-bg group">\n                  <summary.*?                </details>\n\n                <EditorSection\n                  title=\{isTapHold \? t\('ruleBuilder\.tabs\.tap_actions'\) : t\('ruleBuilder\.tabs\.actions'\)\}'''
replacement = r'''                <EditorSection
                  title="ЕСЛИ · Ограничения"
                  action={(
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setDraftRule({ ...draftRule, conditions: [...draftRule.conditions, { type: 'contextMatch', mode: 'all' }] })}
                      className="h-5 px-1.5 text-[9px] text-app-primary hover:bg-app-surface disabled:opacity-40"
                    >
                      + Добавить ограничение
                    </button>
                  )}
                >
                  <div className="p-1.5">
                    {draftRule.conditions.length === 0 ? (
                      <div className="h-7 px-1 flex items-center text-[10px] text-app-muted">Без ограничений — правило работает везде.</div>
                    ) : (
                      <div className={`space-y-1 ${saving ? 'pointer-events-none opacity-60' : ''}`}>
                        {draftRule.conditions.map((condition, index) => (
                          <ConditionEditor
                            key={index}
                            condition={condition}
                            onChange={(nextCondition) => {
                              const conditions = [...draftRule.conditions];
                              conditions[index] = nextCondition;
                              setDraftRule({ ...draftRule, conditions });
                            }}
                            onRemove={() => setDraftRule({ ...draftRule, conditions: draftRule.conditions.filter((_, itemIndex) => itemIndex !== index) })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </EditorSection>

                <details className="border border-app-border bg-app-bg group">
                  <summary className="h-7 px-2 flex items-center cursor-pointer select-none bg-app-surface/25 text-[10px] text-app-muted hover:text-app-text">
                    Дополнительно
                    <span className="ml-auto text-[9px]">приоритет · вкл/выкл</span>
                  </summary>
                  <div className="border-t border-app-border">
                    <PropertyRow label={t('ruleBuilder.priority')} hint={t('ruleBuilder.priority_hint')}>
                      <input type="number" value={draftRule.priority} disabled={saving} onChange={(event) => setDraftRule({ ...draftRule, priority: Number.parseInt(event.target.value, 10) || 0 })} className={`${inputClass} w-24 font-mono disabled:opacity-50`} />
                    </PropertyRow>
                    <PropertyRow label={t('common.enabled', { defaultValue: 'Включено' })} last>
                      <input type="checkbox" checked={draftRule.enabled} disabled={saving} onChange={(event) => setDraftRule({ ...draftRule, enabled: event.target.checked })} />
                    </PropertyRow>
                  </div>
                </details>

                <EditorSection
                  title={isTapHold ? 'СДЕЛАТЬ · короткое нажатие' : 'СДЕЛАТЬ'}'''
text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit('WHEN/IF/DO conditions block replacement failed')
text = text.replace("title={t('ruleBuilder.tabs.hold_actions')}", 'title="СДЕЛАТЬ · удержание"', 1)
# Add filter chips in editor header after title.
anchor = '''            </h2>
            {isDirty && <span className="ml-2 text-[9px] text-app-warning">● {t('rules.unsaved')}</span>}'''
chips = r'''            </h2>
            <div className="ml-3 flex items-center gap-0.5">
              {([
                ['all', 'Все'], ['keyboard', 'Клавиши'], ['mouse', 'Мышь'], ['text', 'Текст'], ['macro', 'Макросы'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setRuleKind(value)} className={`h-5 px-1.5 text-[8px] border ${ruleKind === value ? 'border-app-primary bg-app-primary/10 text-app-primary' : 'border-app-border bg-app-bg text-app-muted hover:text-app-text'}`}>{label}</button>
              ))}
            </div>
            {isDirty && <span className="ml-2 text-[9px] text-app-warning">● {t('rules.unsaved')}</span>}'''
if anchor not in text:
    raise SystemExit('editor header chip anchor missing')
text = text.replace(anchor, chips, 1)
# Add quick-start presets before WHEN for new rules.
anchor = '''                <EditorSection title="КОГДА">'''
starter = r'''                {isNewRule && (
                  <EditorSection title="Быстрый старт">
                    <div className="p-1.5 flex flex-wrap gap-1">
                      <button type="button" onClick={() => setDraftRule({ ...draftRule, trigger: { type: 'keyDown', code: 0, modifiers: 0 }, actions: [{ type: 'remapKey', code: 0, modifiers: 0 }], conditions: [] })} className="h-7 px-2 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface">Переназначить клавишу</button>
                      <button type="button" onClick={() => setDraftRule({ ...draftRule, trigger: { type: 'typedText', sequence: '', mode: 'instant', delimiters: ' \\t\\n.,;:!?', caseSensitive: true }, actions: [{ type: 'typeText', text: '', dateFormat: 'dmy', timeFormat: 'hm24' }], conditions: [] })} className="h-7 px-2 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface">Текстовая замена</button>
                      <button type="button" onClick={() => setDraftRule({ ...draftRule, trigger: { type: 'keyDown', code: 0, modifiers: 0 }, actions: [{ type: 'runMacro', macroId: activeProfile.macros[0]?.id ?? '', playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }], conditions: [] })} className="h-7 px-2 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface">Запуск макроса</button>
                      <span className="h-7 px-2 inline-flex items-center text-[9px] text-app-muted">Или настройте пустое правило вручную ниже.</span>
                    </div>
                  </EditorSection>
                )}

'''
if anchor not in text:
    raise SystemExit('WHEN starter anchor missing')
text = text.replace(anchor, starter + anchor, 1)
write(p, text)

print('v0.4.1 UX/macro library staging applied')
