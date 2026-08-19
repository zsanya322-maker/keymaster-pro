import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Shield } from 'lucide-react'

import { useAppStore } from '../store/appStore'
import { useProfileStore } from '../store/profileStore'
import { useKeyMasterStore, type Category } from '../store/keyMasterStore'
import { invoke } from '../lib/ipc'
import { emitRuleCommand, emitRuleSearch } from '../lib/uiEvents'

import { RulesPage } from '../pages/RulesPage'
import { MacroLibraryPage } from '../pages/MacroLibraryPage'
import { AutomationLabPage } from '../pages/AutomationLabPage'
import { SettingsPage } from '../pages/SettingsPage'
import { LayersPanel } from '../components/LayersPanel'
import { UpdateBanner } from '../components/UpdateBanner'
import { OnboardingWizard } from '../components/OnboardingWizard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { TextPromptDialog } from '../components/TextPromptDialog'
import { ShellMenuBar } from './ShellMenuBar'
import { ShellToolbar } from './ShellToolbar'
import { ShellSidebar } from './ShellSidebar'
import { ShellStatusBar } from './ShellStatusBar'
import { ToastViewport } from './ToastViewport'
import { useToastQueue } from './useToastQueue'
import { useDaemonConnection, type DaemonStatus } from './useDaemonConnection'

const PROFILE_SCHEMA_VERSION = 7

interface ImportedProfileMeta {
  id?: string
  name?: string
  isDefault?: boolean
  [key: string]: unknown
}

