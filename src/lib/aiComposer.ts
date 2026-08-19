import { invoke } from './ipc'
import type { Profile } from './types'
import { parseAutomationDraft, type AiAutomationDraft } from './innovation'
import { AutomationError, automationError, type AutomationErrorCode } from './automationErrors'

export interface AiProviderConfig {
  endpoint: string
  model: string
  apiKey: string
}

interface AiChatResponse {
  content: string
}

function compactProfileContext(profile: Profile) {
  return {
    id: profile.id,
    name: profile.name,
    layers: profile.layers.map((layer) => ({ id: layer.id, name: layer.name })),
    existingMacros: profile.macros.map((macro) => ({ id: macro.id, name: macro.name })),
    existingRules: profile.rules.map((rule) => ({ id: rule.id, name: rule.name, trigger: rule.trigger })),
  }
}

export function buildComposerSystemPrompt(profile: Profile): string {
  return `You are the KeyMaster Pro automation composer.
Return ONLY one JSON object. No markdown fences and no prose outside JSON.
The JSON must use draft format version 1:
{
  "version": 1,
  "title": "short title",
  "summary": "what will be created",
  "macros": [{"ref":"m1","name":"...","steps":[{"action":{"type":"keyDown","code":65},"delayMs":30}]}],
  "rules": [{
    "name":"...",
    "trigger": { ... },
    "actions": [{ ... }],
    "holdActions": null,
    "conditions": [],
    "priority": 10,
    "enabled": true
  }]
}

Allowed trigger shapes:
- {"type":"keyDown","code":<0..255>,"modifiers":<bitmask>}
- {"type":"keyUp","code":<0..255>,"modifiers":<bitmask>}
- {"type":"mouseDown","code":<button>}
- {"type":"mouseUp","code":<button>}
- {"type":"mouseWheel","direction":"up|down|left|right"}
- {"type":"mouseDoubleClick","code":<button>}
- {"type":"mouseMove","minDistance":24,"cooldownMs":120}
- {"type":"leaderSequence","leader":{"code":<vk>,"modifiers":<mask>},"sequence":[<vk>],"timeoutMs":800}
- {"type":"keySequence","sequence":[<vk>],"timeoutMs":800}
- {"type":"keyChordSet","codes":[<vk>,<vk>,<vk>],"maxSkewMs":80}
- {"type":"mouseGesture","code":<button>,"directions":["up|down|left|right"],"minDistance":28}
- {"type":"tapHoldKeyDown","code":<vk>,"timeoutMs":200}
- {"type":"typedText","sequence":"...","mode":"instant|delimiter","delimiters":" \\t\\n.,;:!?","caseSensitive":true}

Modifier bitmask: CTRL=1, ALT=2, SHIFT=4, WIN=8, LCTRL=16, RCTRL=32, LALT=64, RALT=128, LSHIFT=256, RSHIFT=512, LWIN=1024, RWIN=2048.

Allowed actions:
- {"type":"remapKey","code":<vk>,"modifiers":<mask>}
- {"type":"remapMouse","code":<button>}
- {"type":"typeText","text":"...","dateFormat":"dmy|ymd|mdy","timeFormat":"hm24|hms24|hm12"}
- {"type":"runMacroRef","macroRef":"m1","playback":{"speed":1,"repeatCount":1,"repeatWhileHeld":false}}
- {"type":"toggleLayer","layerId":"existing-layer-id"}
- {"type":"holdLayer","layerId":"existing-layer-id"}
- {"type":"systemVolume","action":"mute|up|down"}
- {"type":"mediaKey","key":"play_pause|next|prev|stop"}
- {"type":"windowAction","action":"snap_left|snap_right|snap_center|minimize|maximize|close"}
- {"type":"launchApp","path":"C:\\\\..."}
- {"type":"focusProcess","process":"app.exe","title":"optional"}
- {"type":"sleep"}
- {"type":"monitorOff"}

Allowed conditions:
- {"type":"layerActive","layerId":"existing-layer-id"}
- {"type":"contextMatch","process":"chrome.exe","path":null,"title":null,"className":null,"virtualDesktopId":null,"monitorId":null,"minWidth":null,"maxWidth":null,"minHeight":null,"maxHeight":null,"fullscreen":null,"mode":"any|all"}
- {"type":"windowMatch","process":"chrome.exe","title":"optional"}

Do not invent a layerId that is not in profile context. If a requested automation cannot be represented safely by this schema, return a draft with zero rules and explain the limitation in summary. Never emit shell commands unless the user explicitly asks to launch a specific executable path. Prefer deterministic KeyMaster actions over vague GUI clicking.

Current profile context:
${JSON.stringify(compactProfileContext(profile))}`
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

const AI_BRIDGE_MARKER = 'KEYMASTER_AI_ERROR|'
const aiBridgeCodes: Record<string, AutomationErrorCode> = {
  endpoint_invalid: 'ai_endpoint_invalid',
  endpoint_scheme: 'ai_endpoint_scheme',
  remote_http_forbidden: 'ai_remote_http_forbidden',
  model_missing: 'ai_model_missing',
  messages_empty: 'ai_messages_empty',
  messages_too_many: 'ai_messages_too_many',
  message_too_large: 'ai_message_too_large',
  client_create_failed: 'ai_client_create_failed',
  provider_unavailable: 'ai_provider_unavailable',
  response_read_failed: 'ai_response_read_failed',
  provider_http: 'ai_provider_http',
  provider_invalid_json: 'ai_provider_invalid_json',
  provider_content_missing: 'ai_provider_content_missing',
  provider_profile_missing: 'ai_provider_missing',
  provider_profile_load_failed: 'ai_provider_missing',
}

export function decodeAiBridgeError(error: unknown): AutomationError | null {
  const source = error instanceof Error ? error.message : String(error)
  const markerIndex = source.indexOf(AI_BRIDGE_MARKER)
  if (markerIndex < 0) return null
  const payload = source.slice(markerIndex + AI_BRIDGE_MARKER.length)
  const separator = payload.indexOf('|')
  const bridgeCode = separator >= 0 ? payload.slice(0, separator) : payload
  const detail = separator >= 0 ? payload.slice(separator + 1) : ''
  const code = aiBridgeCodes[bridgeCode]
  if (!code) return null
  return new AutomationError(code, detail ? { detail } : {})
}

function parseDraftContent(content: string): AiAutomationDraft {
  const raw = stripCodeFence(content)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    automationError('ai_invalid_json', { detail: error instanceof Error ? error.message : String(error) })
  }
  return parseAutomationDraft(parsed)
}

