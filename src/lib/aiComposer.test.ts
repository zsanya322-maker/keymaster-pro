import { describe, expect, it } from 'vitest'
import { decodeAiBridgeError } from './aiComposer'

describe('AI bridge error localization boundary', () => {
  it('decodes a provider error into a stable AutomationError code', () => {
    const error = decodeAiBridgeError('invoke failed: KEYMASTER_AI_ERROR|provider_unavailable|connection refused')
    expect(error?.code).toBe('ai_provider_unavailable')
    expect(error?.details.detail).toBe('connection refused')
  })

  it('decodes endpoint policy errors without depending on Rust prose', () => {
    const error = decodeAiBridgeError('KEYMASTER_AI_ERROR|remote_http_forbidden|')
    expect(error?.code).toBe('ai_remote_http_forbidden')
  })

  it('leaves unrelated IPC failures untouched', () => {
    expect(decodeAiBridgeError('ordinary IPC failure')).toBeNull()
  })
})
