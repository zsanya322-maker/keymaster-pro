import { describe, expect, it } from 'vitest'
import { AutomationError } from './automationErrors'
import { materializeAutomationDraft, parseAutomationDraft } from './innovation'
import type { Profile } from './types'

const profile: Profile = {
  id: 'profile-1',
  name: 'Test',
  isDefault: false,
  linkedApps: [],
  bindings: [],
  order: 0,
  rules: [],
  macros: [],
  layers: [{ id: 'layer-1', name: 'Layer' }],
  folders: [],
}

function validDraft() {
  return {
    version: 1,
    title: 'Generated',
    summary: 'Test automation',
    macros: [
      {
        ref: 'm1',
        name: 'Macro',
        steps: [
          { action: { type: 'keyDown', code: 65 }, delayMs: 20 },
          { action: { type: 'keyUp', code: 65 }, delayMs: 20 },
        ],
      },
    ],
    rules: [
      {
        name: 'Rule',
        trigger: { type: 'keyDown', code: 77, modifiers: 3 },
        actions: [{ type: 'runMacroRef', macroRef: 'm1', playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }],
        conditions: [{ type: 'layerActive', layerId: 'layer-1' }],
        priority: 10,
        enabled: true,
      },
    ],
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

describe('parseAutomationDraft', () => {
  it('accepts a structurally valid draft', () => {
    const draft = parseAutomationDraft(validDraft())
    expect(draft.rules).toHaveLength(1)
    expect(draft.macros).toHaveLength(1)
  })

  it('rejects malformed draft roots and versions', () => {
    expectCode(() => parseAutomationDraft(null), 'draft_not_object')
    expectCode(() => parseAutomationDraft({ ...validDraft(), version: 2 }), 'draft_version_unsupported')
  })

  it('rejects duplicate macro refs', () => {
    const input = validDraft()
    input.macros.push(structuredClone(input.macros[0]))
    expectCode(() => parseAutomationDraft(input), 'draft_macro_ref_duplicate')
  })

  it('rejects unknown macro refs', () => {
    const input = validDraft()
    input.rules[0].actions = [{ type: 'runMacroRef', macroRef: 'missing', playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }]
    expectCode(() => parseAutomationDraft(input), 'draft_macro_ref_missing_target')
  })

  it('rejects empty actions', () => {
    const input = validDraft()
    input.rules[0].actions = []
    expectCode(() => parseAutomationDraft(input), 'draft_actions_empty')
  })

  it('rejects malformed macro steps instead of cloning them', () => {
    const input = validDraft()
    input.macros[0].steps = [{ action: { type: 'keyDown', code: 999 }, delayMs: -1 }]
    expectCode(() => parseAutomationDraft(input), 'draft_macro_steps_invalid')
  })

  it('rejects malformed trigger and action payloads', () => {
    const input = validDraft()
    input.rules[0].trigger = { type: 'keyDown', code: 999, modifiers: 0 }
    expectCode(() => parseAutomationDraft(input), 'draft_trigger_invalid')

    const second = validDraft()
    second.rules[0].actions = [{ type: 'runMacroRef', macroRef: 'm1', playback: { speed: 0, repeatCount: 1, repeatWhileHeld: false } }]
    expectCode(() => parseAutomationDraft(second), 'draft_action_invalid')
  })
})

describe('materializeAutomationDraft', () => {
  it('generates fresh ids and rewrites macroRef to the generated macro id', () => {
    const draft = parseAutomationDraft(validDraft())
    const materialized = materializeAutomationDraft(draft, profile)
    expect(materialized.macros).toHaveLength(1)
    expect(materialized.rules).toHaveLength(1)
    expect(materialized.macros[0].id).not.toBe('m1')
    expect(materialized.rules[0].id).toBeTruthy()
    expect(materialized.rules[0].actions[0]).toMatchObject({
      type: 'runMacro',
      macroId: materialized.macros[0].id,
    })
    expect(materialized.rules[0].conditions).toEqual([{ type: 'layerActive', layerId: 'layer-1' }])
  })
})
