/**
 * App Store — глобальное состояние приложения (Zustand)
 */

import { create } from 'zustand'
import type { Profile, AppConfig, Uuid } from '../lib/types'
import { invoke } from '../lib/ipc'

interface AppState {
  config: AppConfig
  setConfig: (config: Partial<AppConfig>) => void
  loadConfig: () => Promise<void>

  profiles: Profile[]
  activeProfileId: Uuid | null
  setActiveProfile: (id: Uuid) => void

  daemonConnected: boolean
  setDaemonConnected: (connected: boolean) => void

  diagnostics: {
    keystrokes: number
    cpu: number
    ram: number
    latency: number
  }
  setDiagnostics: (diagnostics: { keystrokes: number; cpu: number; ram: number; latency: number }) => void

  sidebarOpen: boolean
  toggleSidebar: () => void
}

const defaultConfig: AppConfig = {
  activeProfileId: null,
  autostart: false,
  minimizeToTray: true,
  language: 'ru',
  kbHookEnabled: true,
  mouseHookEnabled: true,
  debugMode: false,
  theme: 'light',
  scale: 0.85,
  fontSize: 12,
  rowPadding: 8,
  restoreMouseAfterMacro: true,
  onboardingComplete: false,
  tapHoldTimeoutMs: 200,
}

let pendingConfigUpdate: Partial<AppConfig> = {}
let configUpdateTimer: ReturnType<typeof setTimeout> | null = null
let configUpdateInFlight: Promise<unknown> = Promise.resolve()

function queueConfigUpdate(partial: Partial<AppConfig>) {
  pendingConfigUpdate = { ...pendingConfigUpdate, ...partial }

  if (configUpdateTimer) clearTimeout(configUpdateTimer)
  configUpdateTimer = setTimeout(() => {
    const payload = pendingConfigUpdate
    pendingConfigUpdate = {}
    configUpdateTimer = null

    // Сериализуем записи: следующий пакет отправляется только после предыдущего,
    // поэтому старое значение не может завершиться позже нового и затереть его.
    // Запись идёт напрямую через Tauri в config.json и не зависит от Daemon.
    configUpdateInFlight = configUpdateInFlight
      .catch(() => undefined)
      .then(() => invoke<AppConfig>('update_gui_config', { patch: payload }))
      .catch((error) => {
        console.error('Failed to persist GUI config', error)
      })
  }, 150)
}

export const useAppStore = create<AppState>((set) => ({
  config: defaultConfig,
  setConfig: (partial) => {
    set((state) => ({ config: { ...state.config, ...partial } }))
    queueConfigUpdate(partial)
  },
  loadConfig: async () => {
    try {
      const serverConfig = await invoke<AppConfig>('get_gui_config')
      if (serverConfig) set({ config: serverConfig })
    } catch {
      // Offline/browser fallback.
    }
  },

  profiles: [],
  activeProfileId: null,
  setActiveProfile: (id) => set({ activeProfileId: id }),

  daemonConnected: false,
  setDaemonConnected: (connected) => set({ daemonConnected: connected }),

  diagnostics: {
    keystrokes: 0,
    cpu: 0,
    ram: 0,
    latency: 0,
  },
  setDiagnostics: (diagnostics) => set({ diagnostics }),

  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))
