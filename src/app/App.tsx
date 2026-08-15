import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app-store'
import { useProfileStore } from '../store/profileStore'
import { useKeyMasterStore } from '../store/keyMasterStore'
import { invoke } from '../lib/ipc'
import { emitRuleCommand, emitRuleSearch } from '../lib/uiEvents'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  FileText,
  Info,
  Keyboard,
  Layers,
  PanelLeft,
  PanelLeftClose,
  Play,
  Plus,
  Search,
  Settings,
  Shield,
  Square,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'

import { RulesPage } from '../pages/RulesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { LayersPanel } from '../components/LayersPanel'
import { UpdateBanner } from '../components/UpdateBanner'
import { OnboardingWizard } from '../components/OnboardingWizard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { TextPromptDialog } from '../components/TextPromptDialog'

const APP_VERSION = '0.2.1'

interface DaemonStatus {
  connected: boolean
  status: string
  details?: {
    running?: boolean
    hooks_installed?: boolean
    kb_hook_enabled?: boolean
    mouse_hook_enabled?: boolean
    active_profile_id?: string
    cpu_usage?: number
    memory_usage_mb?: number
    keystrokes_processed?: number
    last_latency_us?: number
  }
}

interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
}

interface ImportedProfileMeta {
  id?: string
  name?: string
  [key: string]: unknown
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function App() {
  const { t, i18n } = useTranslation()
  const { config, daemonConnected, setDaemonConnected, loadConfig, sidebarOpen, toggleSidebar } = useAppStore()
  const { activeCategory, setActiveCategory } = useKeyMasterStore()
  const { profiles, activeProfileId, activateProfile } = useProfileStore()

  const activeProfile = profiles.find(profile => profile.id === activeProfileId)
  const activeProfileName = activeProfile?.name ?? 'Default'
  const theme = config.theme
  const scale = config.scale || 0.85

  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null)
  const [createProfileOpen, setCreateProfileOpen] = useState(false)
  const [clearRulesOpen, setClearRulesOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [lastConnectionState, setLastConnectionState] = useState<boolean | null>(null)
  const [shellSearch, setShellSearch] = useState('')
  const recoveryNotified = useRef(new Set<string>())

  const showToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts(previous => [...previous, { id, message, type }])
    setTimeout(() => {
      setToasts(previous => previous.filter(toast => toast.id !== id))
    }, 4000)
  }

  useEffect(() => {
    if (lastConnectionState === null) {
      setLastConnectionState(daemonConnected)
      return
    }

    if (daemonConnected !== lastConnectionState) {
      showToast(
        daemonConnected
          ? t('status.daemon_connected', 'Демон подключён')
          : t('status.daemon_disconnected', 'Демон отключён'),
        daemonConnected ? 'success' : 'error',
      )
      setLastConnectionState(daemonConnected)
    }
  }, [daemonConnected, lastConnectionState, t])

