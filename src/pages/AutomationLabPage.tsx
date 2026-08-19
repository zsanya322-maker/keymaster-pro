import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Package,
  Plug,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import { requestAutomationDraft } from '../lib/aiComposer'
import {
  applyMaterializedAutomation,
  materializeAutomationDraft,
  type AiAutomationDraft,
  type MaterializedAutomation,
} from '../lib/innovation'
import {
  createAutomationPack,
  inspectAutomationPack,
  installAutomationPack,
  parseAutomationPack,
  type AutomationPack,
} from '../lib/automationPack'
import { invoke } from '../lib/ipc'
import { triggerToast } from '../lib/toast'
import { useProfileStore } from '../store/profileStore'

type LabTab = 'ai' | 'mcp' | 'hub'

const inputClass =
  'h-8 border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary'
const panelClass = 'border border-app-border bg-app-bg'
const buttonClass =
  'h-8 px-3 inline-flex items-center justify-center gap-1.5 border border-app-border bg-app-surface text-[10px] text-app-text hover:bg-app-surface-hover disabled:opacity-40 disabled:pointer-events-none'
const primaryButtonClass =
  'h-8 px-3 inline-flex items-center justify-center gap-1.5 border border-app-primary bg-app-primary text-[10px] font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none'

function permissionLabel(value: string): string {
  const labels: Record<string, string> = {
    read_profile: 'Чтение профиля',
    write_rules: 'Изменение правил',
    simulate_input: 'Эмуляция ввода',
    launch_apps: 'Запуск приложений',
    system_power: 'Power-действия',
    network_tools: 'Сетевые tools',
  }
  return labels[value] ?? value
}

function PermissionStrip({ automation }: { automation: MaterializedAutomation }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {automation.permissions.permissions.map((permission) => (
        <span
          key={permission}
          className="h-6 px-2 inline-flex items-center gap-1 border border-app-border bg-app-surface/50 text-[9px] text-app-muted"
        >
          <ShieldCheck size={10} /> {permissionLabel(permission)}
        </span>
      ))}
    </div>
  )
}

