import type {
  FrontendAction,
  FrontendCondition,
  FrontendRule,
  LayerMeta,
  MacroDefinition,
  Profile,
  RuleFolder,
} from './types'
import type { AutomationPermission, PermissionSummary } from './innovation'

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

export interface PackInspection {
  rules: number
  macros: number
  layers: number
  folders: number
  permissions: PermissionSummary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseAutomationPack(value: unknown): AutomationPack {
  if (!isRecord(value)) throw new Error('Pack должен быть JSON-объектом')
  if (value.format !== 'keymaster-pack') throw new Error('Это не KeyMaster automation pack')
  if (value.version !== 1) throw new Error(`Неподдерживаемая версия pack: ${String(value.version)}`)
  if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('Pack id отсутствует')
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Pack name отсутствует')
  if (typeof value.description !== 'string') throw new Error('Pack description отсутствует')
  if (!isRecord(value.author) || typeof value.author.name !== 'string') throw new Error('Некорректный author')
  if (typeof value.createdAt !== 'string') throw new Error('createdAt отсутствует')
  if (!isRecord(value.payload)) throw new Error('Pack payload отсутствует')
  if (!Array.isArray(value.payload.rules)) throw new Error('payload.rules должен быть массивом')
  if (!Array.isArray(value.payload.macros)) throw new Error('payload.macros должен быть массивом')
  if (!Array.isArray(value.payload.layers)) throw new Error('payload.layers должен быть массивом')
  if (!Array.isArray(value.payload.folders)) throw new Error('payload.folders должен быть массивом')
  return value as unknown as AutomationPack
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

function inspectActions(actions: FrontendAction[], permissions: Set<AutomationPermission>, warnings: string[]) {
  for (const action of actions) {
    if (['remapKey', 'remapMouse', 'typeText', 'runMacro'].includes(action.type)) permissions.add('simulate_input')
    if (action.type === 'launchApp') {
      permissions.add('launch_apps')
      warnings.push(`Запуск приложения: ${action.path}`)
    }
    if (action.type === 'sleep' || action.type === 'monitorOff') {
      permissions.add('system_power')
      warnings.push('Системное power-действие')
    }
  }
}

export function inspectAutomationPack(pack: AutomationPack): PackInspection {
  const permissions = new Set<AutomationPermission>(['write_rules'])
  const warnings: string[] = []
  if (pack.payload.macros.some((macro) => macro.steps.length > 0)) permissions.add('simulate_input')
  for (const rule of pack.payload.rules) {
    inspectActions(rule.actions, permissions, warnings)
    inspectActions(rule.holdActions ?? [], permissions, warnings)
  }
  return {
    rules: pack.payload.rules.length,
    macros: pack.payload.macros.length,
    layers: pack.payload.layers.length,
    folders: pack.payload.folders.length,
    permissions: { permissions: [...permissions], warnings: [...new Set(warnings)] },
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
    if (!id) throw new Error(`Pack ссылается на отсутствующий macroId: ${copy.macroId}`)
    copy.macroId = id
  }
  if (copy.type === 'toggleLayer' || copy.type === 'holdLayer') {
    const id = layerIds.get(copy.layerId)
    if (!id) throw new Error(`Pack ссылается на отсутствующий layerId: ${copy.layerId}`)
    copy.layerId = id
  }
  return copy
}

function remapCondition(condition: FrontendCondition, layerIds: Map<string, string>): FrontendCondition {
  const copy = structuredClone(condition)
  if (copy.type === 'layerActive') {
    const id = layerIds.get(copy.layerId)
    if (!id) throw new Error(`Pack ссылается на отсутствующий layerId: ${copy.layerId}`)
    copy.layerId = id
  }
  return copy
}

export function installAutomationPack(profile: Profile, pack: AutomationPack): Profile {
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
  const folders = pack.payload.folders.map((folder, index) => ({
    ...structuredClone(folder),
    id: folderIds.get(folder.id)!,
    parentId: folder.parentId ? folderIds.get(folder.parentId) ?? null : null,
    order: profile.folders.length + index,
  }))

  const rules = pack.payload.rules.map((rule, index) => ({
    ...structuredClone(rule),
    id: crypto.randomUUID(),
    actions: rule.actions.map((action) => remapAction(action, macroIds, layerIds)),
    holdActions: rule.holdActions?.map((action) => remapAction(action, macroIds, layerIds)) ?? null,
    conditions: rule.conditions.map((condition) => remapCondition(condition, layerIds)),
    folderId: rule.folderId ? folderIds.get(rule.folderId) ?? null : null,
    order: profile.rules.length + index,
  }))

  return {
    ...profile,
    rules: [...profile.rules, ...rules],
    macros: [...profile.macros, ...macros],
    layers: [...profile.layers, ...layers],
    folders: [...profile.folders, ...folders],
  }
}
