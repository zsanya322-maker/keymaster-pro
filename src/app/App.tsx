import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app-store'
import { useProfileStore } from '../store/profileStore'
import { useKeyMasterStore } from '../store/keyMasterStore'
import { invoke } from '../lib/ipc'
import {
  Keyboard,
  Cpu,
  HardDrive,
  Shield,
  Activity,
  PanelLeft,
  PanelLeftClose,
  CheckCircle,
  XCircle,
  Info,
  AlertTriangle,
  X,
  Github,
  MessageCircle,
  Settings,
  Layers,
  Plus,
  Trash2
} from 'lucide-react'

// Import pages directly
import { RulesPage } from '../pages/RulesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { LayersPanel } from '../components/LayersPanel'
import { UpdateBanner } from '../components/UpdateBanner'
import { OnboardingWizard } from '../components/OnboardingWizard'
import { ConfirmDialog } from '../components/ConfirmDialog'

const APP_VERSION = '0.2.0'

interface DaemonStatus {
  connected: boolean;
  status: string;
  details?: {
    running?: boolean;
    hooks_installed?: boolean;
    kb_hook_enabled?: boolean;
    mouse_hook_enabled?: boolean;
    active_profile_id?: string;
    cpu_usage?: number;
    memory_usage_mb?: number;
    keystrokes_processed?: number;
    last_latency_us?: number;
  };
}

