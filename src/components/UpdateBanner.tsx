import { useState, useEffect } from 'react'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function UpdateBanner() {
  const { t } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [isDismissed, setIsDismissed] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    async function checkForUpdates() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (update) {
          setUpdateInfo(update)
        }
      } catch (e) {
        console.error('Failed to check for updates', e)
      }
    }
    
    // Check after 2 seconds to not block initialization
    const timer = setTimeout(checkForUpdates, 2000)
    return () => clearTimeout(timer)
  }, [])

  if (!updateInfo || isDismissed) return null

  const handleUpdate = async () => {
    setIsUpdating(true)
    try {
      await updateInfo.downloadAndInstall()
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('restart_app')
    } catch (e) {
      console.error('Failed to update', e)
      setIsUpdating(false)
    }
  }

  return (
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 bg-app-primary text-white px-4 py-2 rounded-full shadow-2xl animate-fade-in-up border border-app-primary/50">
      <div className="flex items-center gap-2">
        <div className="bg-white/20 p-1 rounded-full">
          <Check size={14} />
        </div>
        <span className="text-sm font-semibold">{t('updateBanner.available', { version: updateInfo.version })}</span>
      </div>
      
      <div className="flex items-center gap-2">
        <button 
          onClick={handleUpdate}
          disabled={isUpdating}
          className="bg-white text-app-primary hover:bg-white/90 px-3 py-1 rounded-full text-xs font-bold transition-colors disabled:opacity-50"
        >
          {isUpdating ? t('updateBanner.installing') : t('updateBanner.install_restart')}
        </button>
        <button 
          onClick={() => setIsDismissed(true)}
          className="text-white/60 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
