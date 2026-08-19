import json
import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)


# Automation Lab: keep Undo receipt in the app-level Zustand store so navigating
# away from the category does not silently discard the one-click rollback handle.
path = Path("src/pages/AutomationLabPage.tsx")
text = path.read_text(encoding="utf-8")
if "../store/keyMasterStore" not in text:
    text = replace_once(
        text,
        "import { useProfileStore } from '../store/profileStore'\n",
        "import { useProfileStore } from '../store/profileStore'\nimport { useKeyMasterStore } from '../store/keyMasterStore'\n",
        "AutomationLab keyMasterStore import",
    )
text = text.replace(
    "  const [lastInstall, setLastInstall] = useState<AutomationInstallReceipt | null>(null)\n",
    "  const { lastAutomationInstall: lastInstall, setLastAutomationInstall: setLastInstall } = useKeyMasterStore()\n",
    1,
)
path.write_text(text, encoding="utf-8")


# Canonical Rust automation write boundary: caller-supplied order values are
# metadata, not authority. Reassign rule/folder order under the same mutation
# lock that protects the load/validate/save transaction.
path = Path("src-tauri/src/daemon/automation.rs")
text = path.read_text(encoding="utf-8")
old = """fn candidate_with_additions(mut profile: Profile, additions: AutomationAdditions) -> Profile {
    profile.rules.extend(additions.rules);
    profile.macros.extend(additions.macros);
    profile.layers.extend(additions.layers);
    profile.folders.extend(additions.folders);
    profile
}
"""
new = """fn next_rule_order(profile: &Profile) -> i32 {
    profile
        .rules
        .iter()
        .map(|rule| rule.order)
        .max()
        .unwrap_or(-1)
        .saturating_add(1)
}

fn next_folder_order(profile: &Profile) -> i32 {
    profile
        .folders
        .iter()
        .map(|folder| folder.order)
        .max()
        .unwrap_or(-1)
        .saturating_add(1)
}

fn candidate_with_additions(mut profile: Profile, mut additions: AutomationAdditions) -> Profile {
    let rule_start = next_rule_order(&profile);
    for (index, rule) in additions.rules.iter_mut().enumerate() {
        rule.order = rule_start.saturating_add(i32::try_from(index).unwrap_or(i32::MAX));
    }
    let folder_start = next_folder_order(&profile);
    for (index, folder) in additions.folders.iter_mut().enumerate() {
        folder.order = folder_start.saturating_add(i32::try_from(index).unwrap_or(i32::MAX));
    }

    profile.rules.extend(additions.rules);
    profile.macros.extend(additions.macros);
    profile.layers.extend(additions.layers);
    profile.folders.extend(additions.folders);
    profile
}
"""
if old in text:
    text = text.replace(old, new, 1)
text = text.replace(
    "    let rule = normalize_rule_value(request.rule, profile.rules.len() as i32)?;\n",
    "    let rule = normalize_rule_value(request.rule, next_rule_order(&profile))?;\n",
)
if "additions_order_is_normalized_inside_write_boundary" not in text:
    test_insert = """
    #[test]
    fn additions_order_is_normalized_inside_write_boundary() {
        let mut profile = base_profile();
        profile.folders[0].order = 30;
        let mut existing = valid_rule();
        existing.id = "existing".into();
        existing.order = 40;
        profile.rules.push(existing);

        let mut incoming = valid_rule();
        incoming.id = "incoming".into();
        incoming.order = -100;
        let additions = AutomationAdditions {
            rules: vec![incoming],
            folders: vec![RuleFolder {
                id: "new-folder".into(),
                name: "New folder".into(),
                parent_id: None,
                order: -100,
            }],
            ..AutomationAdditions::default()
        };

        let candidate = candidate_with_additions(profile, additions);
        assert_eq!(candidate.rules.last().unwrap().order, 41);
        assert_eq!(candidate.folders.last().unwrap().order, 31);
    }
"""
    text = text.rsplit("\n}", 1)[0] + test_insert + "\n}\n"
