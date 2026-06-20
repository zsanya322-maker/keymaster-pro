/**
 * App Store — глобальное состояние приложения (Zustand)
 */

import { create } from 'zustand'
import type { Profile, AppConfig, Uuid } from '../lib/types'
import { invoke } from '../lib/ipc'

interface AppState {
  // Config
  config: AppConfig
  setConfig: (config: Partial<AppConfig>) => void
  loadConfig: () => Promise<void>

  // Profiles
  profiles: Profile[]
  activeProfileId: Uuid | null
  setActiveProfile: (id: Uuid) => void

  // Daemon
  daemonConnected: boolean
  setDaemonConnected: (connected: boolean) => void

  // Diagnostics
  diagnostics: {
    keystrokes: number
    cpu: number
    ram: number
    latency: number
  }
  setDiagnostics: (diagnostics: { keystrokes: number; cpu: number; ram: number; latency: number }) => void

  // UI
  sidebarOpen: boolean
  toggleSidebar: () => void
}

/** Дефолтный конфиг */
const defaultConfig: AppConfig = {
  activeProfileId: null,
  autostart: false,
  minimizeToTray: true,
  language: 'en',
  kbHookEnabled: true,
  mouseHookEnabled: true,
  debugMode: false,
  theme: 'dark',
  scale: 0.85,
  fontSize: 12,
  rowPadding: 8,
  restoreMouseAfterMacro: true,
  onboardingComplete: false,
  tapHoldTimeoutMs: 200,
}

export const useAppStore = create<AppState>((set) => ({
  // Config
  config: defaultConfig,
  setConfig: (partial) => set((state) => {
    const newConfig = { ...state.config, ...partial };
    // Send updates to backend quietly
    invoke('ipc_call', { method: 'update_config', params: partial }).catch(() => {
      // Offline fallback
    });
    return { config: newConfig };
  }),
  loadConfig: async () => {
    try {
      const serverConfig = await invoke<AppConfig>('get_gui_config');
      if (serverConfig) {
        set({ config: serverConfig });
      }
    } catch (e) {
      // Offline fallback
    }
  },

  // Profiles
  profiles: [],
  activeProfileId: null,
  setActiveProfile: (id) => set({ activeProfileId: id }),

  // Daemon
  daemonConnected: false,
  setDaemonConnected: (connected) => set({ daemonConnected: connected }),

  // Diagnostics
  diagnostics: {
    keystrokes: 0,
    cpu: 0,
    ram: 0,
    latency: 0,
  },
  setDiagnostics: (diagnostics) => set({ diagnostics }),

  // UI
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))