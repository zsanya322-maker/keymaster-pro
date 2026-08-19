import { afterEach, describe, expect, it } from 'vitest'
import { useKeyMasterStore } from './keyMasterStore'
import type { AiAutomationDraft } from '../lib/innovation'

const initialSession = {
  tab: 'ai' as const,
  prompt: '',
  draft: null,
  materialized: null,
  draftProfileId: null,
}

afterEach(() => {
  useKeyMasterStore.setState({
    activeCategory: 'rules',
    rulesDirty: false,
    lastAutomationInstall: null,
    automationLabSession: initialSession,
  })
})

describe('Automation Lab session', () => {
  it('survives navigation away from Automation Lab', () => {
    const draft: AiAutomationDraft = {
      version: 1,
      title: 'Two rules',
      summary: 'Generated draft',
      macros: [],
      rules: [
        {
          name: 'Rule 1',
          trigger: { type: 'keyDown', code: 65, modifiers: 2 },
          actions: [{ type: 'remapKey', code: 66, modifiers: 0 }],
        },
      ],
    }

    useKeyMasterStore.getState().setActiveCategory('automation')
    useKeyMasterStore.getState().setAutomationLabSession({
      prompt: 'create two rules',
      draft,
      draftProfileId: 'profile-1',
    })

    useKeyMasterStore.getState().setActiveCategory('rules')
    useKeyMasterStore.getState().setActiveCategory('automation')

    const session = useKeyMasterStore.getState().automationLabSession
    expect(session.prompt).toBe('create two rules')
    expect(session.draft?.title).toBe('Two rules')
    expect(session.draftProfileId).toBe('profile-1')
  })

  it('patches session fields without clearing the generated draft', () => {
    const draft: AiAutomationDraft = {
      version: 1,
      title: 'Keep me',
      summary: 'Draft state',
      macros: [],
      rules: [],
    }

    useKeyMasterStore.getState().setAutomationLabSession({ draft, prompt: 'first prompt' })
    useKeyMasterStore.getState().setAutomationLabSession({ tab: 'mcp' })

    const session = useKeyMasterStore.getState().automationLabSession
    expect(session.tab).toBe('mcp')
    expect(session.prompt).toBe('first prompt')
    expect(session.draft?.title).toBe('Keep me')
  })
})