path.write_text(text, encoding="utf-8")


# AI bridge: Rust must not leak one hard-coded language into the bilingual UI.
# Return stable machine codes; TypeScript turns them into localized AutomationError.
path = Path("src-tauri/src/gui/ai.rs")
text = path.read_text(encoding="utf-8")
if "fn ai_error(" not in text:
    text = replace_once(
        text,
        "fn default_temperature() -> f32 {\n    0.15\n}\n",
        """fn default_temperature() -> f32 {
    0.15
}

fn ai_error(code: &str, detail: impl AsRef<str>) -> String {
    let detail = detail.as_ref().replace(['\\r', '\\n'], " ");
    format!("KEYMASTER_AI_ERROR|{code}|{detail}")
}
""",
        "AI bridge error helper",
    )
replacements = {
    'reqwest::Url::parse(&candidate).map_err(|error| format!("Некорректный AI endpoint: {error}"))?':
        'reqwest::Url::parse(&candidate).map_err(|error| ai_error("endpoint_invalid", error.to_string()))?',
    'return Err("AI endpoint должен использовать http:// или https://".to_string());':
        'return Err(ai_error("endpoint_scheme", url.scheme()));',
    'return Err("Удалённый AI endpoint без TLS запрещён. Используйте https://; http:// разрешён только для localhost.".to_string());':
        'return Err(ai_error("remote_http_forbidden", ""));',
    '.ok_or_else(|| "AI provider вернул ответ без choices[0].message.content".to_string())':
        '.ok_or_else(|| ai_error("provider_content_missing", "choices[0].message.content"))',
    'return Err("AI model не указан".to_string());':
        'return Err(ai_error("model_missing", ""));',
    'return Err("AI messages пусты".to_string());':
        'return Err(ai_error("messages_empty", ""));',
    'return Err("Слишком много AI messages в одном запросе".to_string());':
        'return Err(ai_error("messages_too_many", request.messages.len().to_string()));',
    'return Err("AI message превышает безопасный лимит размера".to_string());':
        'return Err(ai_error("message_too_large", "64000"));',
    '.map_err(|error| format!("Не удалось создать AI HTTP client: {error}"))?':
        '.map_err(|error| ai_error("client_create_failed", error.to_string()))?',
    '.map_err(|error| format!("AI provider недоступен: {error}"))?':
        '.map_err(|error| ai_error("provider_unavailable", error.to_string()))?',
    '.map_err(|error| format!("Не удалось прочитать AI response: {error}"))?':
        '.map_err(|error| ai_error("response_read_failed", error.to_string()))?',
    'return Err(format!("AI provider HTTP {}: {}", status.as_u16(), safe_excerpt));':
        'return Err(ai_error("provider_http", format!("{}: {}", status.as_u16(), safe_excerpt)));',
    '.map_err(|error| format!("AI provider вернул не JSON: {error}"))?':
        '.map_err(|error| ai_error("provider_invalid_json", error.to_string()))?',
}
for old_text, new_text in replacements.items():
    text = text.replace(old_text, new_text)
path.write_text(text, encoding="utf-8")


path = Path("src/lib/automationErrors.ts")
text = path.read_text(encoding="utf-8")
anchor = "  | 'ai_invalid_json'\n"
extra_codes = """  | 'ai_endpoint_invalid'
  | 'ai_endpoint_scheme'
  | 'ai_remote_http_forbidden'
  | 'ai_messages_empty'
  | 'ai_messages_too_many'
  | 'ai_message_too_large'
  | 'ai_client_create_failed'
  | 'ai_provider_unavailable'
  | 'ai_response_read_failed'
  | 'ai_provider_http'
  | 'ai_provider_invalid_json'
  | 'ai_provider_content_missing'
"""
if "'ai_provider_unavailable'" not in text:
    text = replace_once(text, anchor, anchor + extra_codes, "AutomationError AI codes")
