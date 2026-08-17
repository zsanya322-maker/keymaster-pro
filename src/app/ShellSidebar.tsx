import { Activity, Keyboard, Layers, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Category } from '../store/keyMasterStore'

interface ShellSidebarProps {
  open: boolean
  activeCategory: Category
  onNavigate: (category: Category) => void
}

export function ShellSidebar({ open, activeCategory, onNavigate }: ShellSidebarProps) {
  const { t } = useTranslation()
  if (!open) return null

  const links = [
    { id: 'rules' as const, label: t('nav.rules'), icon: Keyboard },
    { id: 'macros' as const, label: t('nav.macros'), icon: Activity },
    { id: 'layers' as const, label: t('nav.layers'), icon: Layers },
    { id: 'settings' as const, label: t('nav.settings'), icon: Settings },
  ]

  return (
    <aside className="w-[148px] shrink-0 border-r border-app-border bg-app-surface/20 flex flex-col">
      <nav className="py-1">
        {links.map((link) => {
          const Icon = link.icon
          const active = activeCategory === link.id
          return (
            <button
              key={link.id}
              type="button"
              onClick={() => onNavigate(link.id)}
              className={`w-full h-9 px-2.5 flex items-center gap-2 text-left text-[10px] border-l-2 transition-colors ${
                active
                  ? 'border-app-primary bg-app-primary/10 text-app-primary font-semibold'
                  : 'border-transparent text-app-text hover:bg-app-surface-hover/55'
              }`}
            >
              <Icon size={14} className={active ? 'text-app-primary' : 'text-app-muted'} />
              <span>{link.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
