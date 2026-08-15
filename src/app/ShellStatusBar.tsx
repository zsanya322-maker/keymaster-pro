import { useTranslation } from 'react-i18next'

interface ShellStatusBarProps {
  daemonConnected: boolean
  rulesCount: number
  macroCount: number
  layersCount: number
  textRuleCount: number
  rulesDirty: boolean
  activeProfileName: string
}

export function ShellStatusBar({
  daemonConnected,
  rulesCount,
  macroCount,
  layersCount,
  textRuleCount,
  rulesDirty,
  activeProfileName,
}: ShellStatusBarProps) {
  const { t } = useTranslation()

  return (
    <footer className="h-7 px-2.5 flex items-center border-t border-app-border bg-app-surface/35 text-[9px] text-app-muted shrink-0">
      <div className="flex items-center gap-1.5 min-w-24">
        <span className={`h-1.5 w-1.5 rounded-full ${daemonConnected ? 'bg-app-success' : 'bg-app-danger'}`} />
        <span>{daemonConnected ? t('status.ready') : t('status.daemon_disconnected')}</span>
      </div>
      <div className="h-3.5 w-px bg-app-border mx-2.5" />
      <span>{t('nav.rules')}: <strong className="text-app-text">{rulesCount}</strong></span>
      <div className="h-3.5 w-px bg-app-border mx-2.5" />
      <span>{t('nav.macros')}: <strong className="text-app-text">{macroCount}</strong></span>
      <div className="h-3.5 w-px bg-app-border mx-2.5" />
      <span>{t('nav.layers')}: <strong className="text-app-text">{layersCount}</strong></span>
      <div className="h-3.5 w-px bg-app-border mx-2.5" />
      <span>{t('nav.text')}: <strong className="text-app-text">{textRuleCount}</strong></span>
      {rulesDirty && <span className="ml-2.5 text-app-warning">● {t('rules.unsaved')}</span>}
      <span className="ml-auto truncate max-w-[32vw]">
        {t('footer.active_profile')}: <strong className="text-app-text">{activeProfileName}</strong>
      </span>
    </footer>
  )
}