path.write_text(text, encoding="utf-8")


path = Path("src/lib/aiComposer.ts")
text = path.read_text(encoding="utf-8")
text = text.replace(
    "import { automationError } from './automationErrors'\n",
    "import { AutomationError, automationError, type AutomationErrorCode } from './automationErrors'\n",
    1,
)
if "decodeAiBridgeError" not in text:
    marker = """function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\\s*/i, '')
    .replace(/\\s*```$/, '')
    .trim()
}
"""
    helper = marker + """
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
"""
    text = replace_once(text, marker, helper, "AI bridge decoder")
old_invoke = """  const response = await invoke<AiChatResponse>('ai_chat_completion', {
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
"""
new_invoke = """  let response: AiChatResponse
  try {
    response = await invoke<AiChatResponse>('ai_chat_completion', {
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
  } catch (error) {
    const decoded = decodeAiBridgeError(error)
    if (decoded) throw decoded
    throw error
  }
"""
if old_invoke in text:
    text = text.replace(old_invoke, new_invoke, 1)
path.write_text(text, encoding="utf-8")


test_path = Path("src/lib/aiComposer.test.ts")
if not test_path.exists():
    test_path.write_text(
        """import { describe, expect, it } from 'vitest'\nimport { decodeAiBridgeError } from './aiComposer'\n\ndescribe('AI bridge error localization boundary', () => {\n  it('decodes a provider error into a stable AutomationError code', () => {\n    const error = decodeAiBridgeError('invoke failed: KEYMASTER_AI_ERROR|provider_unavailable|connection refused')\n    expect(error?.code).toBe('ai_provider_unavailable')\n    expect(error?.details.detail).toBe('connection refused')\n  })\n\n  it('decodes endpoint policy errors without depending on Rust prose', () => {\n    const error = decodeAiBridgeError('KEYMASTER_AI_ERROR|remote_http_forbidden|')\n    expect(error?.code).toBe('ai_remote_http_forbidden')\n  })\n\n  it('leaves unrelated IPC failures untouched', () => {\n    expect(decodeAiBridgeError('ordinary IPC failure')).toBeNull()\n  })\n})\n""",
        encoding="utf-8",
    )


# Add matching EN/RU UI text for every bridge error code.
error_text = {
    "en": {
        "ai_endpoint_invalid": "Invalid AI endpoint: {{detail}}",
        "ai_endpoint_scheme": "AI endpoint must use http:// or https:// (received {{detail}})",
        "ai_remote_http_forbidden": "Remote AI endpoints must use HTTPS. Plain HTTP is allowed only for localhost.",
        "ai_messages_empty": "AI request contains no messages",
        "ai_messages_too_many": "AI request contains too many messages: {{detail}}",
        "ai_message_too_large": "An AI message exceeds the safe size limit ({{detail}} bytes)",
        "ai_client_create_failed": "Could not create the AI HTTP client: {{detail}}",
        "ai_provider_unavailable": "AI provider is unavailable: {{detail}}",
        "ai_response_read_failed": "Could not read the AI provider response: {{detail}}",
        "ai_provider_http": "AI provider returned an HTTP error: {{detail}}",
        "ai_provider_invalid_json": "AI provider returned invalid JSON: {{detail}}",
        "ai_provider_content_missing": "AI provider response is missing message content: {{detail}}",
    },
    "ru": {
        "ai_endpoint_invalid": "Некорректный AI endpoint: {{detail}}",
        "ai_endpoint_scheme": "AI endpoint должен использовать http:// или https:// (получено: {{detail}})",
        "ai_remote_http_forbidden": "Удалённый AI endpoint обязан использовать HTTPS. Обычный HTTP разрешён только для localhost.",
        "ai_messages_empty": "AI-запрос не содержит сообщений",
        "ai_messages_too_many": "В AI-запросе слишком много сообщений: {{detail}}",
        "ai_message_too_large": "AI-сообщение превышает безопасный лимит размера ({{detail}} байт)",
        "ai_client_create_failed": "Не удалось создать AI HTTP client: {{detail}}",
        "ai_provider_unavailable": "AI provider недоступен: {{detail}}",
        "ai_response_read_failed": "Не удалось прочитать ответ AI provider: {{detail}}",
        "ai_provider_http": "AI provider вернул HTTP-ошибку: {{detail}}",
        "ai_provider_invalid_json": "AI provider вернул некорректный JSON: {{detail}}",
        "ai_provider_content_missing": "В ответе AI provider отсутствует содержимое сообщения: {{detail}}",
    },
}
for locale in ("en", "ru"):
    locale_path = Path(f"src/i18n/locales/automation.{locale}.json")
    data = json.loads(locale_path.read_text(encoding="utf-8"))
    data["errors"].update(error_text[locale])
    locale_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# Version bump for the feature candidate. Stable README badges remain on the
