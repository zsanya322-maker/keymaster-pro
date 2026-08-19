import type {
  FrontendAction,
  FrontendCondition,
  FrontendRule,
  FrontendTrigger,
  MacroDefinition,
  MacroPlayback,
  MacroStep,
  Profile,
} from './types'
import { automationError } from './automationErrors'

export type AutomationPermission =
  | 'read_profile'
  | 'write_rules'
  | 'simulate_input'
  | 'launch_apps'
  | 'system_power'
  | 'network_tools'

export type AutomationWarning =
  | { code: 'launch_app'; ruleName: string; path: string }
  | { code: 'system_power'; ruleName: string }

export interface PermissionSummary {
  permissions: AutomationPermission[]
  warnings: AutomationWarning[]
}

export interface AiMacroDraft {
  ref: string
  name: string
  steps: MacroStep[]
}

export type AiDraftAction =
  | Exclude<FrontendAction, { type: 'runMacro' }>
  | {
      type: 'runMacroRef'
      macroRef: string
      playback?: Partial<MacroPlayback>
    }

export interface AiRuleDraft {
  name?: string
  trigger: FrontendTrigger
  actions: AiDraftAction[]
  holdActions?: AiDraftAction[] | null
  conditions?: FrontendCondition[]
  priority?: number
  enabled?: boolean
}

export interface AiAutomationDraft {
  version: 1
  title: string
  summary: string
  macros: AiMacroDraft[]
  rules: AiRuleDraft[]
}

export interface MaterializedAutomation {
  macros: MacroDefinition[]
  rules: FrontendRule[]
  permissions: PermissionSummary
}

const triggerTypes = new Set([
  'keyDown',
  'keyUp',
  'mouseDown',
  'mouseUp',
  'mouseWheel',
  'mouseDoubleClick',
  'mouseMove',
  'leaderSequence',
  'keySequence',
  'keyChordSet',
  'mouseGesture',
  'tapHoldKeyDown',
  'typedText',
])

const actionTypes = new Set([
  'remapKey',
  'remapMouse',
  'typeText',
  'runMacroRef',
  'toggleLayer',
  'holdLayer',
  'systemVolume',
  'mediaKey',
  'windowAction',
  'launchApp',
  'focusProcess',
  'sleep',
  'monitorOff',
])

const macroActionTypes = new Set([
  'keyDown',
  'keyUp',
  'mouseDown',
  'mouseUp',
  'mouseMove',
  'mouseScroll',
  'mouseHScroll',
  'mouseToAbsolute',
])

