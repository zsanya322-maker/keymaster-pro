import { PanelLeft, PanelLeftClose, Play, Plus, Search, Settings, Square, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Profile } from '../lib/types'

interface ShellToolbarProps {
  sidebarOpen: boolean
  isRulesWorkspace: boolean
  daemonConnected: boolean
  profiles: Profile[]
  activeProfileId: string | null
  search: string
  onToggleSidebar: () => void
  onAddRule: () => void
  onDeleteRule: () => void
  onToggleDaemon: () => void
  onOpenSettings: () => void
  onSelectProfile: (id: string) => void
  onSearchChange: (value: string) => void
}

export function ShellToolbar({
  sidebarOpen,
  isRulesWorkspace,
  daemonConnected,
  profiles,
  activeProfileId,
  search,
  onToggleSidebar,
  onAddRule,
  onDeleteRule,
  onToggleDaemon,
  onOpenSettings,
  onSelectProfile,
  onSearchChange,
}: ShellToolbarProps) {
  const { t } = useTranslation()
  const toolButtonClass = 'h-7 w-7 border border-transparent bg-transparent flex items-center justify-center text-app-muted hover:text-app-text hover:bg-app-surface hover:border-app-border cursor-pointer disabled:opacity-30 disabled:cursor-default'

  return (
    <div className="h-9 px-2 flex items-center gap-0.5 border-b border-app-border bg-app-surface/25 shrink-0">
      <button
        type="button"
        className={toolButtonClass}
        onClick={onToggleSidebar}
        title={sidebarOpen ? t('menu.hide_sidebar') : t('menu.show_sidebar')}
      >
        {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
      </button>
      <div className="w-px h-5 bg-app-border mx-1" />
      <button type="button" className={toolButtonClass} disabled={!isRulesWorkspace} onClick={onAddRule} title={t('rules.add_rule')}>
        <Plus size={14} className="text-app-success" />
      </button>
      <button type="button" className={toolButtonClass} disabled={!isRulesWorkspace} onClick={onDeleteRule} title={t('rules.delete_rule')}>
        <Trash2 size={12} className="text-app-danger" />
      </button>
      <div className="w-px h-5 bg-app-border mx-1" />
      <button
        type="button"
        className={toolButtonClass}
        onClick={onToggleDaemon}
        title={daemonConnected ? t('footer.daemon_stop') : t('footer.daemon_start')}
      >
        {daemonConnected
          ? <Square size={10} fill="currentColor" />
          : <Play size={12} className="text-app-success" fill="currentColor" />}
      </button>
      <button type="button" className={toolButtonClass} onClick={onOpenSettings} title={t('nav.settings')}>
        <Settings size={13} />
      </button>

      <div className="ml-auto flex items-center gap-1.5 min-w-0">
        <select
          value={activeProfileId ?? ''}
          onChange={(event) => { if (event.target.value) onSelectProfile(event.target.value) }}
          aria-label={t('footer.active_profile')}
          className="h-7 w-44 max-w-[22vw] px-2 text-[10px] bg-app-bg border border-app-border outline-none focus:border-app-primary"
        >
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>

        <label className="relative w-52 max-w-[25vw]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            disabled={!isRulesWorkspace}
            placeholder={t('rules.search_placeholder')}
            className="h-7 w-full pl-7 pr-2 text-[10px] bg-app-bg border border-app-border outline-none focus:border-app-primary disabled:opacity-35"
          />
        </label>
      </div>
    </div>
  )
}