# released 0.4.1 until the branch is manually accepted and released.
path = Path("package.json")
data = json.loads(path.read_text(encoding="utf-8"))
data["version"] = "0.5.0"
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

path = Path("src-tauri/tauri.conf.json")
data = json.loads(path.read_text(encoding="utf-8"))
data["version"] = "0.5.0"
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

path = Path("src-tauri/Cargo.toml")
text = path.read_text(encoding="utf-8")
text = text.replace('version = "0.4.1"', 'version = "0.5.0"', 1)
path.write_text(text, encoding="utf-8")

path = Path("src-tauri/Cargo.lock")
text = path.read_text(encoding="utf-8")
text = re.sub(
    r'(\[\[package\]\]\nname = "keymaster-pro"\nversion = ")0\.4\.1("\n)',
    r'\g<1>0.5.0\2',
    text,
    count=1,
)
path.write_text(text, encoding="utf-8")


en_block = r'''## Preview in PR #4: Automation Lab (0.5.0 candidate)

This branch adds the first production-hardened vertical slice for **AI Composer**, the local **MCP bridge**, and portable **keymaster-pack v1** bundles. It intentionally remains a draft until the Windows UI is manually exercised on the branch.

### AI Automation Composer

- OpenAI-compatible provider endpoint with a typed draft contract and explicit preview/install flow.
- The API key exists only in request/UI state: KeyMaster does **not** save it to the profile, config, store, or logs.
- Plain `http://` is accepted only for localhost providers; remote providers must use TLS (`https://`).
- Provider/network failures cross the Rust boundary as stable error codes and are rendered by the selected UI locale.
- Generated rules/macros are re-deserialized and validated by the Rust daemon against runtime profile types before any profile write.
- Every install creates a profile backup and a one-click **Undo install** receipt; stale Undo is blocked after a newer profile mutation.

### MCP bridge

KeyMaster exposes a local stdio MCP server through the installed executable:

- `KeyMaster-Pro.exe --mcp` — read-only profile/status reads plus rule validation.
- `KeyMaster-Pro.exe --mcp-write` — explicit opt-in for profile activation, macro execution and rule writes.

Claude Desktop / Claude Code local stdio example (use `--mcp` by default):

```json
{
  "mcpServers": {
    "keymaster": {
      "command": "C:\\Program Files\\KeyMaster-Pro\\KeyMaster-Pro.exe",
      "args": ["--mcp"]
    }
  }
}
```

For Claude Code the same object can live in project `.mcp.json` or be supplied through its MCP configuration options. Change the argument to `--mcp-write` only when write/execute access is deliberately required.

**ChatGPT scope:** this PR does not expose the local stdio process as a ChatGPT app/connector. OpenAI MCP integrations use a reachable **remote MCP server URL/service connector**, so remote HTTP transport, authentication, exposure and threat review are a separate task.

### `keymaster-pack` v1

- portable JSON envelope: `format: "keymaster-pack"`, `version: 1`;
- import limit: **2 MiB**, checked before and after file read/parsing;
- local inspection reports permissions and high-risk actions before install;
- imported macro/layer/folder/rule UUIDs are regenerated and internal references are rebound;
- dangling references, duplicate IDs, folder cycles, empty actions and malformed payloads are rejected;
- final acceptance is the same Rust automation validation/write boundary used by AI and MCP;
- install is backup-first and Undo-capable.

### Validation evidence

PR #4 Windows CI runs frontend unit tests, TypeScript/Vite, Rust check/tests and ESLint, then a separate real-process MCP smoke test. The smoke job builds `KeyMaster-Pro.exe`, launches a real daemon with isolated `%APPDATA%`, connects with the official `@modelcontextprotocol/client`, exercises both MCP modes, verifies all seven write-mode tools, disk persistence, physical backup, Undo/stale-Undo protection, and concurrent profile mutations.

**Not in this PR:** the second Hub layer (diff/conflict detector, signed catalog), marketplace/discovery, and remote MCP hosting for ChatGPT. Those remain separate work after this vertical slice passes manual Windows UI QA.

---

'''
path = Path("README.md")
text = path.read_text(encoding="utf-8")
if "## Preview in PR #4: Automation Lab" not in text:
    text = replace_once(text, "## Architecture\n", en_block + "## Architecture\n", "README Automation Lab section")