export function AutomationLabPage() {
  const { profiles, activeProfileId, saveProfile } = useProfileStore()
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null
  const [tab, setTab] = useState<LabTab>('ai')

  const [endpoint, setEndpoint] = useState('http://127.0.0.1:11434/v1')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [draft, setDraft] = useState<AiAutomationDraft | null>(null)
  const [materialized, setMaterialized] = useState<MaterializedAutomation | null>(null)
  const [draftProfileId, setDraftProfileId] = useState<string | null>(null)

  const [packName, setPackName] = useState('')
  const [packDescription, setPackDescription] = useState('')
  const [packAuthor, setPackAuthor] = useState('')
  const [pendingPack, setPendingPack] = useState<AutomationPack | null>(null)

  const packInspection = useMemo(
    () => (pendingPack ? inspectAutomationPack(pendingPack) : null),
    [pendingPack],
  )

  const generateDraft = async () => {
    if (!activeProfile || aiBusy) return
    setAiBusy(true)
    try {
      const nextDraft = await requestAutomationDraft(
        { endpoint, model, apiKey },
        activeProfile,
        prompt,
      )
      const nextMaterialized = materializeAutomationDraft(nextDraft, activeProfile)
      setDraft(nextDraft)
      setMaterialized(nextMaterialized)
      setDraftProfileId(activeProfile.id)
      triggerToast(
        `AI draft готов: ${nextMaterialized.rules.length} правил, ${nextMaterialized.macros.length} макросов`,
        'success',
      )
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setAiBusy(false)
    }
  }

  const applyDraft = async () => {
    if (!activeProfile || !materialized || !draft) return
    if (draftProfileId !== activeProfile.id) {
      triggerToast('Активный профиль изменился после генерации draft. Сгенерируйте его заново.', 'warning')
      return
    }
    const saved = await saveProfile(applyMaterializedAutomation(activeProfile, materialized))
    if (saved) {
      triggerToast(`Автоматизация “${draft.title}” добавлена в профиль`, 'success')
      setDraft(null)
      setMaterialized(null)
      setDraftProfileId(null)
    }
  }

  const testMcpDaemon = async () => {
    try {
      const status = await invoke('ipc_call', { method: 'profile.runtime_status' })
      triggerToast(`Daemon доступен: ${JSON.stringify(status)}`, 'success')
    } catch (error) {
      triggerToast(`MCP bridge требует работающий daemon: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      triggerToast('Скопировано', 'success')
    } catch (error) {
      triggerToast(`Не удалось скопировать: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const exportPack = async () => {
    if (!activeProfile) return
    try {
      const pack = createAutomationPack(activeProfile, {
        name: packName || `${activeProfile.name} Pack`,
        description: packDescription,
        author: packAuthor,
      })
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      const target = await save({
        filters: [{ name: 'KeyMaster Pack', extensions: ['kmpack', 'json'] }],
        defaultPath: `${pack.name.replace(/[^a-z0-9а-яё_-]+/gi, '-').toLowerCase()}.kmpack`,
      })
      if (!target) return
      await writeTextFile(target, JSON.stringify(pack, null, 2))
      triggerToast(`Pack “${pack.name}” экспортирован`, 'success')
    } catch (error) {
      triggerToast(`Ошибка экспорта pack: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const importPack = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const selected = await open({ filters: [{ name: 'KeyMaster Pack', extensions: ['kmpack', 'json'] }] })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (!path) return
      const raw = await readTextFile(path)
      const parsed = parseAutomationPack(JSON.parse(raw))
      setPendingPack(parsed)
      triggerToast(`Pack “${parsed.name}” загружен для проверки`, 'success')
    } catch (error) {
      triggerToast(`Ошибка импорта pack: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const installPack = async () => {
    if (!activeProfile || !pendingPack) return
    try {
      const next = installAutomationPack(activeProfile, pendingPack)
      if (await saveProfile(next)) {
        triggerToast(`Pack “${pendingPack.name}” установлен`, 'success')
        setPendingPack(null)
      }
    } catch (error) {
      triggerToast(`Pack отклонён: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const mcpReadOnlyConfig = `{
  "mcpServers": {
    "keymaster": {
      "command": "C:\\\\Program Files\\\\KeyMaster-Pro\\\\KeyMaster-Pro.exe",
      "args": ["--mcp"]
    }
  }
}`
  const mcpWriteConfig = mcpReadOnlyConfig.replace('["--mcp"]', '["--mcp-write"]')

  return (
    <div className="h-full min-h-0 flex flex-col bg-app-bg overflow-hidden">
      <div className="h-10 px-3 flex items-center border-b border-app-border bg-app-surface/35">
        <Sparkles size={14} className="text-app-primary" />
        <div className="ml-2">
          <div className="text-[11px] font-semibold text-app-text">Automation Lab</div>
          <div className="text-[9px] text-app-muted">AI Composer · MCP Bridge · KeyMaster Hub</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {([
            ['ai', 'AI Composer', Sparkles],
            ['mcp', 'MCP Bridge', Plug],
            ['hub', 'Hub / Packs', Package],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`h-7 px-2.5 inline-flex items-center gap-1.5 border text-[9px] ${
                tab === id
                  ? 'border-app-primary bg-app-primary/10 text-app-primary'
                  : 'border-app-border bg-app-bg text-app-text hover:bg-app-surface'
              }`}
            >
              <Icon size={10} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {!activeProfile && (
          <div className="border border-app-warning/50 bg-app-warning/10 p-3 text-[10px] text-app-text">
            Сначала запустите daemon и выберите активный профиль.
          </div>
        )}

        {tab === 'ai' && (
          <div className="max-w-[1000px] mx-auto space-y-3">
            <section className={panelClass}>
              <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
                <Sparkles size={11} className="text-app-primary" />
                <span className="ml-1.5 text-[10px] font-semibold">AI Automation Composer</span>
                <span className="ml-auto text-[9px] text-app-muted">Build with AI. Run locally.</span>
              </div>
              <div className="p-2.5 space-y-2.5">
                <div className="grid grid-cols-[1.5fr_1fr] gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">OpenAI-compatible endpoint</span>
                    <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} className={`${inputClass} w-full`} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">Model</span>
                    <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="например qwen / gpt / glm" className={`${inputClass} w-full`} />
                  </label>
                </div>
                <label className="space-y-1 block">
                  <span className="text-[9px] text-app-muted">API key · только в памяти текущего окна, не сохраняется</span>
                  <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="для localhost можно оставить пустым" className={`${inputClass} w-full`} />
                </label>
                <label className="space-y-1 block">
                  <span className="text-[9px] text-app-muted">Что должно происходить?</span>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Например: в Chrome Ctrl + колесо вверх — предыдущая вкладка, вниз — следующая. В других приложениях не работает."
                    className="w-full min-h-28 resize-y border border-app-border bg-app-bg p-2 text-[11px] leading-5 text-app-text outline-none focus:border-app-primary"
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'В Chrome Ctrl + колесо вверх — предыдущая вкладка, вниз — следующая вкладка.',
                    'Когда печатаю ;date, подставляй текущую дату.',
                    'По Ctrl+Alt+M отключай звук только если активно окно Discord.',
                  ].map((example) => (
                    <button key={example} type="button" onClick={() => setPrompt(example)} className="h-6 px-2 border border-app-border bg-app-surface/30 text-[9px] text-app-muted hover:text-app-text">
                      {example}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={!activeProfile || aiBusy || !prompt.trim() || !model.trim()} onClick={() => void generateDraft()} className={primaryButtonClass}>
                    <Sparkles size={11} /> {aiBusy ? 'Генерирую…' : 'Создать draft'}
                  </button>
                  <span className="text-[9px] text-app-muted">AI только проектирует. Хуки и runtime остаются детерминированными.</span>
                </div>
              </div>
            </section>

            {draft && materialized && (
              <section className={panelClass}>
                <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
                  <CheckCircle2 size={11} className="text-app-primary" />
                  <span className="ml-1.5 text-[10px] font-semibold">{draft.title}</span>
                  <span className="ml-auto text-[9px] text-app-muted">{materialized.rules.length} правил · {materialized.macros.length} макросов</span>
                </div>
                <div className="p-2.5 space-y-2.5">
                  <p className="text-[10px] leading-5 text-app-text">{draft.summary}</p>
                  <PermissionStrip automation={materialized} />
                  {materialized.permissions.warnings.length > 0 && (
                    <div className="border border-app-warning/50 bg-app-warning/10 p-2">
                      {materialized.permissions.warnings.map((warning) => (
                        <div key={warning} className="flex items-start gap-1.5 text-[9px] leading-4 text-app-text"><AlertTriangle size={10} className="mt-0.5 shrink-0" /> {warning}</div>
                      ))}
                    </div>
                  )}
                  <details className="border border-app-border bg-app-surface/15">
                    <summary className="cursor-pointer px-2 py-1.5 text-[9px] text-app-muted">Посмотреть raw draft JSON</summary>
                    <pre className="max-h-72 overflow-auto border-t border-app-border p-2 text-[9px] leading-4 text-app-text select-text">{JSON.stringify(draft, null, 2)}</pre>
                  </details>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={!activeProfile || draftProfileId !== activeProfile?.id} onClick={() => void applyDraft()} className={primaryButtonClass}>
                      Установить в профиль
                    </button>
                    <button type="button" onClick={() => { setDraft(null); setMaterialized(null); setDraftProfileId(null) }} className={buttonClass}>Отклонить</button>
                    {draftProfileId !== activeProfile?.id && <span className="text-[9px] text-app-warning">Профиль изменился — draft нужно пересоздать.</span>}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'mcp' && (
          <div className="max-w-[1000px] mx-auto space-y-3">
            <section className={panelClass}>
              <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
                <Plug size={11} className="text-app-primary" />
                <span className="ml-1.5 text-[10px] font-semibold">KeyMaster MCP Bridge</span>
                <span className="ml-auto text-[9px] text-app-muted">MCP 2026-07-28 + legacy initialize fallback</span>
              </div>
              <div className="p-2.5 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-app-border p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold"><ShieldCheck size={11} /> Read-only · рекомендуется</div>
                    <p className="mt-1 text-[9px] leading-4 text-app-muted">Профили, правила и runtime можно читать/валидировать. Никаких запусков и изменений.</p>
                    <code className="mt-2 block border border-app-border bg-app-surface/30 p-2 text-[9px] select-text">KeyMaster-Pro.exe --mcp</code>
                    <button type="button" onClick={() => void copyText(mcpReadOnlyConfig)} className={`${buttonClass} mt-2`}>Скопировать конфиг</button>
                  </div>
                  <div className="border border-app-warning/50 p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold"><AlertTriangle size={11} /> Write / Execute · opt-in</div>
                    <p className="mt-1 text-[9px] leading-4 text-app-muted">Добавляет activate_profile, run_macro и apply_rule. Включается только отдельным аргументом запуска.</p>
                    <code className="mt-2 block border border-app-border bg-app-surface/30 p-2 text-[9px] select-text">KeyMaster-Pro.exe --mcp-write</code>
                    <button type="button" onClick={() => void copyText(mcpWriteConfig)} className={`${buttonClass} mt-2`}>Скопировать конфиг</button>
                  </div>
                </div>

                <div className="border border-app-border">
                  <div className="h-7 px-2 flex items-center border-b border-app-border bg-app-surface/25 text-[9px] font-semibold">Tools</div>
                  <div className="grid grid-cols-[180px_1fr_90px] text-[9px]">
                    {[
                      ['keymaster_list_profiles', 'Короткий список профилей и счётчики', 'READ'],
                      ['keymaster_get_profile', 'Правила, макросы, слои выбранного профиля', 'READ'],
                      ['keymaster_runtime_status', 'Активный профиль / auto-switch / lock', 'READ'],
                      ['keymaster_validate_rule', 'Проверка JSON правила без сохранения', 'READ'],
                      ['keymaster_activate_profile', 'Переключение профиля', 'WRITE'],
                      ['keymaster_run_macro', 'Запуск существующего макроса', 'EXEC'],
                      ['keymaster_apply_rule', 'Добавление проверенного правила', 'WRITE'],
                    ].map(([name, description, access]) => (
                      <div key={name} className="contents">
                        <code className="px-2 py-1.5 border-b border-app-border text-app-text select-text">{name}</code>
                        <div className="px-2 py-1.5 border-b border-app-border text-app-muted">{description}</div>
                        <div className={`px-2 py-1.5 border-b border-app-border font-semibold ${access === 'READ' ? 'text-app-primary' : 'text-app-warning'}`}>{access}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void testMcpDaemon()} className={buttonClass}>Проверить daemon</button>
                  <span className="text-[9px] text-app-muted">Первая версия stdio bridge использует уже существующий Named Pipe daemon.</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === 'hub' && (
          <div className="max-w-[1000px] mx-auto space-y-3">
            <section className={panelClass}>
              <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
                <Package size={11} className="text-app-primary" />
                <span className="ml-1.5 text-[10px] font-semibold">KeyMaster Hub · Pack Core</span>
                <span className="ml-auto text-[9px] text-app-muted">Локальный формат сейчас · сетевой каталог следующим слоем</span>
              </div>
              <div className="p-2.5 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">Название</span>
                    <input value={packName} onChange={(event) => setPackName(event.target.value)} placeholder={activeProfile ? `${activeProfile.name} Pack` : 'My Pack'} className={`${inputClass} w-full`} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">Автор</span>
                    <input value={packAuthor} onChange={(event) => setPackAuthor(event.target.value)} placeholder="nickname" className={`${inputClass} w-full`} />
                  </label>
                  <div className="flex items-end gap-1.5">
                    <button type="button" disabled={!activeProfile} onClick={() => void exportPack()} className={buttonClass}><Download size={11} /> Экспорт pack</button>
                    <button type="button" onClick={() => void importPack()} className={buttonClass}><Upload size={11} /> Импорт</button>
                  </div>
                </div>
                <label className="space-y-1 block">
                  <span className="text-[9px] text-app-muted">Описание</span>
                  <input value={packDescription} onChange={(event) => setPackDescription(event.target.value)} placeholder="Что делает этот набор автоматизаций" className={`${inputClass} w-full`} />
                </label>
                <div className="text-[9px] leading-4 text-app-muted">
                  Pack содержит правила, макросы, слои и папки. При установке KeyMaster пересоздаёт все внутренние UUID и перепривязывает macroId/layerId/folderId, поэтому импорт не перетирает существующие сущности профиля.
                </div>
              </div>
            </section>

            {pendingPack && packInspection && (
              <section className={panelClass}>
                <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
                  <Package size={11} />
                  <span className="ml-1.5 text-[10px] font-semibold">{pendingPack.name}</span>
                  <span className="ml-auto text-[9px] text-app-muted">by {pendingPack.author.name}</span>
                </div>
                <div className="p-2.5 space-y-2.5">
                  <p className="text-[10px] leading-5 text-app-text">{pendingPack.description || 'Без описания'}</p>
                  <div className="flex gap-2 text-[9px] text-app-muted">
                    <span>{packInspection.rules} правил</span>
                    <span>·</span>
                    <span>{packInspection.macros} макросов</span>
                    <span>·</span>
                    <span>{packInspection.layers} слоёв</span>
                    <span>·</span>
                    <span>{packInspection.folders} папок</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {packInspection.permissions.permissions.map((permission) => (
                      <span key={permission} className="h-6 px-2 inline-flex items-center gap-1 border border-app-border bg-app-surface/50 text-[9px] text-app-muted">
                        <ShieldCheck size={10} /> {permissionLabel(permission)}
                      </span>
                    ))}
                  </div>
                  {packInspection.permissions.warnings.length > 0 && (
                    <div className="border border-app-warning/50 bg-app-warning/10 p-2">
                      {packInspection.permissions.warnings.map((warning) => <div key={warning} className="text-[9px] leading-4">⚠ {warning}</div>)}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button type="button" disabled={!activeProfile} onClick={() => void installPack()} className={primaryButtonClass}>Установить в активный профиль</button>
                    <button type="button" onClick={() => setPendingPack(null)} className={buttonClass}>Отмена</button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
