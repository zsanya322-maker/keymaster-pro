import type {
  FrontendAction,
  FrontendCondition,
  FrontendRule,
  LayerMeta,
  MacroDefinition,
  Profile,
  RuleFolder,
} from './types'
import type { AutomationPermission, AutomationWarning, PermissionSummary } from './innovation'
import { automationError } from './automationErrors'

export const MAX_AUTOMATION_PACK_BYTES = 2 * 1024 * 1024
export const MAX_PACK_RULES = 2_000
export const MAX_PACK_MACROS = 1_000
export const MAX_PACK_LAYERS = 256
export const MAX_PACK_FOLDERS = 1_000

export interface AutomationPackAuthor {
  name: string
  url?: string
}

export interface AutomationPack {
  format: 'keymaster-pack'
  version: 1
  id: string
  name: string
  description: string
  author: AutomationPackAuthor
  createdAt: string
  payload: {
    rules: FrontendRule[]
    macros: MacroDefinition[]
    layers: LayerMeta[]
    folders: RuleFolder[]
  }
}

export interface PackInspection extends Record<string, unknown> {
  rules: number
  macros: number
  layers: number
  folders: number
  permissions: PermissionSummary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function requireUniqueIds(items: unknown[], kind: 'macro' | 'layer' | 'folder' | 'rule'): Set<string> {
  const ids = new Set<string>()
  const duplicateCode = {
    macro: 'pack_duplicate_macro_id',
    layer: 'pack_duplicate_layer_id',
    folder: 'pack_duplicate_folder_id',
    rule: 'pack_duplicate_rule_id',
  } as const
  const shapeCode = {
    macro: 'pack_invalid_macro_shape',
    layer: 'pack_invalid_layer_shape',
    folder: 'pack_invalid_folder_shape',
    rule: 'pack_invalid_rule_shape',
  } as const

  items.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) {
      automationError(shapeCode[kind], { index: index + 1 })
    }
    if (ids.has(item.id)) automationError(duplicateCode[kind], { id: item.id })
    ids.add(item.id)
  })
  return ids
}

function validateFolderGraph(folders: RuleFolder[], folderIds: Set<string>) {
  const parentById = new Map<string, string | null>()
  for (const folder of folders) {
    if (typeof folder.name !== 'string' || !folder.name.trim() || !Number.isInteger(folder.order)) {
      automationError('pack_invalid_folder_shape', { id: folder.id })
    }
    const parentId = folder.parentId ?? null
    if (parentId !== null && !folderIds.has(parentId)) {
      automationError('pack_dangling_parent_folder_id', { folderId: folder.id, parentId })
    }
    parentById.set(folder.id, parentId)
  }

  for (const folder of folders) {
    const seen = new Set<string>()
    let current: string | null = folder.id
    while (current) {
      if (seen.has(current)) automationError('pack_folder_cycle', { folderId: folder.id })
      seen.add(current)
      current = parentById.get(current) ?? null
    }
  }
}

function validatePackReferences(pack: AutomationPack, macroIds: Set<string>, layerIds: Set<string>, folderIds: Set<string>) {
  const inspectAction = (action: FrontendAction) => {
    if (!isRecord(action) || typeof action.type !== 'string') automationError('pack_invalid_rule_shape')
    if (action.type === 'runMacro' && !macroIds.has(action.macroId)) {
      automationError('pack_dangling_macro_id', { macroId: action.macroId })
    }
    if ((action.type === 'toggleLayer' || action.type === 'holdLayer') && !layerIds.has(action.layerId)) {
      automationError('pack_dangling_layer_id', { layerId: action.layerId })
    }
  }

  const inspectCondition = (condition: FrontendCondition) => {
    if (!isRecord(condition) || typeof condition.type !== 'string') automationError('pack_invalid_rule_shape')
    if (condition.type === 'layerActive' && !layerIds.has(condition.layerId)) {
      automationError('pack_dangling_layer_id', { layerId: condition.layerId })
    }
  }

  for (const [index, rule] of pack.payload.rules.entries()) {
    if (!isRecord(rule) || !isRecord(rule.trigger) || typeof rule.trigger.type !== 'string') {
      automationError('pack_invalid_rule_shape', { index: index + 1 })
    }
    if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
      automationError('pack_rule_actions_empty', { index: index + 1 })
    }
    if (!Array.isArray(rule.conditions)) automationError('pack_invalid_rule_shape', { index: index + 1 })
    if (rule.holdActions !== undefined && rule.holdActions !== null && !Array.isArray(rule.holdActions)) {
      automationError('pack_invalid_rule_shape', { index: index + 1 })
    }
    if (rule.folderId && !folderIds.has(rule.folderId)) {
      automationError('pack_dangling_folder_id', { folderId: rule.folderId })
    }
    rule.actions.forEach(inspectAction)
    ;(rule.holdActions ?? []).forEach(inspectAction)
    rule.conditions.forEach(inspectCondition)
  }
}