path.write_text(text, encoding="utf-8")


ru_block = r'''## Preview PR #4: Automation Lab (кандидат 0.5.0)

В этой ветке добавлен первый доведённый вертикальный срез **AI Composer**, локального **MCP bridge** и переносимых пакетов **keymaster-pack v1**. PR намеренно остаётся draft до ручной проверки Windows UI на ветке.

### AI Automation Composer

- OpenAI-compatible endpoint, типизированный draft и обязательный preview/install вместо прямого исполнения ответа модели.
- API key живёт только в поле UI и текущем запросе: KeyMaster **не сохраняет** его в профиль, config/store или логи.
- Обычный `http://` разрешён только для localhost-провайдеров; удалённый endpoint обязан использовать `https://`.
- Provider/network ошибки пересекают Rust boundary как стабильные коды и отображаются на выбранном языке UI.
- Правила и макросы повторно десериализуются и валидируются Rust-daemon по runtime-типам профиля непосредственно перед сохранением.
- Перед каждой установкой создаётся backup профиля; доступна кнопка **Undo install**, а устаревший Undo блокируется после более нового изменения профиля.

### MCP bridge

Локальный stdio MCP server запускается тем же установленным exe:

- `KeyMaster-Pro.exe --mcp` — read-only: чтение профилей/status и валидация правила.
- `KeyMaster-Pro.exe --mcp-write` — отдельный явный opt-in для активации профиля, запуска макроса и записи правила.

Пример локальной stdio-конфигурации для Claude Desktop / Claude Code (по умолчанию используйте `--mcp`):

```json
{
  "mcpServers": {
    "keymaster": {
      "command": "C:\\Program Files\\KeyMaster-Pro\\KeyMaster-Pro.exe",
      "args": ["--mcp"]
    }
  }
}
```

Для Claude Code тот же объект можно хранить в проектном `.mcp.json` либо передать через его MCP config options. Менять аргумент на `--mcp-write` следует только когда осознанно нужен write/execute доступ.

**Граница ChatGPT:** этот PR не пытается подключить локальный stdio-процесс как ChatGPT app/connector. MCP-интеграции OpenAI используют доступный **remote MCP server URL/service connector**, поэтому HTTP transport, аутентификация, внешний доступ и отдельный threat review — самостоятельная задача.

### `keymaster-pack` v1

- переносимый JSON envelope: `format: "keymaster-pack"`, `version: 1`;
- лимит импорта **2 MiB**, проверяемый до чтения файла и повторно после чтения/парсинга;
- локальный inspection показывает permissions и опасные действия до установки;
- UUID macro/layer/folder/rule при импорте генерируются заново, внутренние ссылки перепривязываются;
- dangling references, duplicate IDs, folder cycles, пустые actions и повреждённый payload отклоняются;
- финальный допуск выполняет тот же Rust automation validation/write boundary, что используется AI и MCP;
- установка всегда backup-first и поддерживает Undo.

### Что реально проверяет CI

Windows CI PR #4 запускает frontend unit tests, TypeScript/Vite, Rust check/tests и ESLint, затем отдельный real-process MCP smoke. Smoke job собирает `KeyMaster-Pro.exe`, поднимает настоящий daemon с изолированным `%APPDATA%`, подключается официальным `@modelcontextprotocol/client`, проверяет оба MCP-режима, все семь tools write-режима, запись на диск, физический backup, Undo/stale-Undo protection и конкурентные изменения профиля.

**Не входит в этот PR:** второй слой Hub (diff/conflict detector, каталог с подписями), marketplace/discovery и remote MCP hosting для ChatGPT. К ним не переходим, пока этот вертикальный срез не пройдёт ручной Windows UI QA.

---

'''
path = Path("README.ru.md")
text = path.read_text(encoding="utf-8")
if "## Preview PR #4: Automation Lab" not in text:
    text = replace_once(text, "## Архитектура\n", ru_block + "## Архитектура\n", "README.ru Automation Lab section")
