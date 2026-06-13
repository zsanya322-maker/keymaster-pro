/**
 * TypeScript типы — зеркалируют Rust типы из shared/types.rs
 */

/** UUID */
export type Uuid = string

/** Профиль настроек */
export interface Profile {
  id: Uuid
  name: string
  description: string
  keyboard_remappings: Remapping[]
  mouse_remappings: Remapping[]
  macros: Macro[]
  layers: Layer[]
  is_default: boolean
  created_at: string
  updated_at: string
}

/** Связка: триггер → действие */
export interface Remapping {
  id: Uuid
  trigger: Trigger
  action: Action
  layer_id?: Uuid
  enabled: boolean
}

/** Триггер (что перехватываем) */
export interface Trigger {
  key_combo: KeyCombo
  device_type: 'any' | 'keyboard' | 'mouse'
}

/** Комбинация клавиш */
export interface KeyCombo {
  vk_code: number
  modifiers: Modifier[]
}

/** Модификатор */
export type Modifier = 'ctrl' | 'alt' | 'shift' | 'win'

/** Действие (что делаем) */
export type Action =
  | { type: 'remap'; key_combo: KeyCombo }
  | { type: 'macro'; macro_id: Uuid }
  | { type: 'layer_toggle'; layer_id: Uuid }
  | { type: 'layer_hold'; layer_id: Uuid }
  | { type: 'block' }
  | { type: 'launch_app'; path: string; args?: string }
  | { type: 'open_url'; url: string }
  | { type: 'system'; action: SystemAction }

/** Системное действие */
export type SystemAction =
  | 'volume_up'
  | 'volume_down'
  | 'mute'
  | 'play_pause'
  | 'next_track'
  | 'prev_track'

/** Макрос */
export interface Macro {
  id: Uuid
  name: string
  steps: MacroStep[]
  repeat: number
  delay_between_ms: number
}

/** Шаг макроса */
export interface MacroStep {
  type: 'key_press' | 'key_release' | 'mouse_click' | 'mouse_move' | 'scroll' | 'delay'
  vk_code?: number
  scan_code?: number
  button?: number
  x?: number
  y?: number
  delta?: number
  delay_ms?: number
}

/** Слой */
export interface Layer {
  id: Uuid
  name: string
  description: string
  trigger_key: number
  remappings: Remapping[]
  enabled: boolean
}

/** Конфигурация приложения */
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
}