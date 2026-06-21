/**
 * TypeScript типы — зеркалируют Rust типы
 */

export type Uuid = string

export interface Profile {
  id: Uuid
  name: string
  isDefault: boolean
  linkedApps: string[]
  rules: FrontendRule[]
  layers: LayerMeta[]
}

export interface LayerMeta {
  id: Uuid
  name: string
}

export interface FrontendRule {
  id: Uuid
  name?: string
  trigger: FrontendTrigger
  actions: FrontendAction[]
  holdActions?: FrontendAction[] | null
  conditions: FrontendCondition[]
  priority: number
}

export type FrontendTrigger =
  | { type: 'keyDown'; code: number }
  | { type: 'keyUp'; code: number }
  | { type: 'mouseDown'; code: number }
  | { type: 'mouseUp'; code: number }
  | { type: 'tapHoldKeyDown'; code: number; timeoutMs: number }
  | { type: 'typedText'; sequence: string }

export type FrontendAction =
  | { type: 'remapKey'; code: number }
  | { type: 'remapMouse'; code: number }
  | { type: 'typeText'; text: string }
  | { type: 'runMacro'; steps: MacroStep[] }
  | { type: 'toggleLayer'; layerId: string }
  | { type: 'holdLayer'; layerId: string }
  | { type: 'systemVolume'; action: 'mute' | 'up' | 'down' }
  | { type: 'mediaKey'; key: 'play_pause' | 'next' | 'prev' | 'stop' }
  | { type: 'windowAction'; action: 'snap_left' | 'snap_right' | 'snap_center' | 'minimize' | 'maximize' | 'close' }
  | { type: 'launchApp'; path: string }
  | { type: 'focusProcess'; process: string }
  | { type: 'sleep' }
  | { type: 'monitorOff' }

export type MacroAction =
  | { type: 'keyDown'; code: number }
  | { type: 'keyUp'; code: number }
  | { type: 'mouseDown'; code: number }
  | { type: 'mouseUp'; code: number }
  | { type: 'mouseMove'; dx: number; dy: number }
  | { type: 'mouseScroll'; delta: number }
  | { type: 'mouseToAbsolute'; x: number; y: number }

export interface MacroStep {
  action: MacroAction
  delayMs: number
}

export type FrontendCondition =
  | { type: 'processActive'; process: string }
  | { type: 'windowFocused'; title: string }
  | { type: 'layerActive'; layerId: string }
  | { type: 'virtualDesktop'; id: number }
  | { type: 'windowMatch'; process?: string; title?: string }

export interface AppConfig {
  activeProfileId: string | null
  autostart: boolean
  minimizeToTray: boolean
  language: 'ru' | 'en'
  kbHookEnabled: boolean
  mouseHookEnabled: boolean
  debugMode: boolean
  theme: 'dark' | 'light'
  scale: number
  fontSize?: number
  rowPadding?: number
  restoreMouseAfterMacro?: boolean
  tapHoldTimeoutMs?: number
  onboardingComplete?: boolean
}