path.write_text(text, encoding="utf-8")


changelog = r'''## [Unreleased]

### Automation Lab / AI Composer

- Added the bilingual Automation Lab UI with provider-neutral OpenAI-compatible draft generation, permission inspection and explicit install.
- API keys remain request-only and are never persisted; remote plaintext HTTP is rejected while localhost HTTP remains available for local model servers.
- Added defensive TypeScript parsing for AI drafts/macro steps plus canonical Rust-side validation before profile writes.
- Provider/network failures now cross the Rust/TypeScript boundary as stable codes so EN/RU UI errors do not depend on backend prose.

### MCP bridge

- Added local stdio MCP modes: `--mcp` (read-only) and explicit `--mcp-write` (write/execute).
- Added seven MCP tools across profile reads, runtime status, rule validation, activation, macro execution and atomic rule installation.
- Routed MCP validation/writes through the same Rust automation boundary used by GUI installs instead of a parallel validator.
- Added a Windows real-process smoke test using the official `@modelcontextprotocol/client`, including legacy/modern initialization and both access modes.

### keymaster-pack v1 and write safety

- Added portable `keymaster-pack` v1 import/export with UUID regeneration and reference rebinding.
- Added 2 MiB import bounds, duplicate/dangling-reference/folder-cycle checks and permission/warning inspection.
- Serialized all profile mutations across Named Pipe clients to eliminate GUI/MCP read-modify-write loss.
- Added mandatory backup receipts, one-click Undo install and stale-Undo protection.
- Undo receipt now survives Automation Lab navigation for the lifetime of the app process.
- Daemon normalizes incoming rule/folder ordering inside the serialized write transaction instead of trusting frontend order values.

### Validation and localization

- Added Vitest coverage for draft/pack validation, real EN/RU language switching and AI bridge error decoding.
- CI runs frontend tests, TypeScript/Vite, Rust check/tests, ESLint and a separate Windows MCP/safety smoke job.
- Version advanced to 0.5.0 for this feature candidate; PR remains draft until manual Windows UI QA is complete.

---
'''
path = Path("CHANGELOG.md")
text = path.read_text(encoding="utf-8")
text = re.sub(r"## \[Unreleased\]\n.*?\n---\n", changelog, text, count=1, flags=re.S)
path.write_text(text, encoding="utf-8")

print("PR4 finalization patch applied")
