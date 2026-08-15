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
  flushConfig: () => Promise<void>

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

const DEBOUNCED_CONFIG_KEYS = new Set<keyof AppConfig>(['scale', 'fontSize', 'rowPadding'])

let pendingConfigUpdate: Partial<AppConfig> = {}
let configUpdateTimer: ReturnType<typeof setTimeout> | null = null
let configUpdateInFlight: Promise<unknown> = Promise.resolve()

function persistConfigPatch(payload: Partial<AppConfig>): Promise<unknown> {
  if (Object.keys(payload).length === 0) return configUpdateInFlight

  configUpdateInFlight = configUpdateInFlight
    .catch(() => undefined)
    .then(() => invoke<AppConfig>('update_gui_config', { patch: payload }))
    .catch((error) => {
      console.error('Failed to persist GUI config', error)
      throw error
    })

  return configUpdateInFlight
}

function takePendingConfigUpdate(): Partial<AppConfig> {
  const payload = pendingConfigUpdate
  pendingConfigUpdate = {}
  if (configUpdateTimer) {
    clearTimeout(configUpdateTimer)
    configUpdateTimer = null
  }
  return payload
}

function queueConfigUpdate(partial: Partial<AppConfig>) {
  pendingConfigUpdate = { ...pendingConfigUpdate, ...partial }

  if (configUpdateTimer) clearTimeout(configUpdateTimer)
  configUpdateTimer = setTimeout(() => {
    const payload = takePendingConfigUpdate()
    void persistConfigPatch(payload).catch(() => {
      // Ошибка уже залогирована; UI остаётся доступным.
    })
  }, 150)
}

function persistConfigUpdate(partial: Partial<AppConfig>) {
  const keys = Object.keys(partial) as Array<keyof AppConfig>
  const canDebounce = keys.length > 0 && keys.every((key) => DEBOUNCED_CONFIG_KEYS.has(key))

  if (canDebounce) {
    queueConfigUpdate(partial)
    return
  }

  // Редкие переключатели/язык/тема должны попасть на диск сразу. Если перед
  // ними уже накопился пакет от slider'ов, отправляем всё одним свежим patch.
  pendingConfigUpdate = { ...pendingConfigUpdate, ...partial }
  const payload = takePendingConfigUpdate()
  void persistConfigPatch(payload).catch(() => {
    // Ошибка уже залогирована; UI остаётся доступным.
  })
}

async function flushPendingConfig(): Promise<void> {
  const payload = takePendingConfigUpdate()
  if (Object.keys(payload).length > 0) {
    await persistConfigPatch(payload)
  } else {
    await configUpdateInFlight
  }
}

export const useAppStore = create<AppState>((set) => ({
  config: defaultConfig,
  setConfig: (partial) => {
    set((state) => ({ config: { ...state.config, ...partial } }))
    persistConfigUpdate(partial)
  },
  loadConfig: async () => {
    try {
      const serverConfig = await invoke<AppConfig>('get_gui_config')
      if (serverConfig) set({ config: serverConfig })
    } catch {
      // Offline/browser fallback.
    }
  },
  flushConfig: flushPendingConfig,

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