const conditionTypes = new Set(['layerActive', 'virtualDesktop', 'contextMatch', 'windowMatch'])
const wheelDirections = new Set(['up', 'down', 'left', 'right'])
const gestureDirections = wheelDirections
const textModes = new Set(['instant', 'delimiter'])
const matchModes = new Set(['any', 'all'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

function validChord(value: unknown): boolean {
  return isRecord(value)
    && isIntegerInRange(value.code, 0, 255)
    && isIntegerInRange(value.modifiers ?? 0, 0, 0xffff)
}

function validTrigger(value: unknown): value is FrontendTrigger {
  if (!isRecord(value) || typeof value.type !== 'string' || !triggerTypes.has(value.type)) return false
  switch (value.type) {
    case 'keyDown':
    case 'keyUp':
      return validChord(value)
    case 'mouseDown':
    case 'mouseUp':
    case 'mouseDoubleClick':
      return isIntegerInRange(value.code, 0, 255)
    case 'mouseWheel':
      return typeof value.direction === 'string' && wheelDirections.has(value.direction)
    case 'mouseMove':
      return isIntegerInRange(value.minDistance, 0, 0xffff) && isIntegerInRange(value.cooldownMs, 0, 0xffffffff)
    case 'leaderSequence':
      return validChord(value.leader)
        && Array.isArray(value.sequence)
        && value.sequence.every((code) => isIntegerInRange(code, 0, 255))
        && isIntegerInRange(value.timeoutMs, 0, 0xffffffff)
    case 'keySequence':
      return Array.isArray(value.sequence)
        && value.sequence.every((code) => isIntegerInRange(code, 0, 255))
        && isIntegerInRange(value.timeoutMs, 0, 0xffffffff)
    case 'keyChordSet':
      return Array.isArray(value.codes)
        && value.codes.every((code) => isIntegerInRange(code, 0, 255))
        && isIntegerInRange(value.maxSkewMs, 0, 0xffffffff)
    case 'mouseGesture':
      return isIntegerInRange(value.code, 0, 255)
        && Array.isArray(value.directions)
        && value.directions.every((direction) => typeof direction === 'string' && gestureDirections.has(direction))
        && isIntegerInRange(value.minDistance, 0, 0xffff)
    case 'tapHoldKeyDown':
      return isIntegerInRange(value.code, 0, 255) && isIntegerInRange(value.timeoutMs, 0, 0xffffffff)
    case 'typedText':
      return typeof value.sequence === 'string'
        && typeof value.mode === 'string'
        && textModes.has(value.mode)
        && typeof value.delimiters === 'string'
        && typeof value.caseSensitive === 'boolean'
  }
}

function validPlayback(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  if (value.speed !== undefined && (!isFiniteNumber(value.speed) || value.speed <= 0)) return false
  if (value.repeatCount !== undefined && !isIntegerInRange(value.repeatCount, 1, 0xffffffff)) return false
  if (value.repeatWhileHeld !== undefined && typeof value.repeatWhileHeld !== 'boolean') return false
  return true
}

function validAction(value: unknown): value is AiDraftAction {
  if (!isRecord(value) || typeof value.type !== 'string' || !actionTypes.has(value.type)) return false
  switch (value.type) {
    case 'remapKey':
      return validChord(value)
    case 'remapMouse':
      return isIntegerInRange(value.code, 0, 255)
    case 'typeText':
      return typeof value.text === 'string'
        && ['dmy', 'ymd', 'mdy'].includes(String(value.dateFormat))
        && ['hm24', 'hms24', 'hm12'].includes(String(value.timeFormat))
    case 'runMacroRef':
      return typeof value.macroRef === 'string' && value.macroRef.trim().length > 0 && validPlayback(value.playback)
    case 'toggleLayer':
    case 'holdLayer':
      return typeof value.layerId === 'string' && value.layerId.trim().length > 0
    case 'systemVolume':
      return ['mute', 'up', 'down'].includes(String(value.action))
    case 'mediaKey':
      return ['play_pause', 'next', 'prev', 'stop'].includes(String(value.key))
    case 'windowAction':
      return ['snap_left', 'snap_right', 'snap_center', 'minimize', 'maximize', 'close'].includes(String(value.action))
    case 'launchApp':
      return typeof value.path === 'string' && value.path.trim().length > 0
    case 'focusProcess':
      return (value.process === undefined || typeof value.process === 'string')
        && (value.title === undefined || typeof value.title === 'string')
        && (String(value.process ?? '').trim().length > 0 || String(value.title ?? '').trim().length > 0)
    case 'sleep':
    case 'monitorOff':
      return true
  }
}

function validCondition(value: unknown): value is FrontendCondition {
  if (!isRecord(value) || typeof value.type !== 'string' || !conditionTypes.has(value.type)) return false
  switch (value.type) {
    case 'layerActive':
      return typeof value.layerId === 'string' && value.layerId.trim().length > 0
    case 'virtualDesktop':
      return isIntegerInRange(value.id, 0, 0xffffffff)
    case 'windowMatch':
      return (value.process === undefined || typeof value.process === 'string')
        && (value.title === undefined || typeof value.title === 'string')
    case 'contextMatch': {
      const optionalStrings = ['process', 'path', 'title', 'className', 'virtualDesktopId', 'monitorId']
      const optionalNumbers = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']
      return optionalStrings.every((key) => value[key] === undefined || value[key] === null || typeof value[key] === 'string')
        && optionalNumbers.every((key) => value[key] === undefined || value[key] === null || isFiniteNumber(value[key]))
        && (value.fullscreen === undefined || value.fullscreen === null || typeof value.fullscreen === 'boolean')
        && typeof value.mode === 'string'
        && matchModes.has(value.mode)
    }
  }
}

function validMacroStep(value: unknown): value is MacroStep {
  if (!isRecord(value) || !isIntegerInRange(value.delayMs, 0, 0xffffffff)) return false
  const action = value.action
  if (!isRecord(action) || typeof action.type !== 'string' || !macroActionTypes.has(action.type)) return false
  switch (action.type) {
    case 'keyDown':
    case 'keyUp':
    case 'mouseDown':
    case 'mouseUp':
      return isIntegerInRange(action.code, 0, 255)
    case 'mouseMove':
      return isIntegerInRange(action.dx, -0x80000000, 0x7fffffff) && isIntegerInRange(action.dy, -0x80000000, 0x7fffffff)
    case 'mouseScroll':
    case 'mouseHScroll':
      return isIntegerInRange(action.delta, -0x80000000, 0x7fffffff)
    case 'mouseToAbsolute':
      return isIntegerInRange(action.x, -0x80000000, 0x7fffffff) && isIntegerInRange(action.y, -0x80000000, 0x7fffffff)
  }
}

function parseRuleDraft(value: unknown, index: number): AiRuleDraft {
  if (!isRecord(value)) automationError('draft_rule_not_object', { index: index + 1 })
  if (!validTrigger(value.trigger)) automationError('draft_trigger_invalid', { index: index + 1 })
  if (!Array.isArray(value.actions) || value.actions.length === 0) automationError('draft_actions_empty', { index: index + 1 })
  if (!value.actions.every(validAction)) automationError('draft_action_invalid', { index: index + 1 })
  if (value.holdActions !== undefined && value.holdActions !== null) {
    if (!Array.isArray(value.holdActions) || !value.holdActions.every(validAction)) {
      automationError('draft_hold_actions_invalid', { index: index + 1 })
    }
  }
  if (value.conditions !== undefined) {
    if (!Array.isArray(value.conditions) || !value.conditions.every(validCondition)) {
      automationError('draft_condition_invalid', { index: index + 1 })
    }
  }
  if (value.priority !== undefined && !isFiniteNumber(value.priority)) automationError('draft_invalid_rule_shape', { index: index + 1 } as never)
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') automationError('draft_invalid_rule_shape', { index: index + 1 } as never)
  return value as unknown as AiRuleDraft
}

export function parseAutomationDraft(value: unknown): AiAutomationDraft {
  if (!isRecord(value)) automationError('draft_not_object')
  if (value.version !== 1) automationError('draft_version_unsupported', { version: String(value.version) })
  if (typeof value.title !== 'string' || !value.title.trim()) automationError('draft_title_missing')
  if (typeof value.summary !== 'string') automationError('draft_summary_missing')
  if (!Array.isArray(value.macros)) automationError('draft_macros_missing')
  if (!Array.isArray(value.rules)) automationError('draft_rules_missing')

  const macroRefs = new Set<string>()
  const macros: AiMacroDraft[] = value.macros.map((raw, index) => {
    if (!isRecord(raw)) automationError('draft_macro_not_object', { index: index + 1 })
    if (typeof raw.ref !== 'string' || !raw.ref.trim()) automationError('draft_macro_ref_missing', { index: index + 1 })
    if (macroRefs.has(raw.ref)) automationError('draft_macro_ref_duplicate', { ref: raw.ref })
    if (typeof raw.name !== 'string' || !raw.name.trim()) automationError('draft_macro_name_missing', { index: index + 1 })
    if (!Array.isArray(raw.steps) || !raw.steps.every(validMacroStep)) automationError('draft_macro_steps_invalid', { index: index + 1 })
    macroRefs.add(raw.ref)
    return raw as unknown as AiMacroDraft
  })

  const rules = value.rules.map(parseRuleDraft)
  for (const [ruleIndex, rule] of rules.entries()) {
    for (const action of [...rule.actions, ...(rule.holdActions ?? [])]) {
      if (action.type === 'runMacroRef' && !macroRefs.has(action.macroRef)) {
        automationError('draft_macro_ref_missing_target', { index: ruleIndex + 1, ref: action.macroRef })
      }
    }
  }

  return {
    version: 1,
    title: value.title.trim(),
    summary: value.summary,
    macros,
    rules,
  }
}

function normalizePlayback(playback?: Partial<MacroPlayback>): MacroPlayback {
  return {
    speed: Math.max(0.05, Number(playback?.speed ?? 1)),
    repeatCount: Math.max(1, Math.floor(Number(playback?.repeatCount ?? 1))),
    repeatWhileHeld: Boolean(playback?.repeatWhileHeld ?? false),
  }
}

function materializeAction(action: AiDraftAction, macroIds: Map<string, string>): FrontendAction {
  if (action.type !== 'runMacroRef') return structuredClone(action) as FrontendAction
  const macroId = macroIds.get(action.macroRef)
  if (!macroId) automationError('draft_materialize_macro_ref_missing', { ref: action.macroRef })
  return {
    type: 'runMacro',
    macroId,
    playback: normalizePlayback(action.playback),
  }
}

function collectPermissions(rules: FrontendRule[], macros: MacroDefinition[]): PermissionSummary {
  const permissions = new Set<AutomationPermission>(['write_rules'])
  const warnings: AutomationWarning[] = []

  if (macros.some((macro) => macro.steps.length > 0)) permissions.add('simulate_input')

  for (const rule of rules) {
    const ruleName = rule.name ?? rule.id
    for (const action of [...rule.actions, ...(rule.holdActions ?? [])]) {
      if (['remapKey', 'remapMouse', 'typeText', 'runMacro'].includes(action.type)) permissions.add('simulate_input')
      if (action.type === 'launchApp') {
        permissions.add('launch_apps')
        warnings.push({ code: 'launch_app', ruleName, path: action.path })
      }
      if (action.type === 'sleep' || action.type === 'monitorOff') {
        permissions.add('system_power')
        warnings.push({ code: 'system_power', ruleName })
      }
    }
  }

  return { permissions: [...permissions], warnings }
}

export function materializeAutomationDraft(draft: AiAutomationDraft, profile: Profile): MaterializedAutomation {
  const macroIds = new Map<string, string>()
  const macros: MacroDefinition[] = draft.macros.map((macro) => {
    const id = crypto.randomUUID()
    macroIds.set(macro.ref, id)
    return {
      id,
      name: macro.name.trim(),
      steps: structuredClone(macro.steps),
    }
  })

  const rules: FrontendRule[] = draft.rules.map((rule, index) => ({
    id: crypto.randomUUID(),
    name: rule.name?.trim() || draft.title,
    trigger: structuredClone(rule.trigger),
    actions: rule.actions.map((action) => materializeAction(action, macroIds)),
    holdActions: rule.holdActions?.map((action) => materializeAction(action, macroIds)) ?? null,
    conditions: structuredClone(rule.conditions ?? []),
    priority: Number.isFinite(rule.priority) ? Number(rule.priority) : 10,
    enabled: rule.enabled ?? true,
    folderId: null,
    order: profile.rules.length + index,
  }))

  return { macros, rules, permissions: collectPermissions(rules, macros) }
}

export function applyMaterializedAutomation(profile: Profile, automation: MaterializedAutomation): Profile {
  return {
    ...profile,
    macros: [...profile.macros, ...automation.macros],
    rules: [...profile.rules, ...automation.rules],
  }
}
