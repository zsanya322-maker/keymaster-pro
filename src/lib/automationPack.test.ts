import { describe, expect, it } from 'vitest'
import { AutomationError } from './automationErrors'
import {
  MAX_AUTOMATION_PACK_BYTES,
  inspectAutomationPack,
  installAutomationPack,
  parseAutomationPack,
  parseAutomationPackJson,
  type AutomationPack,
} from './automationPack'
import type { Profile } from './types'

const profile: Profile = {
  id: 'profile',
  name: 'Profile',
  isDefault: false,
  linkedApps: [],
  bindings: [],
  order: 0,
  rules: [],
  macros: [],
  layers: [],
  folders: [],
}

function validPack(): AutomationPack {
  return {
    format: 'keymaster-pack',
    version: 1,
    id: 'pack',
    name: 'Pack',
    description: 'Fixture',
    author: { name: 'Tester' },
    createdAt: '2026-08-19T00:00:00.000Z',
    payload: {
      macros: [{ id: 'macro-1', name: 'Macro', steps: [{ action: { type: 'keyDown', code: 65 }, delayMs: 10 }] }],
      layers: [{ id: 'layer-1', name: 'Layer' }],
      folders: [
        { id: 'folder-root', name: 'Root', parentId: null, order: 0 },
        { id: 'folder-child', name: 'Child', parentId: 'folder-root', order: 1 },
      ],
      rules: [{
        id: 'rule-1',
        name: 'Rule',
        trigger: { type: 'keyDown', code: 70, modifiers: 0 },
        actions: [{ type: 'runMacro', macroId: 'macro-1', playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }],
        holdActions: [{ type: 'toggleLayer', layerId: 'layer-1' }],
        conditions: [{ type: 'layerActive', layerId: 'layer-1' }],
        priority: 10,
        enabled: true,
        folderId: 'folder-child',
        order: 0,
      }],
    },
  }
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn()
    throw new Error('expected validation error')
  } catch (error) {
    expect(error).toBeInstanceOf(AutomationError)
    expect((error as AutomationError).code).toBe(code)
  }
}

describe('parseAutomationPack', () => {
  it('accepts a valid pack', () => {
    expect(parseAutomationPack(validPack()).payload.rules).toHaveLength(1)
  })

  it('rejects malformed JSON before schema validation', () => {
    expectCode(() => parseAutomationPackJson('{not json'), 'pack_invalid_json')
  })

  it('rejects oversized input', () => {
    const pack = validPack()
    pack.description = 'x'.repeat(MAX_AUTOMATION_PACK_BYTES + 32)
    expectCode(() => parseAutomationPack(pack), 'pack_too_large')
  })

  it('rejects duplicate ids', () => {
    const pack = validPack()
    pack.payload.macros.push(structuredClone(pack.payload.macros[0]))
    expectCode(() => parseAutomationPack(pack), 'pack_duplicate_macro_id')
  })

  it('rejects dangling macroId', () => {
    const pack = validPack()
    pack.payload.rules[0].actions = [{ type: 'runMacro', macroId: 'missing', playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }]
    expectCode(() => parseAutomationPack(pack), 'pack_dangling_macro_id')
  })

  it('rejects dangling layerId', () => {
    const pack = validPack()
    pack.payload.rules[0].conditions = [{ type: 'layerActive', layerId: 'missing' }]
    expectCode(() => parseAutomationPack(pack), 'pack_dangling_layer_id')
  })

  it('rejects dangling rule folderId rather than silently moving the rule to root', () => {
    const pack = validPack()
    pack.payload.rules[0].folderId = 'missing'
    expectCode(() => parseAutomationPack(pack), 'pack_dangling_folder_id')
  })

  it('rejects dangling parent folders and folder cycles', () => {
    const missing = validPack()
    missing.payload.folders[1].parentId = 'missing'
    expectCode(() => parseAutomationPack(missing), 'pack_dangling_parent_folder_id')

    const cyclic = validPack()
    cyclic.payload.folders[0].parentId = 'folder-child'
    expectCode(() => parseAutomationPack(cyclic), 'pack_folder_cycle')
  })

  it('rejects rules with empty actions', () => {
    const pack = validPack()
    pack.payload.rules[0].actions = []
    expectCode(() => parseAutomationPack(pack), 'pack_rule_actions_empty')
  })
})

describe('installAutomationPack', () => {
  it('regenerates ids and rewrites every internal reference', () => {
    const pack = validPack()
    const installed = installAutomationPack(profile, pack)
    const macro = installed.macros[0]
    const layer = installed.layers[0]
    const [root, child] = installed.folders
    const rule = installed.rules[0]

    expect(macro.id).not.toBe('macro-1')
    expect(layer.id).not.toBe('layer-1')
    expect(root.id).not.toBe('folder-root')
    expect(child.parentId).toBe(root.id)
    expect(rule.folderId).toBe(child.id)
    expect(rule.actions[0]).toMatchObject({ type: 'runMacro', macroId: macro.id })
    expect(rule.holdActions?.[0]).toMatchObject({ type: 'toggleLayer', layerId: layer.id })
    expect(rule.conditions[0]).toMatchObject({ type: 'layerActive', layerId: layer.id })
  })
})

describe('inspectAutomationPack', () => {
  it('validates first and reports permissions from actual actions', () => {
    const pack = validPack()
    pack.payload.rules[0].actions.push({ type: 'launchApp', path: 'notepad.exe' })
    const inspection = inspectAutomationPack(pack)
    expect(inspection.rules).toBe(1)
    expect(inspection.permissions.permissions).toContain('simulate_input')
    expect(inspection.permissions.permissions).toContain('launch_apps')
    expect(inspection.permissions.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'launch_app', path: 'notepad.exe' }),
    ]))
  })
})
