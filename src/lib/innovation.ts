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

export type AutomationPermission =
  | 'read_profile'
  | 'write_rules'
  | 'simulate_input'
  | 'launch_apps'
  | 'system_power'
  | 'network_tools'

export interface PermissionSummary {
  permissions: AutomationPermission[]
  warnings: string[]
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

const conditionTypes = new Set(['layerActive', 'virtualDesktop', 'contextMatch', 'windowMatch'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKnownType(value: unknown, allowed: Set<string>): boolean {
  return isRecord(value) && typeof value.type === 'string' && allowed.has(value.type)
}

function parseRuleDraft(value: unknown, index: number): AiRuleDraft {
  if (!isRecord(value)) throw new Error(`Правило #${index + 1}: ожидался объект`)
  if (!hasKnownType(value.trigger, triggerTypes)) {
    throw new Error(`Правило #${index + 1}: неизвестный или отсутствующий trigger.type`)
  }
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error(`Правило #${index + 1}: actions должен содержать хотя бы одно действие`)
  }
  if (!value.actions.every((action) => hasKnownType(action, actionTypes))) {
    throw new Error(`Правило #${index + 1}: найден неизвестный action.type`)
  }
  if (value.holdActions !== undefined && value.holdActions !== null) {
    if (!Array.isArray(value.holdActions) || !value.holdActions.every((action) => hasKnownType(action, actionTypes))) {
      throw new Error(`Правило #${index + 1}: некорректный holdActions`)
    }
  }
  if (value.conditions !== undefined) {
    if (!Array.isArray(value.conditions) || !value.conditions.every((condition) => hasKnownType(condition, conditionTypes))) {
      throw new Error(`Правило #${index + 1}: найден неизвестный condition.type`)
    }
  }

  return value as unknown as AiRuleDraft
}

export function parseAutomationDraft(value: unknown): AiAutomationDraft {
  if (!isRecord(value)) throw new Error('AI вернул не JSON-объект')
  if (value.version !== 1) throw new Error('Поддерживается только draft format version=1')
  if (typeof value.title !== 'string' || !value.title.trim()) throw new Error('В draft отсутствует title')
  if (typeof value.summary !== 'string') throw new Error('В draft отсутствует summary')
  if (!Array.isArray(value.macros)) throw new Error('В draft отсутствует массив macros')
  if (!Array.isArray(value.rules)) throw new Error('В draft отсутствует массив rules')

  const macroRefs = new Set<string>()
  const macros: AiMacroDraft[] = value.macros.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Макрос #${index + 1}: ожидался объект`)
    if (typeof raw.ref !== 'string' || !raw.ref.trim()) throw new Error(`Макрос #${index + 1}: отсутствует ref`)
    if (macroRefs.has(raw.ref)) throw new Error(`Повторяющийся macro ref: ${raw.ref}`)
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error(`Макрос #${index + 1}: отсутствует name`)
    if (!Array.isArray(raw.steps)) throw new Error(`Макрос #${index + 1}: steps должен быть массивом`)
    macroRefs.add(raw.ref)
    return raw as unknown as AiMacroDraft
  })

  const rules = value.rules.map(parseRuleDraft)
  for (const [ruleIndex, rule] of rules.entries()) {
    for (const action of [...rule.actions, ...(rule.holdActions ?? [])]) {
      if (action.type === 'runMacroRef' && !macroRefs.has(action.macroRef)) {
        throw new Error(`Правило #${ruleIndex + 1}: macroRef “${action.macroRef}” не существует`)
      }
    }
  }

  return {
    version: 1,
    title: value.title,
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
  if (!macroId) throw new Error(`Не найден macroRef: ${action.macroRef}`)
  return {
    type: 'runMacro',
    macroId,
    playback: normalizePlayback(action.playback),
  }
}

function collectPermissions(rules: FrontendRule[], macros: MacroDefinition[]): PermissionSummary {
  const permissions = new Set<AutomationPermission>(['write_rules'])
  const warnings: string[] = []

  if (macros.some((macro) => macro.steps.length > 0)) permissions.add('simulate_input')

  for (const rule of rules) {
    for (const action of [...rule.actions, ...(rule.holdActions ?? [])]) {
      if (['remapKey', 'remapMouse', 'typeText', 'runMacro'].includes(action.type)) permissions.add('simulate_input')
      if (action.type === 'launchApp') {
        permissions.add('launch_apps')
        warnings.push(`Правило “${rule.name ?? rule.id}” запускает приложение: ${action.path}`)
      }
      if (action.type === 'sleep' || action.type === 'monitorOff') {
        permissions.add('system_power')
        warnings.push(`Правило “${rule.name ?? rule.id}” выполняет системное power-действие`)
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
