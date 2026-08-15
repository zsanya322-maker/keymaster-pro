import { useEffect } from 'react'
import { invoke } from '../lib/ipc'
import { useAppStore } from '../store/appStore'
import { useKeyMasterStore } from '../store/keyMasterStore'
import { useProfileStore } from '../store/profileStore'

export interface DaemonStatus {
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

async function ensureProfilesLoaded() {
  const state = useProfileStore.getState()
  if (state.profiles.length === 0 || !state.activeProfileId) {
    await state.loadProfiles()
  }
}

/**
 * Поддерживает GUI <-> daemon connection и диагностические счётчики.
 *
 * Важно: poll строго последовательный (setTimeout после завершения), поэтому
 * зависший/медленный IPC-запрос не создаёт параллельную очередь запросов.
 */
export function useDaemonConnection() {
  const setDaemonConnected = useAppStore((state) => state.setDaemonConnected)

  useEffect(() => {
    let disposed = false
    let pollTimer: number | null = null

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

          // Не перетираем выбранный профиль, пока справа висит несохранённый
          // черновик правила — shell сам запросит подтверждение при переходе.
          if (details.active_profile_id && !useKeyMasterStore.getState().rulesDirty) {
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
          // Следующая итерация повторит попытку.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
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
}
