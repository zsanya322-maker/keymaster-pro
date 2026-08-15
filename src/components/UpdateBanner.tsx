import { useEffect, useState } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { triggerToast } from '../lib/toast'
import { useKeyMasterStore } from '../store/keyMasterStore'
import { useAppStore } from '../stores/app-store'

type UpdateInfo = Awaited<ReturnType<typeof check>>

export function UpdateBanner() {
  const { t } = useTranslation()
  const rulesDirty = useKeyMasterStore(state => state.rulesDirty)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>(null)
  const [isDismissed, setIsDismissed] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    let disposed = false

    async function checkForUpdates() {
      try {
        const update = await check()
        if (!disposed && update) setUpdateInfo(update)
      } catch (error) {
        // Автопроверка не должна мешать запуску приложения.
        console.warn('Background update check failed', error)
      }
    }

    const timer = window.setTimeout(() => void checkForUpdates(), 2000)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [])

  if (!updateInfo || isDismissed) return null

  const handleUpdate = async () => {
    if (isUpdating) return
    if (rulesDirty) {
      triggerToast(
        t('ruleBuilder.unsaved_message', {
          defaultValue: 'Сначала сохраните или отмените изменения правила, затем устанавливайте обновление.',
        }),
        'warning',
      )
      return
    }

    setIsUpdating(true)
    try {
      await updateInfo.downloadAndInstall()
      // Последний debounce-пакет настроек должен попасть на диск до смены
      // процесса, даже если пользователь только что двигал scale/font slider.
      await useAppStore.getState().flushConfig()
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('restart_app')
    } catch (error) {
      console.error('Failed to update', error)
      triggerToast(t('settings.toast_install_failed'), 'error')
      setIsUpdating(false)
    }
  }

  return (
    <div className="fixed left-1/2 bottom-10 z-[100] -translate-x-1/2 min-w-[390px] max-w-[calc(100vw-24px)] border border-app-primary/60 bg-app-bg shadow-xl">
      <div className="h-9 px-2.5 flex items-center gap-2 bg-app-primary/10">
        <Download size={13} className="text-app-primary shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-app-text">
          {t('updateBanner.available', { version: updateInfo.version })}
        </span>
        <button
          type="button"
          onClick={() => void handleUpdate()}
          disabled={isUpdating}
          className="h-7 px-2.5 border border-app-primary bg-app-primary text-[10px] font-semibold text-white hover:bg-app-primary-hover disabled:opacity-45"
        >
          {isUpdating ? t('updateBanner.installing') : t('updateBanner.install_restart')}
        </button>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          disabled={isUpdating}
          className="h-7 w-7 inline-flex items-center justify-center text-app-muted hover:bg-app-surface hover:text-app-text disabled:opacity-40"
          title={t('common.close', { defaultValue: 'Закрыть' })}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
