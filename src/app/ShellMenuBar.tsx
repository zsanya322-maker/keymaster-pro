import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Profile } from '../lib/types'
import type { ToastType } from './useToastQueue'

interface ShellMenuBarProps {
  profiles: Profile[]
  activeProfileId: string | null
  activeProfileRulesCount: number
  daemonConnected: boolean
  rulesDirty: boolean
  isRulesWorkspace: boolean
  sidebarOpen: boolean
  onImportProfile: () => void
  onExportProfile: () => void
  onQuit: () => void
  onAddRule: () => void
  onDeleteRule: () => void
  onToggleSidebar: () => void
  onCreateProfile: () => void
  onSelectProfile: (id: string) => void
  onDeleteProfile: (profile: { id: string; name: string }) => void
  onToggleDaemon: () => void
  onClearRules: () => void
  showToast: (message: string, type?: ToastType) => void
}

export function ShellMenuBar({
  profiles,
  activeProfileId,
  activeProfileRulesCount,
  daemonConnected,
  rulesDirty,
  isRulesWorkspace,
  sidebarOpen,
  onImportProfile,
  onExportProfile,
  onQuit,
  onAddRule,
  onDeleteRule,
  onToggleSidebar,
  onCreateProfile,
  onSelectProfile,
  onDeleteProfile,
  onToggleDaemon,
  onClearRules,
  showToast,
}: ShellMenuBarProps) {
  const { t } = useTranslation()
  const [activeMenu, setActiveMenu] = useState<string | null>(null)

  useEffect(() => {
    const closeMenus = () => setActiveMenu(null)
    window.addEventListener('click', closeMenus)
    return () => window.removeEventListener('click', closeMenus)
  }, [])

  const menuButtonClass = 'px-2 h-7 text-[11px] text-app-text hover:bg-app-surface-hover cursor-pointer'
  const menuPanelClass = 'absolute left-0 top-full mt-px min-w-44 bg-app-bg border border-app-border shadow-lg py-1 z-50'
  const menuItemClass = 'block w-full px-3 py-1.5 text-left text-[11px] text-app-text hover:bg-app-surface-hover cursor-pointer disabled:opacity-40 disabled:cursor-default'

  const closeAfter = (action: () => void) => {
    action()
    setActiveMenu(null)
  }

  const showAbout = async () => {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      showToast(`KeyMaster Pro v${await getVersion()}`, 'info')
    } catch {
      showToast('KeyMaster Pro', 'info')
    }
    setActiveMenu(null)
  }

  return (
    <div className="h-8 flex items-center px-1.5 bg-app-bg border-b border-app-border relative z-50 shrink-0">
      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}>
          {t('menu.file')}
        </button>
        {activeMenu === 'file' && (
          <div className={menuPanelClass}>
            <button className={menuItemClass} onClick={() => closeAfter(onImportProfile)}>{t('menu.import_profile')}</button>
            <button className={menuItemClass} onClick={() => closeAfter(onExportProfile)}>{t('menu.export_profile')}</button>
            <div className="my-1 border-t border-app-border" />
            <button className={menuItemClass} onClick={() => closeAfter(onQuit)}>{t('menu.exit')}</button>
          </div>
        )}
      </div>

      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}>
          {t('menu.edit')}
        </button>
        {activeMenu === 'edit' && (
          <div className={menuPanelClass}>
            <button className={menuItemClass} disabled={!isRulesWorkspace} onClick={() => closeAfter(onAddRule)}>{t('rules.add_rule')}</button>
            <button className={`${menuItemClass} text-app-danger`} disabled={!isRulesWorkspace} onClick={() => closeAfter(onDeleteRule)}>{t('rules.delete_rule')}</button>
          </div>
        )}
      </div>

      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}>
          {t('menu.view')}
        </button>
        {activeMenu === 'view' && (
          <div className={menuPanelClass}>
            <button className={menuItemClass} onClick={() => closeAfter(onToggleSidebar)}>
              {sidebarOpen ? t('menu.hide_sidebar') : t('menu.show_sidebar')}
            </button>
          </div>
        )}
      </div>

      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'profiles' ? null : 'profiles')}>
          {t('menu.profiles')}
        </button>
        {activeMenu === 'profiles' && (
          <div className={`${menuPanelClass} min-w-52`}>
            <button
              className={`${menuItemClass} text-app-primary font-semibold flex items-center gap-2`}
              onClick={() => closeAfter(onCreateProfile)}
            >
              <Plus size={12} /> {t('profiles_menu.create_profile')}
            </button>
            <div className="my-1 border-t border-app-border" />
            {profiles.map((profile) => (
              <div key={profile.id} className="flex items-center hover:bg-app-surface-hover group">
                <button
                  className={`flex-1 px-3 py-1.5 text-left text-[11px] truncate ${activeProfileId === profile.id ? 'text-app-primary font-semibold' : 'text-app-text'}`}
                  onClick={() => closeAfter(() => onSelectProfile(profile.id))}
                >
                  {profile.name}
                </button>
                {!profile.isDefault && profile.id !== activeProfileId && (
                  <button
                    className="mr-2 p-1 text-app-muted hover:text-app-danger opacity-0 group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteProfile({ id: profile.id, name: profile.name })
                    }}
                    title={t('profiles_menu.delete_title')}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'tools' ? null : 'tools')}>
          {t('menu.tools')}
        </button>
        {activeMenu === 'tools' && (
          <div className={menuPanelClass}>
            <button className={menuItemClass} onClick={() => closeAfter(onToggleDaemon)}>
              {daemonConnected ? t('footer.daemon_stop') : t('footer.daemon_start')}
            </button>
            <button
              className={`${menuItemClass} text-app-danger`}
              disabled={activeProfileRulesCount === 0 || rulesDirty}
              title={rulesDirty ? t('rules.unsaved') : undefined}
              onClick={() => closeAfter(onClearRules)}
            >
              {t('menu.clear_mappings')}
            </button>
          </div>
        )}
      </div>

      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <button className={menuButtonClass} onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}>
          {t('menu.help')}
        </button>
        {activeMenu === 'help' && (
          <div className={menuPanelClass}>
            <button className={menuItemClass} onClick={() => void showAbout()}>{t('menu.about')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