export function parseAutomationPack(value: unknown): AutomationPack {
  if (jsonByteLength(value) > MAX_AUTOMATION_PACK_BYTES) automationError('pack_too_large', { maxBytes: MAX_AUTOMATION_PACK_BYTES })
  if (!isRecord(value)) automationError('pack_not_object')
  if (value.format !== 'keymaster-pack') automationError('pack_format_invalid')
  if (value.version !== 1) automationError('pack_version_unsupported', { version: String(value.version) })
  if (typeof value.id !== 'string' || !value.id.trim()) automationError('pack_id_missing')
  if (typeof value.name !== 'string' || !value.name.trim()) automationError('pack_name_missing')
  if (typeof value.description !== 'string') automationError('pack_description_missing')
  if (!isRecord(value.author) || typeof value.author.name !== 'string' || !value.author.name.trim()) automationError('pack_author_invalid')
  if (typeof value.createdAt !== 'string' || !value.createdAt.trim()) automationError('pack_created_at_missing')
  if (!isRecord(value.payload)) automationError('pack_payload_missing')
  if (!Array.isArray(value.payload.rules)) automationError('pack_rules_invalid')
  if (!Array.isArray(value.payload.macros)) automationError('pack_macros_invalid')
  if (!Array.isArray(value.payload.layers)) automationError('pack_layers_invalid')
  if (!Array.isArray(value.payload.folders)) automationError('pack_folders_invalid')
  if (value.payload.rules.length > MAX_PACK_RULES) automationError('pack_too_many_rules', { max: MAX_PACK_RULES })
  if (value.payload.macros.length > MAX_PACK_MACROS) automationError('pack_too_many_macros', { max: MAX_PACK_MACROS })
  if (value.payload.layers.length > MAX_PACK_LAYERS) automationError('pack_too_many_layers', { max: MAX_PACK_LAYERS })
  if (value.payload.folders.length > MAX_PACK_FOLDERS) automationError('pack_too_many_folders', { max: MAX_PACK_FOLDERS })

  const pack = value as unknown as AutomationPack
  const macroIds = requireUniqueIds(pack.payload.macros, 'macro')
  const layerIds = requireUniqueIds(pack.payload.layers, 'layer')
  const folderIds = requireUniqueIds(pack.payload.folders, 'folder')
  requireUniqueIds(pack.payload.rules, 'rule')

  for (const [index, macro] of pack.payload.macros.entries()) {
    if (typeof macro.name !== 'string' || !macro.name.trim() || !Array.isArray(macro.steps)) {
      automationError('pack_invalid_macro_shape', { index: index + 1 })
    }
  }
  for (const [index, layer] of pack.payload.layers.entries()) {
    if (typeof layer.name !== 'string' || !layer.name.trim()) automationError('pack_invalid_layer_shape', { index: index + 1 })
  }
  validateFolderGraph(pack.payload.folders, folderIds)
  validatePackReferences(pack, macroIds, layerIds, folderIds)
  return pack
}

export function parseAutomationPackJson(raw: string): AutomationPack {
  if (new TextEncoder().encode(raw).byteLength > MAX_AUTOMATION_PACK_BYTES) {
    automationError('pack_too_large', { maxBytes: MAX_AUTOMATION_PACK_BYTES })
  }
  try {
    return parseAutomationPack(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) automationError('pack_invalid_json')
    throw error
  }
}

export function createAutomationPack(
  profile: Profile,
  metadata: { name: string; description: string; author: string },
): AutomationPack {
  return {
    format: 'keymaster-pack',
    version: 1,
    id: crypto.randomUUID(),
    name: metadata.name.trim() || `${profile.name} Pack`,
    description: metadata.description.trim(),
    author: { name: metadata.author.trim() || 'Unknown' },
    createdAt: new Date().toISOString(),
    payload: {
      rules: structuredClone(profile.rules),
      macros: structuredClone(profile.macros),
      layers: structuredClone(profile.layers),
      folders: structuredClone(profile.folders),
    },
  }
}