function composerMessages(profile: Profile, userPrompt: string) {
  return [
    { role: 'system', content: buildComposerSystemPrompt(profile) },
    { role: 'user', content: userPrompt.trim() },
  ]
}

export async function requestAutomationDraft(
  provider: AiProviderConfig,
  profile: Profile,
  userPrompt: string,
): Promise<AiAutomationDraft> {
  const endpoint = provider.endpoint.trim()
  const model = provider.model.trim()
  if (!endpoint) automationError('ai_endpoint_missing')
  if (!model) automationError('ai_model_missing')
  if (!userPrompt.trim()) automationError('ai_prompt_missing')

  let response: AiChatResponse
  try {
    response = await invoke<AiChatResponse>('ai_chat_completion', {
      request: {
        endpoint,
        model,
        apiKey: provider.apiKey,
        messages: composerMessages(profile, userPrompt),
        temperature: 0.15,
      },
    })
  } catch (error) {
    const decoded = decodeAiBridgeError(error)
    if (decoded) throw decoded
    throw error
  }

  return parseDraftContent(response.content)
}

export async function requestAutomationDraftFromSavedProvider(
  providerId: string,
  profile: Profile,
  userPrompt: string,
): Promise<AiAutomationDraft> {
  const cleanProviderId = providerId.trim()
  if (!cleanProviderId) automationError('ai_provider_missing')
  if (!userPrompt.trim()) automationError('ai_prompt_missing')

  let response: AiChatResponse
  try {
    response = await invoke<AiChatResponse>('ai_chat_completion_saved', {
      request: {
        providerId: cleanProviderId,
        messages: composerMessages(profile, userPrompt),
        temperature: 0.15,
      },
    })
  } catch (error) {
    const decoded = decodeAiBridgeError(error)
    if (decoded) throw decoded
    throw error
  }

  return parseDraftContent(response.content)
}
