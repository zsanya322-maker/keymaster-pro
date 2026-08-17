/**
 * TypeScript types mirror the Rust IPC/profile schema.
 */

export type Uuid = string

export interface KeyChord {
  code: number
  modifiers: number
}

export interface RuleFolder {
  id: Uuid
  name: string
  parentId?: string | null
  order: number
}

export type MatchMode = 'any' | 'all'
export interface ProfileBinding { process?: string; path?: string; title?: string; className?: string; virtualDesktopId?: string; monitorId?: string; fullscreen?: boolean; mode: MatchMode }

export interface Profile {
  id: Uuid
  name: string
  isDefault: boolean
  linkedApps: string[]
  bindings: ProfileBinding[]
  order: number
  rules: FrontendRule[]
  layers: LayerMeta[]
  folders: RuleFolder[]
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
  enabled: boolean
  folderId?: string | null
  order: number
}

export type MouseWheelDirection = 'up' | 'down' | 'left' | 'right'
export type TextExpansionMode = 'instant' | 'delimiter'
export type TextDateFormat = 'dmy' | 'ymd' | 'mdy'
export type TextTimeFormat = 'hm24' | 'hms24' | 'hm12'

export type FrontendTrigger =
  | { type: 'keyDown'; code: number; modifiers: number }
  | { type: 'keyUp'; code: number; modifiers: number }
  | { type: 'mouseDown'; code: number }
  | { type: 'mouseUp'; code: number }
  | { type: 'mouseWheel'; direction: MouseWheelDirection }
  | { type: 'mouseDoubleClick'; code: number }
  | { type: 'mouseMove'; minDistance: number; cooldownMs: number }
  | { type: 'tapHoldKeyDown'; code: number; timeoutMs: number }
  | { type: 'typedText'; sequence: string; mode: TextExpansionMode; delimiters: string; caseSensitive: boolean }

export interface MacroPlayback {
  speed: number
  repeatCount: number
  repeatWhileHeld: boolean
}

export type FrontendAction =
  | { type: 'remapKey'; code: number; modifiers: number }
  | { type: 'remapMouse'; code: number }
  | { type: 'typeText'; text: string; dateFormat: TextDateFormat; timeFormat: TextTimeFormat }
  | { type: 'runMacro'; steps: MacroStep[]; playback: MacroPlayback }
  | { type: 'toggleLayer'; layerId: string }
  | { type: 'holdLayer'; layerId: string }
  | { type: 'systemVolume'; action: 'mute' | 'up' | 'down' }
  | { type: 'mediaKey'; key: 'play_pause' | 'next' | 'prev' | 'stop' }
  | { type: 'windowAction'; action: 'snap_left' | 'snap_right' | 'snap_center' | 'minimize' | 'maximize' | 'close' }
  | { type: 'launchApp'; path: string }
  | { type: 'focusProcess'; process?: string; title?: string }
  | { type: 'sleep' }
  | { type: 'monitorOff' }

export type MacroAction =
  | { type: 'keyDown'; code: number }
  | { type: 'keyUp'; code: number }
  | { type: 'mouseDown'; code: number }
  | { type: 'mouseUp'; code: number }
  | { type: 'mouseMove'; dx: number; dy: number }
  | { type: 'mouseScroll'; delta: number }
  | { type: 'mouseHScroll'; delta: number }
  | { type: 'mouseToAbsolute'; x: number; y: number }

export interface MacroStep {
  action: MacroAction
  delayMs: number
}

export type FrontendCondition =
  | { type: 'layerActive'; layerId: string }
  | { type: 'virtualDesktop'; id: number }
  | { type: 'contextMatch'; process?: string; path?: string; title?: string; className?: string; virtualDesktopId?: string; monitorId?: string; minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number; fullscreen?: boolean; mode: MatchMode }
  | { type: 'windowMatch'; process?: string; title?: string }

export interface AppConfig {
  activeProfileId: string | null
  autostart: boolean
  minimizeToTray: boolean
  language: 'ru' | 'en'
  languageUserSelected?: boolean
  kbHookEnabled: boolean
  mouseHookEnabled: boolean
  debugMode: boolean
  theme: 'dark' | 'light'
  scale: number
  fontSize?: number
  rowPadding?: number
  restoreMouseAfterMacro?: boolean
  macroEmergencyStopVk?: number
  autoSwitchProfiles?: boolean
  manualProfileLock?: boolean
  tapHoldTimeoutMs?: number
  onboardingComplete?: boolean
}