function App() {
  const { t, i18n } = useTranslation()
  const { config, daemonConnected, setDaemonConnected, loadConfig, sidebarOpen, toggleSidebar } = useAppStore()
  const { activeCategory, setActiveCategory } = useKeyMasterStore()
  
  const { profiles, activeProfileId, activateProfile } = useProfileStore()
  const activeProfile = profiles.find(p => p.id === activeProfileId)
  const activeProfileName = activeProfile ? activeProfile.name : 'Default'

  const theme = config.theme
  const scale = config.scale || 0.85

  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  // Профиль, ожидающий подтверждения удаления (null = модалка закрыта).
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null)
  
  const diagnostics = useAppStore(state => state.diagnostics)

  interface Toast {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
  }

  const [toasts, setToasts] = useState<Toast[]>([])
  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }

  const [lastConnectionState, setLastConnectionState] = useState<boolean | null>(null)

  useEffect(() => {
    if (lastConnectionState === null) {
      if (daemonConnected !== undefined) {
        setLastConnectionState(daemonConnected)
      }
      return
    }
    if (daemonConnected !== lastConnectionState) {
      if (daemonConnected) {
        showToast(t('status.daemon_connected', 'Daemon connected'), 'success')
      } else {
        showToast(t('status.daemon_disconnected', 'Daemon disconnected'), 'error')
      }
      setLastConnectionState(daemonConnected)
    }
  }, [daemonConnected, lastConnectionState, t])

  // Listen to global toast dispatches
  useEffect(() => {
    const handleToastEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string; type: 'success' | 'error' | 'info' | 'warning' }>;
      if (customEvent.detail) {
        showToast(customEvent.detail.message, customEvent.detail.type);
      }
    };
    window.addEventListener('keymaster-toast', handleToastEvent);
    return () => window.removeEventListener('keymaster-toast', handleToastEvent);
  }, []);

  // Sync theme
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light')
    } else {
      document.documentElement.classList.remove('light')
    }
  }, [theme])

  // Sync scale
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', scale.toString())
  }, [scale])



  // Load config on startup
  useEffect(() => {
    const init = async () => {
      await loadConfig()
      // Применяем язык из config к i18n. Без этого сохранённый в config
      // язык игнорировался — UI всегда оставался на дефолтном 'en',
      // пока пользователь не переключит язык вручную в Settings.
      const savedLang = useAppStore.getState().config.language
      if (savedLang && savedLang !== i18n.language) {
        await i18n.changeLanguage(savedLang)
      }
      setIsInitialized(true)
    }
    init()
  }, [loadConfig, i18n])

  // Daemon connection polling + profile loading
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 5;

    // Загружаем профили как только соединились с daemon.
    // ВАЖНО: ставим guard, чтобы не дёргать profile.list на каждом poll.
    async function ensureProfilesLoaded() {
      const { profiles, activeProfileId } = useProfileStore.getState()
      if (profiles.length === 0 || !activeProfileId) {
        await useProfileStore.getState().loadProfiles()
      }
    }

    async function checkDaemon() {
      try {
        const status = await invoke<DaemonStatus>('daemon_status')
        if (status && status.connected) {
          setDaemonConnected(true)
          await ensureProfilesLoaded()
          return true
        }
      } catch (e) {
        // fallthrough to retry
      }
      return false
    }

    async function initialConnect() {
      // Сначала пробуем существующий daemon (если он уже запущен с прошлой сессии)
      if (await checkDaemon()) return

      // Иначе spawn'им с retry
      while (retryCount < maxRetries) {
        retryCount++
        try {
          await invoke('spawn_daemon')
        } catch (err) {
          // spawn упал — пробуем ещё
        }
        // Даём daemon время подняться (init_logging, hooks, IPC server)
        await new Promise(resolve => setTimeout(resolve, 1500))
        if (await checkDaemon()) return
      }
      // Все retry исчерпаны — UI покажет честную ошибку через daemonConnected=false
      setDaemonConnected(false)
    }

    initialConnect()

    // Периодический polling статуса + подгрузка профилей, если ещё не загружены
    const interval = setInterval(async () => {
      try {
        const status = await invoke<DaemonStatus>('daemon_status')
        const connected = !!(status && status.connected)
        setDaemonConnected(connected)
        if (connected) {
          // Гарантированно подгружаем профили при восстановлении соединения
          await ensureProfilesLoaded()
          if (status?.details) {
            const details = status.details as any
            useAppStore.setState({
              diagnostics: {
                keystrokes: details.keystrokes_processed || 0,
                cpu: details.cpu_usage || 0,
                ram: details.memory_usage_mb || 0,
                latency: (details.last_latency_us || 0) / 1000.0
              }
            })
            if (details.active_profile_id) {
              const currentActive = useProfileStore.getState().activeProfileId
              if (currentActive !== details.active_profile_id) {
                useProfileStore.setState({ activeProfileId: details.active_profile_id })
              }
            }
          }
        }
      } catch (e) {
        setDaemonConnected(false)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [setDaemonConnected])

  // Tauri Window Control Actions


  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().close()
    } catch (e) {
      // Ignore if Tauri API is not available
    }
  }

  // Menu Actions
  const handleImportProfile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      
      const selected = await open({
        filters: [{ name: 'JSON Profile', extensions: ['json'] }]
      })
      
      const filePath = Array.isArray(selected) ? selected[0] : selected
      
      if (filePath) {
        const content = await readTextFile(filePath)
        const profileData = JSON.parse(content)
        
        if (!profileData.id || !profileData.name) {
          showToast('Invalid profile structure: missing id or name', 'error')
          return
        }
        
        await invoke('ipc_call', { method: 'profile.import', params: profileData })
        showToast(`Profile "${profileData.name}" imported successfully!`, 'success')
        await useProfileStore.getState().loadProfiles()
      }
    } catch (e) {
      showToast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  const handleExportProfile = async () => {
    if (!activeProfileId) {
      showToast('No active profile to export', 'error')
      return
    }
    const activeProf = profiles.find(p => p.id === activeProfileId)
    if (!activeProf) {
      showToast('Active profile not found', 'error')
      return
    }

    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      
      const filePath = await save({
        filters: [{ name: 'JSON Profile', extensions: ['json'] }],
        defaultPath: `${activeProf.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_profile.json`
      })

      if (filePath) {
        await writeTextFile(filePath, JSON.stringify(activeProf, null, 2))
        showToast(`Profile "${activeProf.name}" exported successfully!`, 'success')
      }
    } catch (e) {
      showToast(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }



  const handleClearMappings = () => {
    if (confirm('Are you sure you want to clear all mappings for the active profile?')) {
      if (activeProfile) {
        useProfileStore.getState().saveProfile({ ...activeProfile, rules: [] });
      }
    }
  }

  const selectProfile = (id: string) => {
    activateProfile(id)
  }

  const handleToggleDaemon = async () => {
    if (daemonConnected) {
      try {
        await invoke('stop_daemon')
        setDaemonConnected(false)
      } catch (e: any) {
        showToast(t('rules.toast_daemon_stop_failed', { error: e }), 'error')
      }
    } else {
      try {
        await invoke('spawn_daemon')
        setTimeout(async () => {
          const status = await invoke<DaemonStatus>('daemon_status')
          setDaemonConnected(!!(status && status.connected))
        }, 1500)
      } catch (e: any) {
        showToast(t('rules.toast_daemon_start_failed', { error: e }), 'error')
      }
    }
  }

  // Global click listener to close dropdowns
  useEffect(() => {
    const handleGlobalClick = () => {
      setActiveMenu(null)
    }
    window.addEventListener('click', handleGlobalClick)
    return () => window.removeEventListener('click', handleGlobalClick)
  }, [])

  // Sidebar link configuration (Settings removed, accessible from top MenuBar)
  const sidebarLinks = [
    { id: 'rules' as const, label: t('nav.rules', 'Rules Engine'), icon: Keyboard, count: activeProfile?.rules.length || 0 },
    { id: 'layers' as const, label: t('nav.layers', 'Layers Meta'), icon: Layers, count: activeProfile?.layers.length || 0 },
    { id: 'settings' as const, label: t('nav.settings', 'Settings'), icon: Settings, count: 0 },
  ]

  // Fix activeCategory if it points to removed pages
  useEffect(() => {
    if (!['rules', 'layers', 'settings'].includes(activeCategory)) {
      setActiveCategory('rules')
    }
  }, [activeCategory, setActiveCategory])

  if (!isInitialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-app-bg text-app-text">
        <div className="flex flex-col items-center gap-4">
          <Shield size={48} className="text-app-primary animate-pulse" />
          <p className="text-sm font-bold text-app-muted">Initializing KeyMaster Pro...</p>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="flex flex-col h-screen bg-app-bg text-app-text select-none font-sans overflow-hidden"
      style={{
        ['--table-font-size' as any]: `${config.fontSize || 12}px`,
        ['--table-row-padding' as any]: `${config.rowPadding || 8}px`,
      }}
    >
      
      {/* 1. MenuBar with Dropdowns */}
      <div className="flex gap-4 px-3 py-1 bg-app-surface border-b border-app-border text-[11px] select-none relative z-50 shrink-0 items-center">
        
        {/* Sidebar Toggle button */}
        <button 
          onClick={toggleSidebar} 
          className="text-app-muted hover:text-app-text mr-1.5 transition-colors cursor-pointer flex items-center justify-center"
          title={sidebarOpen ? t('menu.hide_sidebar', 'Скрыть боковую панель') : t('menu.show_sidebar', 'Показать боковую панель')}
        >
          {sidebarOpen ? <PanelLeftClose size={13} /> : <PanelLeft size={13} />}
        </button>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')} 
            className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeMenu === 'file' ? 'bg-app-surface-hover text-app-text' : 'text-app-muted hover:text-app-text'}`}
          >
            {t('menu.file', 'File')}
          </button>
          {activeMenu === 'file' && (
            <div className="absolute left-0 mt-1 w-44 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 z-50 animate-fade-in">
              <button onClick={() => { handleImportProfile(); setActiveMenu(null); }} className="w-full text-left px-3 py-1.5 hover:bg-app-surface-hover text-app-text text-xs cursor-pointer">{t('menu.import_profile', 'Import Profile')}</button>
              <button onClick={() => { handleExportProfile(); setActiveMenu(null); }} className="w-full text-left px-3 py-1.5 hover:bg-app-surface-hover text-app-text text-xs cursor-pointer">{t('menu.export_profile', 'Export Profile')}</button>
              <hr className="border-app-border my-1" />
              <button onClick={() => { handleClose(); setActiveMenu(null); }} className="w-full text-left px-3 py-1.5 hover:bg-app-surface-hover text-app-danger text-xs cursor-pointer">{t('menu.exit', 'Exit')}</button>
            </div>
          )}
        </div>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')} 
            className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeMenu === 'edit' ? 'bg-app-surface-hover text-app-text' : 'text-app-muted hover:text-app-text'}`}
          >
            {t('menu.edit', 'Edit')}
          </button>
          {activeMenu === 'edit' && (
            <div className="absolute left-0 mt-1 w-40 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 z-50 animate-fade-in">
              <button onClick={() => { setActiveCategory('settings'); setActiveMenu(null); }} className="w-full text-left px-3 py-1.5 hover:bg-app-surface-hover text-app-text text-xs cursor-pointer">{t('menu.settings', 'Settings')}</button>
            </div>
          )}
        </div>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => setActiveMenu(activeMenu === 'profiles' ? null : 'profiles')} 
            className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeMenu === 'profiles' ? 'bg-app-surface-hover text-app-text' : 'text-app-muted hover:text-app-text'}`}
          >
            {t('menu.profiles', 'Profiles')}
          </button>
          {activeMenu === 'profiles' && (
            <div className="absolute left-0 mt-1 w-52 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 z-50 animate-fade-in">
              <button
                onClick={async () => {
                  const name = prompt(t('profiles_menu.new_profile_prompt', 'Введите имя нового профиля:'), 'New Profile')
                  if (name && name.trim()) {
                    await useProfileStore.getState().createProfile({ name: name.trim() })
                  }
                  setActiveMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-app-surface-hover text-xs text-app-primary font-semibold border-b border-app-border flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={12} />
                {t('profiles_menu.create_profile', 'Создать профиль')}
              </button>
              {profiles.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-app-muted italic">
                  {daemonConnected ? t('profiles_menu.loading', 'Загрузка профилей…') : t('profiles_menu.daemon_off', 'Daemon не подключён')}
                </div>
              ) : (
                profiles.map(p => (
                  <div key={p.id} className="flex items-center hover:bg-app-surface-hover group justify-between">
                    <button
                      onClick={() => { selectProfile(p.id); setActiveMenu(null); }}
                      className={`flex-1 text-left px-3 py-1.5 text-xs cursor-pointer truncate ${activeProfileId === p.id ? 'text-app-primary font-bold' : 'text-app-text'}`}
                    >
                      {p.name}
                    </button>
                    <div className="flex items-center pr-2 gap-1.5 shrink-0">
                      {activeProfileId === p.id && <span className="text-[10px] text-app-primary">✓</span>}
                      {!p.isDefault && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            setProfileToDelete({ id: p.id, name: p.name })
                          }}
                          className="opacity-0 group-hover:opacity-100 text-app-danger hover:text-red-500 p-0.5 rounded transition-opacity cursor-pointer flex items-center"
                          title={t('profiles_menu.delete_title', 'Удалить профиль')}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => setActiveMenu(activeMenu === 'actions' ? null : 'actions')} 
            className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeMenu === 'actions' ? 'bg-app-surface-hover text-app-text' : 'text-app-muted hover:text-app-text'}`}
          >
            {t('menu.actions', 'Actions')}
          </button>
          {activeMenu === 'actions' && (
            <div className="absolute left-0 mt-1 w-44 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 z-50 animate-fade-in">
              <button onClick={() => { handleClearMappings(); setActiveMenu(null); }} className="w-full text-left px-3 py-1.5 hover:bg-app-surface-hover text-app-danger text-xs cursor-pointer">{t('menu.clear_mappings', 'Clear Mappings')}</button>
            </div>
          )}
        </div>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')} 
            className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeMenu === 'help' ? 'bg-app-surface-hover text-app-text' : 'text-app-muted hover:text-app-text'}`}
          >
            {t('menu.help', 'Help')}
          </button>
          {activeMenu === 'help' && (
            <div className="absolute left-0 mt-1 w-40 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 z-50 animate-fade-in">
              <button onClick={() => { showToast('KeyMaster Pro v1.0.0: High-density keyboard & mouse utility.', 'info'); setActiveMenu(null); }} className="w-full text-left px-3 py-1.5 hover:bg-app-surface-hover text-app-text text-xs cursor-pointer">{t('menu.about', 'About')}</button>
            </div>
          )}
        </div>
      </div>



      {/* 4. Workspace Splitter */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Sliding Left Sidebar Drawer spacer */}
        <div className={`transition-all duration-300 shrink-0 ${sidebarOpen ? 'w-40' : 'w-0'}`} />

        {/* Hover trigger zone on the left edge of the screen */}
        {!sidebarOpen && (
          <div 
            className="absolute left-0 top-0 h-full w-3 z-30 cursor-pointer"
            onMouseEnter={() => setIsHovered(true)}
          />
        )}

        {/* Sidebar Container */}
        <aside 
          onMouseLeave={() => setIsHovered(false)}
          className={`absolute top-0 left-0 h-full w-40 bg-app-surface border-r border-app-border flex flex-col justify-between overflow-hidden shadow-2xl z-40 transition-transform duration-300 ease-in-out ${
            (sidebarOpen || isHovered) ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="p-2.5 space-y-2 overflow-y-auto w-full">
            {sidebarLinks.map((link) => {
              const isActive = activeCategory === link.id
              const IconComp = link.icon
              return (
                <button
                  key={link.id}
                  onClick={() => {
                    setActiveCategory(link.id)
                    // If not pinned, close sidebar on click
                    if (!sidebarOpen) setIsHovered(false)
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-xl transition-all duration-200 relative cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-app-primary/15 to-app-primary/5 text-app-primary border border-app-primary/30'
                      : 'text-app-muted hover:text-app-text hover:bg-app-surface-hover/30 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <IconComp size={15} className={`${isActive ? 'text-app-primary' : 'text-app-muted'} shrink-0`} />
                    <span className="text-xs font-bold truncate">
                      {link.label}
                    </span>
                  </div>

                  {/* Badge count */}
                  {link.count !== undefined && link.count > 0 && (
                    <span className="flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-app-primary text-[9px] font-bold text-white shadow-sm font-mono shrink-0">
                      {link.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Bottom Daemon Status widget */}
          <div className="p-3 border-t border-app-border/60 bg-app-bg/10 flex flex-col items-center overflow-hidden shrink-0 w-full">
            <button
              onClick={handleToggleDaemon}
              title={t('footer.daemon_toggle_hint')}
              className={`w-full py-1.5 px-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                daemonConnected
                  ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-400'
              }`}
            >
              <Shield size={13} className="shrink-0" />
              <span className="text-[11px] font-bold truncate">
                {daemonConnected ? t('footer.daemon_on') : t('footer.daemon_off')}
              </span>
            </button>
            <div className="flex items-center justify-between w-full mt-2 px-1">
              <span className="text-[9px] text-app-muted/60 font-mono tracking-tighter">
                Lat: {daemonConnected ? '0.12ms' : 'N/A'}
              </span>
              <div className="flex gap-2 text-app-muted/60">
                <a href="https://t.me/keymasterpro" target="_blank" rel="noreferrer" className="hover:text-app-text transition-colors">
                  <MessageCircle size={12} />
                </a>
                <a href="https://github.com/zsanya322-maker/keymaster-pro" target="_blank" rel="noreferrer" className="hover:text-app-text transition-colors">
                  <Github size={12} />
                </a>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Workspace Area */}
        <main className="flex-1 overflow-hidden relative p-4 bg-app-bg/25">
          <div className="h-full bg-app-surface/30 border border-app-border rounded-xl p-4 overflow-y-auto">
            {activeCategory === 'rules' && <RulesPage />}
            {activeCategory === 'layers' && <LayersPanel />}
            {activeCategory === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>

      {/* 5. Footer Status Bar */}
      <footer className="h-8 bg-app-surface border-t border-app-border px-3 flex items-center justify-between text-sm font-bold text-app-text select-none shrink-0 font-mono">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${daemonConnected ? 'bg-app-success pulse-success' : 'bg-app-danger pulse-danger'}`} />
            <span>{daemonConnected ? t('status.daemon_connected', 'Daemon connected') : t('status.daemon_disconnected', 'Daemon disconnected')}</span>
          </div>
          {daemonConnected && (
            <>
              <div className="flex items-center gap-1">
                <Activity size={12} className="text-app-muted animate-pulse" />
                <span>CPU: {diagnostics.cpu.toFixed(2)}%</span>
              </div>
              <div className="flex items-center gap-1">
                <HardDrive size={12} className="text-app-muted" />
                <span>RAM: {diagnostics.ram.toFixed(1)}MB</span>
              </div>
              <div className="flex items-center gap-1">
                <Cpu size={12} className="text-app-muted" />
                <span>Keystrokes: {diagnostics.keystrokes}</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-app-muted font-mono">
                <span>LAT: {diagnostics.latency.toFixed(3)}ms</span>
              </div>
            </>
          )}
        </div>
        
        <div className="flex items-center gap-3 text-xs">
          <span>{t('footer.active_profile', 'Active Profile')}: <strong className="text-app-primary">{activeProfileName}</strong></span>
          <span className="text-app-muted/40">|</span>
          <span>{t('footer.engine_version', 'KeyMaster Pro v{{version}}', { version: APP_VERSION })}</span>
        </div>
      </footer>

      {/* Toast Notification Container */}
      <div className="fixed bottom-12 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map(toast => {
          const Icon = {
            success: CheckCircle,
            error: XCircle,
            warning: AlertTriangle,
            info: Info
          }[toast.type]

          const borderColors = {
            success: 'border-emerald-500/30',
            error: 'border-rose-500/30',
            warning: 'border-amber-500/30',
            info: 'border-sky-500/30'
          }[toast.type]

          const textColors = {
            success: 'text-emerald-400',
            error: 'text-rose-400',
            warning: 'text-amber-400',
            info: 'text-sky-400'
          }[toast.type]

          return (
            <div
              key={toast.id}
              className={`flex items-center gap-3 px-4 py-3 bg-app-surface/90 backdrop-blur-md border ${borderColors} rounded-xl shadow-2xl pointer-events-auto transition-all duration-300 fade-in-up`}
            >
              <Icon size={16} className={`shrink-0 ${textColors}`} />
              <p className="text-xs font-semibold text-app-text flex-1 select-text">
                {toast.message}
              </p>
              <button
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                className="text-app-muted hover:text-app-text transition-colors cursor-pointer shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>

      <UpdateBanner />
      <OnboardingWizard />

      <ConfirmDialog
        open={profileToDelete !== null}
        title={t('profiles_menu.delete_title', 'Удалить профиль')}
        message={t('profiles_menu.confirm_delete', 'Удалить профиль "{{name}}"?', { name: profileToDelete?.name ?? '' })}
        danger
        confirmLabel={t('profiles_menu.delete_btn', 'Удалить')}
        onCancel={() => setProfileToDelete(null)}
        onConfirm={async () => {
          if (profileToDelete) {
            await useProfileStore.getState().deleteProfile(profileToDelete.id)
            await useProfileStore.getState().loadProfiles()
          }
          setProfileToDelete(null)
          setActiveMenu(null)
        }}
      />

    </div>
  )
}

export default App