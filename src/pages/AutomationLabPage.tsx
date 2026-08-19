import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Package,
  Plug,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import { requestAutomationDraft } from '../lib/aiComposer'
import {
  materializeAutomationDraft,
  type AiAutomationDraft,
  type MaterializedAutomation,
  type PermissionSummary,
} from '../lib/innovation'
import {
  createAutomationPack,
  inspectAutomationPack,
  installAutomationPack,
  MAX_AUTOMATION_PACK_BYTES,
  parseAutomationPackJson,
  type AutomationPack,
} from '../lib/automationPack'
import { automationError } from '../lib/automationErrors'
import { automationErrorMessage, automationWarningMessage } from '../lib/automationI18n'
import {
  AutomationUndoStaleError,
  installAutomation,
  undoAutomationInstall,
  type AutomationAdditions,
  type AutomationInstallReceipt,
} from '../lib/automationInstall'
import { invoke } from '../lib/ipc'
import { triggerToast } from '../lib/toast'
import { useProfileStore } from '../store/profileStore'
import { useKeyMasterStore } from '../store/keyMasterStore'

type LabTab = 'ai' | 'mcp' | 'hub'

const inputClass =
  'h-8 border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary'
const panelClass = 'border border-app-border bg-app-bg'
const buttonClass =
  'h-8 px-3 inline-flex items-center justify-center gap-1.5 border border-app-border bg-app-surface text-[10px] text-app-text hover:bg-app-surface-hover disabled:opacity-40 disabled:pointer-events-none'
const primaryButtonClass =
  'h-8 px-3 inline-flex items-center justify-center gap-1.5 border border-app-primary bg-app-primary text-[10px] font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none'

function PermissionStrip({ summary }: { summary: PermissionSummary }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {summary.permissions.map((permission) => (
        <span
          key={permission}
          className="h-6 px-2 inline-flex items-center gap-1 border border-app-border bg-app-surface/50 text-[9px] text-app-muted"
        >
          <ShieldCheck size={10} /> {t(`automation.permissions.${permission}`)}
        </span>
      ))}
    </div>
  )
}

function WarningList({ summary }: { summary: PermissionSummary }) {
  const { t } = useTranslation()
  if (summary.warnings.length === 0) return null
  return (
    <div className="border border-app-warning/50 bg-app-warning/10 p-2">
      {summary.warnings.map((warning, index) => (
        <div key={`${warning.code}-${index}`} className="flex items-start gap-1.5 text-[9px] leading-4 text-app-text">
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          {automationWarningMessage(t, warning)}
        </div>
      ))}
    </div>
  )
}