  useEffect(() => {
    const handleToastEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ message: string; type: Toast['type'] }>
      if (customEvent.detail) showToast(customEvent.detail.message, customEvent.detail.type)
    }
    window.addEventListener('keymaster-toast', handleToastEvent)
    return () => window.removeEventListener('keymaster-toast', handleToastEvent)
  }, [])

  useEffect(() => {
    for (const profile of profiles) {
      if (profile.name.includes('Ошибка загрузки') && !recoveryNotified.current.has(profile.id)) {
        recoveryNotified.current.add(profile.id)
        showToast(
          `Профиль “${profile.id}” не удалось корректно прочитать. Исходный файл сохранён, создан защитный бэкап.`,
          'warning',
        )
      }
    }
  }, [profiles])

  useEffect(() => {
    if (theme === 'light') document.documentElement.classList.add('light')
    else document.documentElement.classList.remove('light')
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', scale.toString())
  }, [scale])

  useEffect(() => {
    const init = async () => {
      await loadConfig()
      const savedLang = useAppStore.getState().config.language
      if (savedLang && savedLang !== i18n.language) await i18n.changeLanguage(savedLang)
      setIsInitialized(true)
    }
    void init()
  }, [loadConfig, i18n])

  useEffect(() => {
    let disposed = false
    let pollTimer: number | null = null

    async function ensureProfilesLoaded() {
      const state = useProfileStore.getState()
      if (state.profiles.length === 0 || !state.activeProfileId) await state.loadProfiles()
    }

    async function refreshDaemonStatus(): Promise<boolean> {
      try {
        const status = await invoke<DaemonStatus>('daemon_status')
        if (disposed) return false

        const connected = Boolean(status?.connected)
        setDaemonConnected(connected)

        if (!connected) return false

        await ensureProfilesLoaded()
        if (disposed) return false

        const details = status.details
        if (details) {
          useAppStore.setState({
            diagnostics: {
              keystrokes: details.keystrokes_processed || 0,
              cpu: details.cpu_usage || 0,
              ram: details.memory_usage_mb || 0,
              latency: (details.last_latency_us || 0) / 1000,
            },
          })

          if (details.active_profile_id) {
            const currentActive = useProfileStore.getState().activeProfileId
            if (currentActive !== details.active_profile_id) {
              useProfileStore.setState({ activeProfileId: details.active_profile_id })
            }
          }
        }
        return true
      } catch {
        if (!disposed) setDaemonConnected(false)
        return false
      }
    }

    async function poll() {
      await refreshDaemonStatus()
      if (!disposed) pollTimer = window.setTimeout(() => void poll(), 3000)
    }

    async function initialConnect() {
      if (await refreshDaemonStatus()) {
        if (!disposed) pollTimer = window.setTimeout(() => void poll(), 3000)
        return
      }

      for (let attempt = 0; attempt < 5 && !disposed; attempt += 1) {
        try {
          await invoke('spawn_daemon')
        } catch {
          // Retry below.
        }
        await new Promise(resolve => setTimeout(resolve, 1500))
        if (await refreshDaemonStatus()) break
      }

      if (!disposed) pollTimer = window.setTimeout(() => void poll(), 3000)
    }

    void initialConnect()

    return () => {
      disposed = true
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }, [setDaemonConnected])

  useEffect(() => {
    const closeMenus = () => setActiveMenu(null)
    window.addEventListener('click', closeMenus)
    return () => window.removeEventListener('click', closeMenus)
  }, [])

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().close()
    } catch {
      // Browser/dev mode.
    }
  }

  const handleImportProfile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const selected = await open({ filters: [{ name: 'JSON Profile', extensions: ['json'] }] })
      const filePath = Array.isArray(selected) ? selected[0] : selected
      if (!filePath) return

      const content = await readTextFile(filePath)
      const profileData = JSON.parse(content) as ImportedProfileMeta
      if (!profileData.id || !profileData.name) {
        showToast('Некорректный профиль: отсутствует id или name', 'error')
        return
      }

      await invoke('ipc_call', { method: 'profile.import', params: profileData })
      showToast(`Профиль “${profileData.name}” импортирован`, 'success')
      await useProfileStore.getState().loadProfiles()
    } catch (error) {
      showToast(`Ошибка импорта: ${errorMessage(error)}`, 'error')
    }
  }

  const handleExportProfile = async () => {
    if (!activeProfile) {
      showToast('Нет активного профиля для экспорта', 'error')
      return
    }

    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      const filePath = await save({
        filters: [{ name: 'JSON Profile', extensions: ['json'] }],
        defaultPath: `${activeProfile.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_profile.json`,
      })
      if (!filePath) return

      await writeTextFile(filePath, JSON.stringify(activeProfile, null, 2))
      showToast(`Профиль “${activeProfile.name}” экспортирован`, 'success')
    } catch (error) {
      showToast(`Ошибка экспорта: ${errorMessage(error)}`, 'error')
    }
  }

  const handleToggleDaemon = async () => {
    if (daemonConnected) {
      try {
        await invoke('stop_daemon')
        setDaemonConnected(false)
      } catch (error) {
        showToast(t('rules.toast_daemon_stop_failed', { error: errorMessage(error) }), 'error')
      }
      return
    }

    try {
      await invoke('spawn_daemon')
      setTimeout(async () => {
        try {
          const status = await invoke<DaemonStatus>('daemon_status')
          setDaemonConnected(Boolean(status?.connected))
        } catch {
          setDaemonConnected(false)
        }
      }, 1500)
    } catch (error) {
      showToast(t('rules.toast_daemon_start_failed', { error: errorMessage(error) }), 'error')
    }
  }

  const macroCount = activeProfile?.rules.filter(rule => rule.actions.some(action => action.type === 'runMacro')).length ?? 0
  const textRuleCount = activeProfile?.rules.filter(
    rule => rule.trigger.type === 'typedText' || rule.actions.some(action => action.type === 'typeText'),
  ).length ?? 0

  const sidebarLinks = [
    { id: 'rules' as const, label: t('nav.rules', 'Правила'), icon: Keyboard },
    { id: 'layers' as const, label: t('nav.layers', 'Слои'), icon: Layers },
    { id: 'macros' as const, label: t('nav.macros', 'Макросы'), icon: Activity },
    { id: 'text' as const, label: t('nav.text', 'Текст'), icon: FileText },
    { id: 'settings' as const, label: t('nav.settings', 'Настройки'), icon: Settings },
  ]

  const isRulesWorkspace = activeCategory === 'rules' || activeCategory === 'macros' || activeCategory === 'text'

  const handleShellSearch = (value: string) => {
    setShellSearch(value)
    if (isRulesWorkspace) emitRuleSearch(value)
  }

  if (!isInitialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-app-bg text-app-text">
        <div className="flex items-center gap-3 text-sm text-app-muted">
          <Shield size={20} className="text-app-primary" />
          <span>KeyMaster Pro…</span>
        </div>
      </div>
    )
  }

  const rootStyle = {
    '--table-font-size': `${config.fontSize || 12}px`,
    '--table-row-padding': `${config.rowPadding || 8}px`,
  } as CSSProperties

  const menuButtonClass = 'px-2.5 h-7 text-[12px] text-app-text hover:bg-app-surface-hover cursor-pointer'
  const menuPanelClass = 'absolute left-0 top-full mt-px min-w-44 bg-app-bg border border-app-border shadow-lg py-1 z-50'
  const menuItemClass = 'block w-full px-3 py-1.5 text-left text-xs text-app-text hover:bg-app-surface-hover cursor-pointer'
  const toolButtonClass = 'h-8 w-8 border border-app-border bg-app-bg flex items-center justify-center text-app-muted hover:text-app-text hover:bg-app-surface cursor-pointer disabled:opacity-35 disabled:cursor-default'

  return (
    <div className="flex flex-col h-screen bg-app-bg text-app-text select-none font-sans overflow-hidden" style={rootStyle}>
      <div className="h-8 flex items-center px-2 bg-app-bg border-b border-app-border relative z-50 shrink-0">
        <div className="relative" onClick={event => event.stopPropagation()}>
          <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}>
            {t('menu.file', 'Файл')}
          </button>
          {activeMenu === 'file' && (
            <div className={menuPanelClass}>
              <button className={menuItemClass} onClick={() => { void handleImportProfile(); setActiveMenu(null) }}>{t('menu.import_profile', 'Импорт профиля')}</button>
              <button className={menuItemClass} onClick={() => { void handleExportProfile(); setActiveMenu(null) }}>{t('menu.export_profile', 'Экспорт профиля')}</button>
              <div className="my-1 border-t border-app-border" />
              <button className={menuItemClass} onClick={() => { void handleClose(); setActiveMenu(null) }}>{t('menu.exit', 'Выход')}</button>
            </div>
          )}
        </div>

        <div className="relative" onClick={event => event.stopPropagation()}>
          <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}>
            {t('menu.edit', 'Правка')}
          </button>
          {activeMenu === 'edit' && (
            <div className={menuPanelClass}>
              <button className={menuItemClass} disabled={!isRulesWorkspace} onClick={() => { if (isRulesWorkspace) emitRuleCommand('add'); setActiveMenu(null) }}>{t('rules.add_rule', 'Добавить правило')}</button>
              <button className={`${menuItemClass} text-app-danger disabled:opacity-40`} disabled={!isRulesWorkspace} onClick={() => { if (isRulesWorkspace) emitRuleCommand('delete'); setActiveMenu(null) }}>{t('rules.delete_rule', 'Удалить правило')}</button>
            </div>
          )}
        </div>

        <div className="relative" onClick={event => event.stopPropagation()}>
          <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}>
            {t('menu.view', 'Вид')}
          </button>
          {activeMenu === 'view' && (
            <div className={menuPanelClass}>
              <button className={menuItemClass} onClick={() => { toggleSidebar(); setActiveMenu(null) }}>
                {sidebarOpen ? t('menu.hide_sidebar', 'Скрыть боковую панель') : t('menu.show_sidebar', 'Показать боковую панель')}
              </button>
            </div>
          )}
        </div>

        <div className="relative" onClick={event => event.stopPropagation()}>
          <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'profiles' ? null : 'profiles')}>
            {t('menu.profiles', 'Профиль')}
          </button>
          {activeMenu === 'profiles' && (
            <div className={`${menuPanelClass} min-w-52`}>
              <button
                className={`${menuItemClass} text-app-primary font-semibold flex items-center gap-2`}
                onClick={() => { setCreateProfileOpen(true); setActiveMenu(null) }}
              >
                <Plus size={13} /> {t('profiles_menu.create_profile', 'Создать профиль')}
              </button>
              <div className="my-1 border-t border-app-border" />
              {profiles.map(profile => (
                <div key={profile.id} className="flex items-center hover:bg-app-surface-hover group">
                  <button
                    className={`flex-1 px-3 py-1.5 text-left text-xs truncate ${activeProfileId === profile.id ? 'text-app-primary font-semibold' : 'text-app-text'}`}
                    onClick={() => { void activateProfile(profile.id); setActiveMenu(null) }}
                  >
                    {profile.name}
                  </button>
                  {!profile.isDefault && (
                    <button
                      className="mr-2 p-1 text-app-muted hover:text-app-danger opacity-0 group-hover:opacity-100"
                      onClick={event => { event.stopPropagation(); setProfileToDelete({ id: profile.id, name: profile.name }) }}
                      title={t('profiles_menu.delete_title', 'Удалить профиль')}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="relative" onClick={event => event.stopPropagation()}>
          <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'tools' ? null : 'tools')}>
            {t('menu.tools', 'Инструменты')}
          </button>
          {activeMenu === 'tools' && (
            <div className={menuPanelClass}>
              <button className={menuItemClass} onClick={() => { void handleToggleDaemon(); setActiveMenu(null) }}>
                {daemonConnected ? t('footer.daemon_stop', 'Остановить демон') : t('footer.daemon_start', 'Запустить демон')}
              </button>
              <button
                className={`${menuItemClass} text-app-danger disabled:opacity-40`}
                disabled={!activeProfile || activeProfile.rules.length === 0}
                onClick={() => { setClearRulesOpen(true); setActiveMenu(null) }}
              >
                {t('menu.clear_mappings', 'Очистить правила')}
              </button>
            </div>
          )}
        </div>

        <div className="relative" onClick={event => event.stopPropagation()}>
          <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}>
            {t('menu.help', 'Справка')}
          </button>
          {activeMenu === 'help' && (
            <div className={menuPanelClass}>
              <button className={menuItemClass} onClick={() => { showToast(`KeyMaster Pro v${APP_VERSION}`, 'info'); setActiveMenu(null) }}>
                {t('menu.about', 'О программе')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="h-11 px-3 flex items-center gap-1.5 border-b border-app-border bg-app-surface/35 shrink-0">
        <button className={toolButtonClass} onClick={toggleSidebar} title={sidebarOpen ? 'Скрыть панель' : 'Показать панель'}>
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
        </button>
        <div className="w-px h-6 bg-app-border mx-0.5" />
        <button className={toolButtonClass} disabled={!isRulesWorkspace} onClick={() => emitRuleCommand('add')} title="Добавить правило">
          <Plus size={15} className="text-app-success" />
        </button>
        <button className={toolButtonClass} disabled={!isRulesWorkspace} onClick={() => emitRuleCommand('delete')} title="Удалить правило">
          <Trash2 size={13} className="text-app-danger" />
        </button>
        <div className="w-px h-6 bg-app-border mx-0.5" />
        <button className={toolButtonClass} onClick={() => void handleToggleDaemon()} title={daemonConnected ? 'Остановить демон' : 'Запустить демон'}>
          {daemonConnected ? <Square size={11} fill="currentColor" /> : <Play size={13} className="text-app-success" fill="currentColor" />}
        </button>
        <button className={toolButtonClass} onClick={() => setActiveCategory('settings')} title="Настройки">
          <Settings size={14} />
        </button>

        <div className="ml-auto flex items-center gap-2 min-w-0">
          <span className="text-[11px] text-app-muted hidden xl:inline">{t('footer.active_profile', 'Профиль')}:</span>
          <select
            value={activeProfileId ?? ''}
            onChange={event => { if (event.target.value) void activateProfile(event.target.value) }}
            className="h-7 w-48 max-w-[22vw] px-2 text-[11px] bg-app-bg border border-app-border outline-none"
          >
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>

          <label className="relative w-56 max-w-[25vw]">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
            <input
              value={shellSearch}
              onChange={event => handleShellSearch(event.target.value)}
              disabled={!isRulesWorkspace}
              placeholder={t('rules.search_placeholder', 'Поиск правил')}
              className="h-7 w-full pl-7 pr-2 text-[11px] bg-app-bg border border-app-border outline-none focus:border-app-primary disabled:opacity-40"
            />
          </label>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {sidebarOpen && (
          <aside className="w-40 shrink-0 border-r border-app-border bg-app-surface/30 flex flex-col">
            <nav className="py-1.5">
              {sidebarLinks.map(link => {
                const Icon = link.icon
                const active = activeCategory === link.id
                return (
                  <button
                    key={link.id}
                    onClick={() => { setActiveCategory(link.id); setShellSearch(''); emitRuleSearch('') }}
                    className={`w-full h-10 px-3 flex items-center gap-2.5 text-left text-[11px] border-l-2 transition-colors ${
                      active
                        ? 'border-app-primary bg-app-primary/9 text-app-primary font-semibold'
                        : 'border-transparent text-app-text hover:bg-app-surface-hover'
                    }`}
                  >
                    <Icon size={15} className={active ? 'text-app-primary' : 'text-app-muted'} />
                    <span>{link.label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>
        )}

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-app-bg">
          {activeCategory === 'rules' && <RulesPage mode="all" />}
          {activeCategory === 'macros' && <RulesPage mode="macros" />}
          {activeCategory === 'text' && <RulesPage mode="text" />}
          {activeCategory === 'layers' && <div className="h-full overflow-y-auto p-3"><LayersPanel /></div>}
          {activeCategory === 'settings' && <SettingsPage />}
        </main>
      </div>

      <footer className="h-8 px-3 flex items-center border-t border-app-border bg-app-surface/45 text-[10px] text-app-muted shrink-0">
        <div className="flex items-center gap-2 min-w-28">
          <span className={`h-2 w-2 rounded-full ${daemonConnected ? 'bg-app-success' : 'bg-app-danger'}`} />
          <span>{daemonConnected ? t('status.ready', 'Готово') : t('status.daemon_disconnected', 'Демон отключён')}</span>
        </div>
        <div className="h-4 w-px bg-app-border mx-3" />
        <span>{t('nav.rules', 'Правила')}: <strong className="text-app-text">{activeProfile?.rules.length ?? 0}</strong></span>
        <div className="h-4 w-px bg-app-border mx-3" />
        <span>{t('nav.macros', 'Макросы')}: <strong className="text-app-text">{macroCount}</strong></span>
        <div className="h-4 w-px bg-app-border mx-3" />
        <span>{t('nav.layers', 'Слои')}: <strong className="text-app-text">{activeProfile?.layers.length ?? 0}</strong></span>
        <div className="h-4 w-px bg-app-border mx-3" />
        <span>{t('nav.text', 'Текст')}: <strong className="text-app-text">{textRuleCount}</strong></span>
        <span className="ml-auto truncate max-w-[35vw]">{t('footer.active_profile', 'Профиль')}: <strong className="text-app-text">{activeProfileName}</strong></span>
      </footer>

      <div className="fixed bottom-10 right-3 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map(toast => {
          const Icon = {
            success: CheckCircle,
            error: XCircle,
            warning: AlertTriangle,
            info: Info,
          }[toast.type]
          const accent = {
            success: 'text-app-success',
            error: 'text-app-danger',
            warning: 'text-app-warning',
            info: 'text-app-primary',
          }[toast.type]

          return (
            <div key={toast.id} className="flex items-center gap-3 px-3 py-2.5 bg-app-bg border border-app-border shadow-lg pointer-events-auto">
              <Icon size={15} className={`shrink-0 ${accent}`} />
              <p className="text-xs text-app-text flex-1 select-text">{toast.message}</p>
              <button onClick={() => setToasts(previous => previous.filter(item => item.id !== toast.id))} className="text-app-muted hover:text-app-text">
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>

      <UpdateBanner />
      <OnboardingWizard />

      <TextPromptDialog
        open={createProfileOpen}
        title={t('profiles_menu.create_profile', 'Создать профиль')}
        label={t('profiles_menu.new_profile_prompt', 'Введите имя нового профиля:')}
        initialValue="Новый профиль"
        confirmLabel={t('profiles_menu.create_profile', 'Создать')}
        cancelLabel={t('common.cancel', 'Отмена')}
        onCancel={() => setCreateProfileOpen(false)}
        onConfirm={async name => {
          await useProfileStore.getState().createProfile({ name })
          setCreateProfileOpen(false)
        }}
      />

      <ConfirmDialog
        open={clearRulesOpen}
        title={t('menu.clear_mappings', 'Очистить правила')}
        message={t('rules.confirm_clear_all', 'Удалить все правила активного профиля?')}
        danger
        confirmLabel={t('menu.clear_mappings', 'Очистить')}
        onCancel={() => setClearRulesOpen(false)}
        onConfirm={async () => {
          setClearRulesOpen(false)
          const profile = useProfileStore.getState().profiles.find(item => item.id === useProfileStore.getState().activeProfileId)
          if (profile) await useProfileStore.getState().saveProfile({ ...profile, rules: [] })
        }}
      />

      <ConfirmDialog
        open={profileToDelete !== null}
        title={t('profiles_menu.delete_title', 'Удалить профиль')}
        message={t('profiles_menu.confirm_delete', 'Удалить профиль “{{name}}”?', { name: profileToDelete?.name ?? '' })}
        danger
        confirmLabel={t('profiles_menu.delete_btn', 'Удалить')}
        onCancel={() => setProfileToDelete(null)}
        onConfirm={async () => {
          if (profileToDelete) await useProfileStore.getState().deleteProfile(profileToDelete.id)
          setProfileToDelete(null)
          setActiveMenu(null)
        }}
      />
    </div>
  )
}

export default App