function inspectActions(actions: FrontendAction[], permissions: Set<AutomationPermission>, warnings: AutomationWarning[]) {
  for (const action of actions) {
    if (['remapKey', 'remapMouse', 'typeText', 'runMacro'].includes(action.type)) permissions.add('simulate_input')
    if (action.type === 'launchApp') {
      permissions.add('launch_apps')
      warnings.push({ code: 'launch_app', ruleName: '', path: action.path })
    }
    if (action.type === 'sleep' || action.type === 'monitorOff') {
      permissions.add('system_power')
      warnings.push({ code: 'system_power', ruleName: '' })
    }
  }
}

export function inspectAutomationPack(input: AutomationPack): PackInspection {
  const pack = parseAutomationPack(input)
  const permissions = new Set<AutomationPermission>(['write_rules'])
  const warnings: AutomationWarning[] = []
  if (pack.payload.macros.some((macro) => macro.steps.length > 0)) permissions.add('simulate_input')
  for (const rule of pack.payload.rules) {
    const start = warnings.length
    inspectActions(rule.actions, permissions, warnings)
    inspectActions(rule.holdActions ?? [], permissions, warnings)
    for (let index = start; index < warnings.length; index += 1) warnings[index] = { ...warnings[index], ruleName: rule.name ?? rule.id }
  }
  return {
    rules: pack.payload.rules.length,
    macros: pack.payload.macros.length,
    layers: pack.payload.layers.length,
    folders: pack.payload.folders.length,
    permissions: { permissions: [...permissions], warnings },
  }
}

function remapAction(
  action: FrontendAction,
  macroIds: Map<string, string>,
  layerIds: Map<string, string>,
): FrontendAction {
  const copy = structuredClone(action)
  if (copy.type === 'runMacro') {
    const id = macroIds.get(copy.macroId)
    if (!id) automationError('pack_dangling_macro_id', { macroId: copy.macroId })
    copy.macroId = id
  }
  if (copy.type === 'toggleLayer' || copy.type === 'holdLayer') {
    const id = layerIds.get(copy.layerId)
    if (!id) automationError('pack_dangling_layer_id', { layerId: copy.layerId })
    copy.layerId = id
  }
  return copy
}

function remapCondition(condition: FrontendCondition, layerIds: Map<string, string>): FrontendCondition {
  const copy = structuredClone(condition)
  if (copy.type === 'layerActive') {
    const id = layerIds.get(copy.layerId)
    if (!id) automationError('pack_dangling_layer_id', { layerId: copy.layerId })
    copy.layerId = id
  }
  return copy
}

export function installAutomationPack(profile: Profile, input: AutomationPack): Profile {
  const pack = parseAutomationPack(input)
  const macroIds = new Map<string, string>()
  const layerIds = new Map<string, string>()
  const folderIds = new Map<string, string>()

  const macros = pack.payload.macros.map((macro) => {
    const id = crypto.randomUUID()
    macroIds.set(macro.id, id)
    return { ...structuredClone(macro), id }
  })

  const layers = pack.payload.layers.map((layer) => {
    const id = crypto.randomUUID()
    layerIds.set(layer.id, id)
    return { ...structuredClone(layer), id }
  })

  for (const folder of pack.payload.folders) folderIds.set(folder.id, crypto.randomUUID())
  const folders = pack.payload.folders.map((folder, index) => {
    const parentId = folder.parentId
      ? folderIds.get(folder.parentId) ?? automationError('pack_dangling_parent_folder_id', { folderId: folder.id, parentId: folder.parentId })
      : null
    return {
      ...structuredClone(folder),
      id: folderIds.get(folder.id)!,
      parentId,
      order: profile.folders.length + index,
    }
  })

  const rules = pack.payload.rules.map((rule, index) => {
    const folderId = rule.folderId
      ? folderIds.get(rule.folderId) ?? automationError('pack_dangling_folder_id', { folderId: rule.folderId })
      : null
    return {
      ...structuredClone(rule),
      id: crypto.randomUUID(),
      actions: rule.actions.map((action) => remapAction(action, macroIds, layerIds)),
      holdActions: rule.holdActions?.map((action) => remapAction(action, macroIds, layerIds)) ?? null,
      conditions: rule.conditions.map((condition) => remapCondition(condition, layerIds)),
      folderId,
      order: profile.rules.length + index,
    }
  })

  return {
    ...profile,
    rules: [...profile.rules, ...rules],
    macros: [...profile.macros, ...macros],
    layers: [...profile.layers, ...layers],
    folders: [...profile.folders, ...folders],
  }
}