type ShellIntent =
  | { type: 'category'; category: Category }
  | { type: 'profile'; id: string }
  | { type: 'quit' }
  | { type: 'restartAdmin' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function App() {
  const { t, i18n } = useTranslation()
  const { config, daemonConnected, setDaemonConnected, loadConfig, sidebarOpen, toggleSidebar } = useAppStore()
  const { activeCategory, setActiveCategory, rulesDirty, setRulesDirty } = useKeyMasterStore()
  const { profiles, activeProfileId, activateProfile } = useProfileStore()
  const { toasts, showToast, dismissToast } = useToastQueue()

  useDaemonConnection()

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId)
  const activeProfileName = activeProfile?.name ?? 'Default'
  const theme = config.theme
  const scale = config.scale || 0.85

  const [isInitialized, setIsInitialized] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null)
  const [createProfileOpen, setCreateProfileOpen] = useState(false)
  const [clearRulesOpen, setClearRulesOpen] = useState(false)
  const [pendingShellIntent, setPendingShellIntent] = useState<ShellIntent | null>(null)
  const [lastConnectionState, setLastConnectionState] = useState<boolean | null>(null)
  const [shellSearch, setShellSearch] = useState('')
  const recoveryNotified = useRef(new Set<string>())

  useEffect(() => {
    if (lastConnectionState === null) {
      setLastConnectionState(daemonConnected)
      return
    }

    if (daemonConnected !== lastConnectionState) {
      showToast(
        daemonConnected ? t('status.daemon_connected') : t('status.daemon_disconnected'),
        daemonConnected ? 'success' : 'error',
      )
      setLastConnectionState(daemonConnected)
    }
  }, [daemonConnected, lastConnectionState, showToast, t])

  useEffect(() => {
    for (const profile of profiles) {
      if (profile.name.includes('Ошибка загрузки') && !recoveryNotified.current.has(profile.id)) {
        recoveryNotified.current.add(profile.id)
        showToast(
          `Профиль “${profile.id}” не удалось корректно прочитать. Исходный файл оставлен без изменений; защитный backup создаётся по возможности.`,
          'warning',
        )
      }
    }
  }, [profiles, showToast])

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

  const performShellIntent = async (intent: ShellIntent) => {
    if (intent.type === 'category') {
      setActiveCategory(intent.category)
      setShellSearch('')
      emitRuleSearch('')
      return
    }

    if (intent.type === 'profile') {
      await activateProfile(intent.id)
      return
    }

    try {
      await useAppStore.getState().flushConfig()

      if (intent.type === 'restartAdmin') {
        await invoke('restart_as_admin')
        return
      }

      await invoke('quit_app')
    } catch (error) {
      const message = errorMessage(error)
      showToast(
        intent.type === 'restartAdmin'
          ? t('settings.toast_admin_restart_failed', {
              error: message,
              defaultValue: `Не удалось перезапустить от Администратора: ${message}`,
            })
          : `Не удалось завершить приложение: ${message}`,
        'error',
      )
    }
  }

  const requestShellIntent = (intent: ShellIntent) => {
    if (intent.type === 'category' && intent.category === activeCategory) return
    if (intent.type === 'profile' && intent.id === activeProfileId) return

    if (rulesDirty) {
      setPendingShellIntent(intent)
      return
    }
    void performShellIntent(intent)
  }

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []

    const bindNativeRequests = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        const unlistenExit = await listen('app-exit-requested', () => {
          requestShellIntent({ type: 'quit' })
        })
        if (disposed) unlistenExit()
        else unlisteners.push(unlistenExit)

        const unlistenAdmin = await listen('app-restart-admin-requested', () => {
          requestShellIntent({ type: 'restartAdmin' })
        })
        if (disposed) unlistenAdmin()
        else unlisteners.push(unlistenAdmin)
      } catch {
        // Browser/dev mode.
      }
    }

    void bindNativeRequests()
    return () => {
      disposed = true
      for (const unlisten of unlisteners) unlisten()
    }
  }, [rulesDirty, activeCategory, activeProfileId])

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

      if (useProfileStore.getState().profiles.some((profile) => profile.id === profileData.id)) {
        profileData.id = crypto.randomUUID()
        profileData.isDefault = false
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

      const exportData = { ...activeProfile, schemaVersion: PROFILE_SCHEMA_VERSION }
      await writeTextFile(filePath, JSON.stringify(exportData, null, 2))
      showToast(`Профиль “${activeProfile.name}” экспортирован`, 'success')
    } catch (error) {
      showToast(`Ошибка экспорта: ${errorMessage(error)}`, 'error')
    }
  }

  const handleToggleDaemon = async () => {
    if (daemonConnected) {
      try {
        const result = await invoke<{ success?: boolean; message?: string }>('stop_daemon')
        if (result?.success === false) {
          showToast(result.message || t('rules.toast_daemon_stop_failed'), 'error')
          return
        }
        setDaemonConnected(false)
      } catch (error) {
        showToast(t('rules.toast_daemon_stop_failed', { error: errorMessage(error) }), 'error')
      }
      return
    }

    try {
      await invoke('spawn_daemon')
      window.setTimeout(async () => {
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

  const macroCount = activeProfile?.macros?.length ?? 0
  const textRuleCount = activeProfile?.rules.filter(
    (rule) => rule.trigger.type === 'typedText' || rule.actions.some((action) => action.type === 'typeText'),
  ).length ?? 0
  const isRulesWorkspace = activeCategory === 'rules'

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

  return (
    <div className="flex flex-col h-screen bg-app-bg text-app-text select-none font-sans overflow-hidden" style={rootStyle}>
      <ShellMenuBar
        profiles={profiles}
        activeProfileId={activeProfileId}
        activeProfileRulesCount={activeProfile?.rules.length ?? 0}
        daemonConnected={daemonConnected}
        rulesDirty={rulesDirty}
        isRulesWorkspace={isRulesWorkspace}
        sidebarOpen={sidebarOpen}
        onImportProfile={() => void handleImportProfile()}
        onExportProfile={() => void handleExportProfile()}
        onQuit={() => requestShellIntent({ type: 'quit' })}
        onAddRule={() => { if (isRulesWorkspace) emitRuleCommand('add') }}
        onDeleteRule={() => { if (isRulesWorkspace) emitRuleCommand('delete') }}
        onToggleSidebar={toggleSidebar}
        onCreateProfile={() => setCreateProfileOpen(true)}
        onSelectProfile={(id) => requestShellIntent({ type: 'profile', id })}
        onDeleteProfile={setProfileToDelete}
        onToggleDaemon={() => void handleToggleDaemon()}
        onClearRules={() => setClearRulesOpen(true)}
        showToast={showToast}
      />

      <ShellToolbar
        sidebarOpen={sidebarOpen}
        isRulesWorkspace={isRulesWorkspace}
        daemonConnected={daemonConnected}
        profiles={profiles}
        activeProfileId={activeProfileId}
        search={shellSearch}
        onToggleSidebar={toggleSidebar}
        onAddRule={() => emitRuleCommand('add')}
        onDeleteRule={() => emitRuleCommand('delete')}
        onToggleDaemon={() => void handleToggleDaemon()}
        onOpenSettings={() => requestShellIntent({ type: 'category', category: 'settings' })}
        onSelectProfile={(id) => requestShellIntent({ type: 'profile', id })}
        onSearchChange={handleShellSearch}
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <ShellSidebar
          open={sidebarOpen}
          activeCategory={activeCategory}
          onNavigate={(category) => requestShellIntent({ type: 'category', category })}
        />

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-app-bg">
          {activeCategory === 'rules' && <RulesPage mode="all" />}
          {activeCategory === 'macros' && <MacroLibraryPage />}
          {activeCategory === 'layers' && <LayersPanel />}
          {activeCategory === 'automation' && <AutomationLabPage />}
          {activeCategory === 'settings' && <SettingsPage />}
        </main>
      </div>

      <ShellStatusBar
        daemonConnected={daemonConnected}
        rulesCount={activeProfile?.rules.length ?? 0}
        macroCount={macroCount}
        layersCount={activeProfile?.layers.length ?? 0}
        textRuleCount={textRuleCount}
        rulesDirty={rulesDirty}
        activeProfileName={activeProfileName}
      />

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <UpdateBanner />
      <OnboardingWizard />

      <TextPromptDialog
        open={createProfileOpen}
        title={t('profiles_menu.create_profile')}
        label={t('profiles_menu.new_profile_prompt')}
        initialValue="Новый профиль"
        confirmLabel={t('profiles_menu.create_profile')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setCreateProfileOpen(false)}
        onConfirm={async (name) => {
          const created = await useProfileStore.getState().createProfile({ name })
          if (created) setCreateProfileOpen(false)
        }}
      />

      <ConfirmDialog
        open={pendingShellIntent !== null}
        title={t('ruleBuilder.unsaved_title')}
        message={t('ruleBuilder.unsaved_message')}
        danger
        confirmLabel={t('ruleBuilder.discard_changes')}
        onCancel={() => setPendingShellIntent(null)}
        onConfirm={async () => {
          const intent = pendingShellIntent
          if (!intent) return
          setPendingShellIntent(null)
          setRulesDirty(false)
          await performShellIntent(intent)
        }}
      />

      <ConfirmDialog
        open={clearRulesOpen}
        title={t('menu.clear_mappings')}
        message={t('rules.confirm_clear_all')}
        danger
        confirmLabel={t('menu.clear_mappings')}
        onCancel={() => setClearRulesOpen(false)}
        onConfirm={async () => {
          const state = useProfileStore.getState()
          const profile = state.profiles.find((item) => item.id === state.activeProfileId)
          if (!profile) return
          const saved = await state.saveProfile({ ...profile, rules: [] })
          if (saved) setClearRulesOpen(false)
        }}
      />

      <ConfirmDialog
        open={profileToDelete !== null}
        title={t('profiles_menu.delete_title')}
        message={t('profiles_menu.confirm_delete', { name: profileToDelete?.name ?? '' })}
        danger
        confirmLabel={t('profiles_menu.delete_btn')}
        onCancel={() => setProfileToDelete(null)}
        onConfirm={async () => {
          if (!profileToDelete) return
          const deleted = await useProfileStore.getState().deleteProfile(profileToDelete.id)
          if (deleted) setProfileToDelete(null)
        }}
      />
    </div>
  )
}

export default App