export function AutomationLabPage() {
  const { t } = useTranslation()
  const { profiles, activeProfileId, loadProfiles } = useProfileStore()
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
  const { lastAutomationInstall: lastInstall, setLastAutomationInstall: setLastInstall } = useKeyMasterStore()

  const examples = t('automation.ai.examples', { returnObjects: true }) as string[]
  const packInspection = useMemo(
    () => (pendingPack ? inspectAutomationPack(pendingPack) : null),
    [pendingPack],
  )

  const showError = (error: unknown) => automationErrorMessage(t, error)

  const rememberInstall = async (receipt: AutomationInstallReceipt) => {
    setLastInstall(receipt)
    await loadProfiles()
  }

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
      triggerToast(t('automation.ai.draft_ready', {
        rules: nextMaterialized.rules.length,
        macros: nextMaterialized.macros.length,
      }), 'success')
    } catch (error) {
      triggerToast(showError(error), 'error')
    } finally {
      setAiBusy(false)
    }
  }

  const applyDraft = async () => {
    if (!activeProfile || !materialized || !draft) return
    if (draftProfileId !== activeProfile.id) {
      triggerToast(t('automation.ai.profile_changed_toast'), 'warning')
      return
    }
    try {
      const additions: AutomationAdditions = {
        rules: materialized.rules,
        macros: materialized.macros,
        layers: [],
        folders: [],
      }
      const receipt = await installAutomation(activeProfile.id, additions)
      await rememberInstall(receipt)
      triggerToast(t('automation.ai.installed', { title: draft.title }), 'success')
      setDraft(null)
      setMaterialized(null)
      setDraftProfileId(null)
    } catch (error) {
      triggerToast(showError(error), 'error')
    }
  }

  const undoLastInstall = async () => {
    if (!lastInstall) return
    try {
      await undoAutomationInstall(lastInstall)
      await loadProfiles()
      setLastInstall(null)
      triggerToast(t('automation.undo.done'), 'success')
    } catch (error) {
      if (error instanceof AutomationUndoStaleError) {
        triggerToast(t('automation.undo.stale'), 'warning')
      } else {
        triggerToast(t('automation.undo.failed', { error: showError(error) }), 'error')
      }
    }
  }

  const testMcpDaemon = async () => {
    try {
      const status = await invoke('ipc_call', { method: 'profile.runtime_status' })
      triggerToast(t('automation.mcp.daemon_ok', { status: JSON.stringify(status) }), 'success')
    } catch (error) {
      triggerToast(t('automation.mcp.daemon_error', { error: showError(error) }), 'error')
    }
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      triggerToast(t('automation.common.copied'), 'success')
    } catch (error) {
      triggerToast(t('automation.common.copy_failed', { error: showError(error) }), 'error')
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
      triggerToast(t('automation.hub.exported', { name: pack.name }), 'success')
    } catch (error) {
      triggerToast(t('automation.hub.export_error', { error: showError(error) }), 'error')
    }
  }

  const importPack = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { readTextFile, stat } = await import('@tauri-apps/plugin-fs')
      const selected = await open({ filters: [{ name: 'KeyMaster Pack', extensions: ['kmpack', 'json'] }] })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (!path) return
      const info = await stat(path)
      if (info.size > MAX_AUTOMATION_PACK_BYTES) {
        automationError('pack_too_large', { maxBytes: MAX_AUTOMATION_PACK_BYTES })
      }
      const parsed = parseAutomationPackJson(await readTextFile(path))
      setPendingPack(parsed)
      triggerToast(t('automation.hub.loaded', { name: parsed.name }), 'success')
    } catch (error) {
      triggerToast(t('automation.hub.import_error', { error: showError(error) }), 'error')
    }
  }

  const installPack = async () => {
    if (!activeProfile || !pendingPack) return
    try {
      const preview = installAutomationPack(activeProfile, pendingPack)
      const additions: AutomationAdditions = {
        rules: preview.rules.slice(activeProfile.rules.length),
        macros: preview.macros.slice(activeProfile.macros.length),
        layers: preview.layers.slice(activeProfile.layers.length),
        folders: preview.folders.slice(activeProfile.folders.length),
      }
      const receipt = await installAutomation(activeProfile.id, additions)
      await rememberInstall(receipt)
      triggerToast(t('automation.hub.installed', { name: pendingPack.name }), 'success')
      setPendingPack(null)
    } catch (error) {
      triggerToast(t('automation.hub.rejected', { error: showError(error) }), 'error')
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
  const toolRows = [
    ['keymaster_list_profiles', 'list_profiles', 'read'],
    ['keymaster_get_profile', 'get_profile', 'read'],
    ['keymaster_runtime_status', 'runtime_status', 'read'],
    ['keymaster_validate_rule', 'validate_rule', 'read'],
    ['keymaster_activate_profile', 'activate_profile', 'write'],
    ['keymaster_run_macro', 'run_macro', 'exec'],
    ['keymaster_apply_rule', 'apply_rule', 'write'],
  ] as const

  return (
    <div className="h-full min-h-0 flex flex-col bg-app-bg overflow-hidden">
      <div className="h-10 px-3 flex items-center border-b border-app-border bg-app-surface/35">
        <Sparkles size={14} className="text-app-primary" />
        <div className="ml-2">
          <div className="text-[11px] font-semibold text-app-text">{t('automation.title')}</div>
          <div className="text-[9px] text-app-muted">{t('automation.subtitle')}</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {([
            ['ai', 'automation.tabs.ai', Sparkles],
            ['mcp', 'automation.tabs.mcp', Plug],
            ['hub', 'automation.tabs.hub', Package],
          ] as const).map(([id, labelKey, Icon]) => (
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
              <Icon size={10} /> {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {!activeProfile && (
          <div className="border border-app-warning/50 bg-app-warning/10 p-3 text-[10px] text-app-text">
            {t('automation.no_profile')}
          </div>
        )}

        {lastInstall && (
          <div className="max-w-[1000px] mx-auto mb-3 border border-app-primary/40 bg-app-primary/5 p-2 flex items-center gap-2">
            <CheckCircle2 size={12} className="text-app-primary" />
            <span className="text-[9px] text-app-text">{t('automation.undo.available')}</span>
            <button type="button" className={`${buttonClass} ml-auto`} onClick={() => void undoLastInstall()}>
              <RotateCcw size={11} /> {t('automation.undo.button')}
            </button>
          </div>
        )}

        {tab === 'ai' && (
          <div className="max-w-[1000px] mx-auto space-y-3">
            <section className={panelClass}>
              <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
                <Sparkles size={11} className="text-app-primary" />
                <span className="ml-1.5 text-[10px] font-semibold">{t('automation.ai.title')}</span>
                <span className="ml-auto text-[9px] text-app-muted">{t('automation.ai.tagline')}</span>
              </div>
              <div className="p-2.5 space-y-2.5">
                <div className="grid grid-cols-[1.5fr_1fr] gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.ai.endpoint')}</span>
                    <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} className={`${inputClass} w-full`} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.ai.model')}</span>
                    <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('automation.ai.model_placeholder')} className={`${inputClass} w-full`} />
                  </label>
                </div>
                <label className="space-y-1 block">
                  <span className="text-[9px] text-app-muted">{t('automation.ai.api_key')}</span>
                  <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t('automation.ai.api_key_placeholder')} className={`${inputClass} w-full`} />
                </label>
                <label className="space-y-1 block">
                  <span className="text-[9px] text-app-muted">{t('automation.ai.prompt')}</span>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={t('automation.ai.prompt_placeholder')}
                    className="w-full min-h-28 resize-y border border-app-border bg-app-bg p-2 text-[11px] leading-5 text-app-text outline-none focus:border-app-primary"
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {examples.map((example) => (
                    <button key={example} type="button" onClick={() => setPrompt(example)} className="h-6 px-2 border border-app-border bg-app-surface/30 text-[9px] text-app-muted hover:text-app-text">
                      {example}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={!activeProfile || aiBusy || !prompt.trim() || !model.trim()} onClick={() => void generateDraft()} className={primaryButtonClass}>
                    <Sparkles size={11} /> {aiBusy ? t('automation.ai.generating') : t('automation.ai.generate')}
                  </button>
                  <span className="text-[9px] text-app-muted">{t('automation.ai.deterministic_hint')}</span>
                </div>
              </div>
            </section>

            {draft && materialized && (
              <section className={panelClass}>
                <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
                  <CheckCircle2 size={11} className="text-app-primary" />
                  <span className="ml-1.5 text-[10px] font-semibold">{draft.title}</span>
                  <span className="ml-auto text-[9px] text-app-muted">{t('automation.ai.draft_counts', { rules: materialized.rules.length, macros: materialized.macros.length })}</span>
                </div>
                <div className="p-2.5 space-y-2.5">
                  <p className="text-[10px] leading-5 text-app-text">{draft.summary}</p>
                  <PermissionStrip summary={materialized.permissions} />
                  <WarningList summary={materialized.permissions} />
                  <details className="border border-app-border bg-app-surface/15">
                    <summary className="cursor-pointer px-2 py-1.5 text-[9px] text-app-muted">{t('automation.ai.raw_json')}</summary>
                    <pre className="max-h-72 overflow-auto border-t border-app-border p-2 text-[9px] leading-4 text-app-text select-text">{JSON.stringify(draft, null, 2)}</pre>
                  </details>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={!activeProfile || draftProfileId !== activeProfile?.id} onClick={() => void applyDraft()} className={primaryButtonClass}>
                      {t('automation.ai.install')}
                    </button>
                    <button type="button" onClick={() => { setDraft(null); setMaterialized(null); setDraftProfileId(null) }} className={buttonClass}>{t('automation.ai.reject')}</button>
                    {draftProfileId !== activeProfile?.id && <span className="text-[9px] text-app-warning">{t('automation.ai.profile_changed')}</span>}
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
                <span className="ml-1.5 text-[10px] font-semibold">{t('automation.mcp.title')}</span>
                <span className="ml-auto text-[9px] text-app-muted">{t('automation.mcp.protocol')}</span>
              </div>
              <div className="p-2.5 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-app-border p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold"><ShieldCheck size={11} /> {t('automation.mcp.readonly_title')}</div>
                    <p className="mt-1 text-[9px] leading-4 text-app-muted">{t('automation.mcp.readonly_desc')}</p>
                    <code className="mt-2 block border border-app-border bg-app-surface/30 p-2 text-[9px] select-text">KeyMaster-Pro.exe --mcp</code>
                    <button type="button" onClick={() => void copyText(mcpReadOnlyConfig)} className={`${buttonClass} mt-2`}>{t('automation.mcp.copy_config')}</button>
                  </div>
                  <div className="border border-app-warning/50 p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold"><AlertTriangle size={11} /> {t('automation.mcp.write_title')}</div>
                    <p className="mt-1 text-[9px] leading-4 text-app-muted">{t('automation.mcp.write_desc')}</p>
                    <code className="mt-2 block border border-app-border bg-app-surface/30 p-2 text-[9px] select-text">KeyMaster-Pro.exe --mcp-write</code>
                    <button type="button" onClick={() => void copyText(mcpWriteConfig)} className={`${buttonClass} mt-2`}>{t('automation.mcp.copy_config')}</button>
                  </div>
                </div>

                <div className="border border-app-border">
                  <div className="h-7 px-2 flex items-center border-b border-app-border bg-app-surface/25 text-[9px] font-semibold">{t('automation.mcp.tools')}</div>
                  <div className="grid grid-cols-[180px_1fr_90px] text-[9px]">
                    {toolRows.map(([name, descriptionKey, access]) => (
                      <div key={name} className="contents">
                        <code className="px-2 py-1.5 border-b border-app-border text-app-text select-text">{name}</code>
                        <div className="px-2 py-1.5 border-b border-app-border text-app-muted">{t(`automation.mcp.tool_descriptions.${descriptionKey}`)}</div>
                        <div className={`px-2 py-1.5 border-b border-app-border font-semibold ${access === 'read' ? 'text-app-primary' : 'text-app-warning'}`}>{t(`automation.mcp.access.${access}`)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-app-warning/40 bg-app-warning/5 p-2 text-[9px] leading-4 text-app-text">
                  {t('automation.mcp.chatgpt_scope')}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void testMcpDaemon()} className={buttonClass}>{t('automation.mcp.check_daemon')}</button>
                  <span className="text-[9px] text-app-muted">{t('automation.mcp.bridge_hint')}</span>
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
                <span className="ml-1.5 text-[10px] font-semibold">{t('automation.hub.title')}</span>
                <span className="ml-auto text-[9px] text-app-muted">{t('automation.hub.scope')}</span>
              </div>
              <div className="p-2.5 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.hub.name')}</span>
                    <input value={packName} onChange={(event) => setPackName(event.target.value)} placeholder={activeProfile ? `${activeProfile.name} Pack` : t('automation.hub.name_placeholder')} className={`${inputClass} w-full`} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.hub.description')}</span>
                    <input value={packDescription} onChange={(event) => setPackDescription(event.target.value)} placeholder={t('automation.hub.description_placeholder')} className={`${inputClass} w-full`} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.hub.author')}</span>
                    <input value={packAuthor} onChange={(event) => setPackAuthor(event.target.value)} placeholder={t('automation.hub.author_placeholder')} className={`${inputClass} w-full`} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!activeProfile} onClick={() => void exportPack()} className={buttonClass}><Download size={11} /> {t('automation.hub.export')}</button>
                  <button type="button" onClick={() => void importPack()} className={buttonClass}><Upload size={11} /> {t('automation.hub.import')}</button>
                </div>
                <p className="text-[9px] leading-4 text-app-muted">{t('automation.hub.security')}</p>
              </div>
            </section>

            {pendingPack && packInspection && (
              <section className={panelClass}>
                <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/35">
                  <Package size={11} className="text-app-primary" />
                  <span className="ml-1.5 text-[10px] font-semibold">{pendingPack.name}</span>
                  <span className="ml-auto text-[9px] text-app-muted">{t('automation.hub.counts', packInspection)}</span>
                </div>
                <div className="p-2.5 space-y-2.5">
                  <p className="text-[10px] leading-5 text-app-text">{pendingPack.description}</p>
                  <PermissionStrip summary={packInspection.permissions} />
                  <WarningList summary={packInspection.permissions} />
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={!activeProfile} onClick={() => void installPack()} className={primaryButtonClass}>{t('automation.hub.install')}</button>
                    <button type="button" onClick={() => setPendingPack(null)} className={buttonClass}>{t('automation.hub.reject')}</button>
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
