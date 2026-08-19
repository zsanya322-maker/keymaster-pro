import { invoke } from './ipc'
import type { Profile } from './types'
import { parseAutomationDraft, type AiAutomationDraft } from './innovation'

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

export async function requestAutomationDraft(
  provider: AiProviderConfig,
  profile: Profile,
  userPrompt: string,
): Promise<AiAutomationDraft> {
  const endpoint = provider.endpoint.trim()
  const model = provider.model.trim()
  if (!endpoint) throw new Error('Укажите OpenAI-compatible endpoint')
  if (!model) throw new Error('Укажите модель')
  if (!userPrompt.trim()) throw new Error('Опишите автоматизацию')

  const response = await invoke<AiChatResponse>('ai_chat_completion', {
    request: {
      endpoint,
      model,
      apiKey: provider.apiKey,
      messages: [
        { role: 'system', content: buildComposerSystemPrompt(profile) },
        { role: 'user', content: userPrompt.trim() },
      ],
      temperature: 0.15,
    },
  })

  const raw = stripCodeFence(response.content)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`AI вернул невалидный JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseAutomationDraft(parsed)
}
