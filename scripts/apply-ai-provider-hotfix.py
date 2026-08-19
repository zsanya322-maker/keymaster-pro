from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)

# 1) Windows Credential Manager feature.
p = Path('src-tauri/Cargo.toml')
s = p.read_text(encoding='utf-8')
if '"Win32_Security_Credentials"' not in s:
    s = replace_once(s, '  "Win32_Security",\n', '  "Win32_Security",\n  "Win32_Security_Credentials",\n', 'windows credential feature')
s = s.replace('version = "0.5.0"', 'version = "0.5.1"', 1)
p.write_text(s, encoding='utf-8')

# Cargo.lock local package version.
p = Path('src-tauri/Cargo.lock')
s = p.read_text(encoding='utf-8')
needle = 'name = "keymaster-pro"\nversion = "0.5.0"'
if needle in s:
    s = s.replace(needle, 'name = "keymaster-pro"\nversion = "0.5.1"', 1)
p.write_text(s, encoding='utf-8')

# 2) Persist provider metadata in AppConfig, never the secret.
p = Path('src-tauri/src/shared/types.rs')
s = p.read_text(encoding='utf-8')
if 'pub struct AiProviderProfile' not in s:
    marker = '#[derive(Debug, Clone, Serialize, Deserialize)]\n#[serde(rename_all = "camelCase", default)]\npub struct AppConfig {'
    replacement = '''#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderProfile {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {'''
    s = replace_once(s, marker, replacement, 'AiProviderProfile')
    s = replace_once(s, '    pub row_padding: u32,\n}', '    pub row_padding: u32,\n    pub ai_providers: Vec<AiProviderProfile>,\n    pub active_ai_provider_id: Option<String>,\n}', 'AppConfig fields')
    s = replace_once(s, '            row_padding: 8,\n', '            row_padding: 8,\n            ai_providers: Vec::new(),\n            active_ai_provider_id: None,\n', 'AppConfig defaults')
p.write_text(s, encoding='utf-8')

# 3) Secure secret commands using Windows Credential Manager.
p = Path('src-tauri/src/gui/commands.rs')
s = p.read_text(encoding='utf-8')
if 'pub fn ai_secret_set' not in s:
    s += r'''

#[cfg(target_os = "windows")]
fn ai_secret_target(provider_id: &str) -> String {
    format!("KeyMaster-Pro/AI/{}", provider_id)
}

#[tauri::command]
pub fn ai_secret_set(provider_id: String, api_key: String) -> Result<(), String> {
    if provider_id.trim().is_empty() {
        return Err("AI provider id is empty".to_string());
    }
    if api_key.len() > 5120 {
        return Err("AI API key is too large".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Security::Credentials::{
            CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CredWriteW,
        };
        use windows::core::PWSTR;

        let mut target: Vec<u16> = ai_secret_target(&provider_id)
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut username: Vec<u16> = "KeyMaster-Pro"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut blob = api_key.into_bytes();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            CredentialBlobSize: u32::try_from(blob.len())
                .map_err(|_| "AI API key is too large".to_string())?,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(username.as_mut_ptr()),
            ..Default::default()
        };

        let result = unsafe { CredWriteW(&credential, 0) }
            .map_err(|error| format!("Windows Credential Manager write failed: {error}"));
        blob.fill(0);
        result?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (provider_id, api_key);
        Err("Secure AI secret storage is currently available on Windows only".to_string())
    }
}

#[tauri::command]
pub fn ai_secret_get(provider_id: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;
        use windows::Win32::Security::Credentials::{
            CREDENTIALW, CRED_TYPE_GENERIC, CredFree, CredReadW,
        };
        use windows::core::HSTRING;

        let target = HSTRING::from(ai_secret_target(&provider_id));
        let mut credential_ptr: *mut CREDENTIALW = std::ptr::null_mut();
        match unsafe { CredReadW(&target, CRED_TYPE_GENERIC, None, &mut credential_ptr) } {
            Ok(()) => {
                if credential_ptr.is_null() {
                    return Ok(None);
                }
                let credential = unsafe { &*credential_ptr };
                let bytes = unsafe {
                    std::slice::from_raw_parts(
                        credential.CredentialBlob,
                        credential.CredentialBlobSize as usize,
                    )
                };
                let value = String::from_utf8(bytes.to_vec())
                    .map_err(|_| "Stored AI API key is not valid UTF-8".to_string());
                unsafe { CredFree(credential_ptr as *const c_void) };
                value.map(Some)
            }
            Err(error) => {
                // HRESULT_FROM_WIN32(ERROR_NOT_FOUND)
                if error.code().0 as u32 == 0x80070490 {
                    Ok(None)
                } else {
                    Err(format!("Windows Credential Manager read failed: {error}"))
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = provider_id;
        Err("Secure AI secret storage is currently available on Windows only".to_string())
    }
}

#[tauri::command]
pub fn ai_secret_delete(provider_id: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredDeleteW};
        use windows::core::HSTRING;

        let target = HSTRING::from(ai_secret_target(&provider_id));
        match unsafe { CredDeleteW(&target, CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(error) if error.code().0 as u32 == 0x80070490 => Ok(()),
            Err(error) => Err(format!("Windows Credential Manager delete failed: {error}")),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = provider_id;
        Err("Secure AI secret storage is currently available on Windows only".to_string())
    }
}
'''
p.write_text(s, encoding='utf-8')

# Register commands.
p = Path('src-tauri/src/lib.rs')
s = p.read_text(encoding='utf-8')
anchor = '            gui::ai::ai_chat_completion,\n'
if 'gui::commands::ai_secret_set' not in s:
    s = replace_once(
        s,
        anchor,
        anchor + '            gui::commands::ai_secret_set,\n            gui::commands::ai_secret_get,\n            gui::commands::ai_secret_delete,\n',
        'register AI secret commands',
    )
p.write_text(s, encoding='utf-8')

# 4) Frontend AppConfig mirrors provider metadata.
p = Path('src/lib/types.ts')
s = p.read_text(encoding='utf-8')
if 'export interface AiProviderProfile' not in s:
    marker = 'export interface AppConfig {'
    s = replace_once(
        s,
        marker,
        '''export interface AiProviderProfile {
  id: string
  name: string
  endpoint: string
  model: string
}

export interface AppConfig {''',
        'frontend provider type',
    )
    s = replace_once(
        s,
        '  onboardingComplete?: boolean\n}',
        '  onboardingComplete?: boolean\n  aiProviders: AiProviderProfile[]\n  activeAiProviderId: string | null\n}',
        'frontend AppConfig provider fields',
    )
p.write_text(s, encoding='utf-8')

p = Path('src/store/appStore.ts')
s = p.read_text(encoding='utf-8')
if 'aiProviders:' not in s:
    s = replace_once(
        s,
        '  tapHoldTimeoutMs: 200,\n}',
        '  tapHoldTimeoutMs: 200,\n  aiProviders: [],\n  activeAiProviderId: null,\n}',
        'app store provider defaults',
    )
p.write_text(s, encoding='utf-8')

# 5) Automation Lab volatile session persists across navigation.
p = Path('src/store/keyMasterStore.ts')
s = p.read_text(encoding='utf-8')
if 'AutomationLabSession' not in s:
    s = replace_once(
        s,
        "import type { AutomationInstallReceipt } from '../lib/automationInstall'\n",
        "import type { AutomationInstallReceipt } from '../lib/automationInstall'\nimport type { AiAutomationDraft, MaterializedAutomation } from '../lib/innovation'\n",
        'store imports',
    )
    s = replace_once(
        s,
        "export type Category = 'rules' | 'layers' | 'macros' | 'automation' | 'settings'\n",
        "export type Category = 'rules' | 'layers' | 'macros' | 'automation' | 'settings'\n\nexport interface AutomationLabSession {\n  tab: 'ai' | 'mcp' | 'hub'\n  prompt: string\n  draft: AiAutomationDraft | null\n  materialized: MaterializedAutomation | null\n  draftProfileId: string | null\n}\n",
        'session interface',
    )
    s = replace_once(
        s,
        '  setLastAutomationInstall: (receipt: AutomationInstallReceipt | null) => void\n',
        '  setLastAutomationInstall: (receipt: AutomationInstallReceipt | null) => void\n  automationLabSession: AutomationLabSession\n  setAutomationLabSession: (patch: Partial<AutomationLabSession>) => void\n',
        'session store fields',
    )
    s = replace_once(
        s,
        '  setLastAutomationInstall: (receipt) => set({ lastAutomationInstall: receipt }),\n',
        "  setLastAutomationInstall: (receipt) => set({ lastAutomationInstall: receipt }),\n  automationLabSession: { tab: 'ai', prompt: '', draft: null, materialized: null, draftProfileId: null },\n  setAutomationLabSession: (patch) => set((state) => ({ automationLabSession: { ...state.automationLabSession, ...patch } })),\n",
        'session store defaults',
    )
p.write_text(s, encoding='utf-8')

# 6) AI Provider Profiles settings UI.
p = Path('src/pages/SettingsPage.tsx')
s = p.read_text(encoding='utf-8')
if 'function AIProviderSettings()' not in s:
    marker = 'export function SettingsPage() {'
    component = r'''function AIProviderSettings() {
  const { t } = useTranslation();
  const { config, setConfig } = useAppStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('Groq');
  const [endpoint, setEndpoint] = useState('https://api.groq.com/openai/v1');
  const [model, setModel] = useState('openai/gpt-oss-20b');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setName('Groq');
    setEndpoint('https://api.groq.com/openai/v1');
    setModel('openai/gpt-oss-20b');
    setApiKey('');
  };

  const editProvider = (id: string) => {
    const provider = config.aiProviders.find((item) => item.id === id);
    if (!provider) return;
    setEditingId(id);
    setName(provider.name);
    setEndpoint(provider.endpoint);
    setModel(provider.model);
    setApiKey('');
  };

  const saveProvider = async () => {
    const cleanName = name.trim();
    const cleanEndpoint = endpoint.trim();
    const cleanModel = model.trim();
    if (!cleanName || !cleanEndpoint || !cleanModel || busy) return;
    setBusy(true);
    try {
      const id = editingId ?? crypto.randomUUID();
      if (apiKey.trim()) {
        await invoke('ai_secret_set', { providerId: id, apiKey: apiKey.trim() });
      }
      const nextProvider = { id, name: cleanName, endpoint: cleanEndpoint, model: cleanModel };
      const aiProviders = [...config.aiProviders.filter((item) => item.id !== id), nextProvider];
      setConfig({ aiProviders, activeAiProviderId: config.activeAiProviderId ?? id });
      setEditingId(id);
      setApiKey('');
      triggerToast(t('settings.ai_profiles.saved'), 'success');
    } catch (error) {
      triggerToast(t('settings.ai_profiles.save_failed', { error: String(error) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteProvider = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke('ai_secret_delete', { providerId: id });
      const aiProviders = config.aiProviders.filter((item) => item.id !== id);
      setConfig({
        aiProviders,
        activeAiProviderId: config.activeAiProviderId === id ? (aiProviders[0]?.id ?? null) : config.activeAiProviderId,
      });
      resetForm();
      triggerToast(t('settings.ai_profiles.deleted'), 'success');
    } catch (error) {
      triggerToast(t('settings.ai_profiles.delete_failed', { error: String(error) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('settings.ai_profiles.title')}>
      <SettingRow title={t('settings.ai_profiles.saved_profiles')} description={t('settings.ai_profiles.security')} stacked>
        <div className="space-y-2">
          {config.aiProviders.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {config.aiProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => editProvider(provider.id)}
                  className={`h-7 px-2 border text-[10px] ${config.activeAiProviderId === provider.id ? 'border-app-primary bg-app-primary/10 text-app-primary' : 'border-app-border bg-app-surface text-app-text'}`}
                >
                  {provider.name}{config.activeAiProviderId === provider.id ? ` · ${t('settings.ai_profiles.active')}` : ''}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-app-muted">{t('settings.ai_profiles.empty')}</div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('settings.ai_profiles.name')} className="h-8 border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary" />
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('settings.ai_profiles.model')} className="h-8 border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary" />
          </div>
          <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={t('settings.ai_profiles.endpoint')} className="h-8 w-full border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary" />
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={editingId ? t('settings.ai_profiles.key_keep') : t('settings.ai_profiles.key')} className="h-8 w-full border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary" />

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void saveProvider()} className="h-8 px-3 border border-app-primary bg-app-primary text-[10px] font-medium text-white disabled:opacity-50">
              {editingId ? t('settings.ai_profiles.save') : t('settings.ai_profiles.add')}
            </button>
            {editingId && (
              <button type="button" disabled={busy} onClick={() => setConfig({ activeAiProviderId: editingId })} className="h-8 px-3 border border-app-border bg-app-surface text-[10px] text-app-text disabled:opacity-50">
                {t('settings.ai_profiles.make_active')}
              </button>
            )}
            {editingId && (
              <button type="button" disabled={busy} onClick={() => void deleteProvider(editingId)} className="h-8 px-3 border border-app-danger/50 bg-app-danger/10 text-[10px] text-app-danger disabled:opacity-50">
                {t('settings.ai_profiles.delete')}
              </button>
            )}
            <button type="button" disabled={busy} onClick={resetForm} className="h-8 px-3 border border-app-border bg-app-surface text-[10px] text-app-text disabled:opacity-50">
              {t('settings.ai_profiles.new')}
            </button>
          </div>
        </div>
      </SettingRow>
    </Section>
  );
}

'''
    s = replace_once(s, marker, component + marker, 'AI Provider Settings component')
    general_anchor = '              <Section title={t(\'settings.profile_automation\', { defaultValue: \'Профили и автопереключение\' })}><ProfileAutomationPanel /></Section>\n'
    s = replace_once(s, general_anchor, general_anchor + '\n              <AIProviderSettings />\n', 'AI Settings section placement')
p.write_text(s, encoding='utf-8')

# Settings translations.
settings_strings = {
    'ru': {
        'title': 'AI Composer · провайдеры',
        'saved_profiles': 'Профили AI',
        'security': 'Название, endpoint и модель сохраняются в KeyMaster. API key хранится локально в Windows Credential Manager.',
        'empty': 'Пока нет сохранённых AI-профилей.',
        'active': 'активный',
        'name': 'Название, например Groq',
        'endpoint': 'Endpoint, например https://api.groq.com/openai/v1',
        'model': 'Модель, например openai/gpt-oss-20b',
        'key': 'API key',
        'key_keep': 'Новый API key — оставьте пустым, чтобы сохранить текущий',
        'add': 'Добавить профиль',
        'save': 'Сохранить',
        'make_active': 'Сделать активным',
        'delete': 'Удалить',
        'new': 'Новый профиль',
        'saved': 'AI-профиль сохранён',
        'deleted': 'AI-профиль удалён',
        'save_failed': 'Не удалось сохранить AI-профиль: {{error}}',
        'delete_failed': 'Не удалось удалить AI-профиль: {{error}}',
    },
    'en': {
        'title': 'AI Composer · providers',
        'saved_profiles': 'AI profiles',
        'security': 'Name, endpoint, and model are saved by KeyMaster. API keys are stored locally in Windows Credential Manager.',
        'empty': 'No saved AI profiles yet.',
        'active': 'active',
        'name': 'Name, e.g. Groq',
        'endpoint': 'Endpoint, e.g. https://api.groq.com/openai/v1',
        'model': 'Model, e.g. openai/gpt-oss-20b',
        'key': 'API key',
        'key_keep': 'New API key — leave blank to keep the stored key',
        'add': 'Add profile',
        'save': 'Save',
        'make_active': 'Make active',
        'delete': 'Delete',
        'new': 'New profile',
        'saved': 'AI profile saved',
        'deleted': 'AI profile deleted',
        'save_failed': 'Could not save AI profile: {{error}}',
        'delete_failed': 'Could not delete AI profile: {{error}}',
    },
}
for lang, values in settings_strings.items():
    p = Path(f'src/i18n/locales/{lang}.json')
    data = json.loads(p.read_text(encoding='utf-8'))
    data.setdefault('settings', {})['ai_profiles'] = values
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# 7) Automation Lab uses saved provider and keeps draft/prompt between categories.
p = Path('src/pages/AutomationLabPage.tsx')
s = p.read_text(encoding='utf-8')
if "../store/appStore" not in s:
    s = replace_once(s, "import { useKeyMasterStore } from '../store/keyMasterStore'\n", "import { useKeyMasterStore } from '../store/keyMasterStore'\nimport { useAppStore } from '../store/appStore'\n", 'Automation Lab app store import')
old_state = """  const [tab, setTab] = useState<LabTab>('ai')

  const [endpoint, setEndpoint] = useState('http://127.0.0.1:11434/v1')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [draft, setDraft] = useState<AiAutomationDraft | null>(null)
  const [materialized, setMaterialized] = useState<MaterializedAutomation | null>(null)
  const [draftProfileId, setDraftProfileId] = useState<string | null>(null)
"""
new_state = """  const { config, setConfig } = useAppStore()
  const {
    automationLabSession,
    setAutomationLabSession,
    setActiveCategory,
  } = useKeyMasterStore()
  const { tab, prompt, draft, materialized, draftProfileId } = automationLabSession
  const setTab = (next: LabTab) => setAutomationLabSession({ tab: next })
  const setPrompt = (next: string) => setAutomationLabSession({ prompt: next })
  const setDraft = (next: AiAutomationDraft | null) => setAutomationLabSession({ draft: next })
  const setMaterialized = (next: MaterializedAutomation | null) => setAutomationLabSession({ materialized: next })
  const setDraftProfileId = (next: string | null) => setAutomationLabSession({ draftProfileId: next })
  const [aiBusy, setAiBusy] = useState(false)
  const activeProvider = config.aiProviders.find((provider) => provider.id === config.activeAiProviderId) ?? config.aiProviders[0] ?? null
"""
s = replace_once(s, old_state, new_state, 'Automation Lab persistent state')
old_call = """      const nextDraft = await requestAutomationDraft(
        { endpoint, model, apiKey },
        activeProfile,
        prompt,
      )
"""
new_call = """      if (!activeProvider) automationError('ai_provider_missing')
      const apiKey = (await invoke<string | null>('ai_secret_get', { providerId: activeProvider.id })) ?? ''
      const nextDraft = await requestAutomationDraft(
        { endpoint: activeProvider.endpoint, model: activeProvider.model, apiKey },
        activeProfile,
        prompt,
      )
"""
s = replace_once(s, old_call, new_call, 'Automation Lab saved provider call')
# Redirect only after confirmed install.
s = replace_once(s, '      setDraftProfileId(null)\n    } catch (error) {', "      setDraftProfileId(null)\n      setActiveCategory('rules')\n    } catch (error) {", 'redirect after AI install')
old_provider_ui = '''                <div className="grid grid-cols-[1.5fr_1fr] gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.ai.endpoint')}</span>
                    <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} className={`${inputClass} w-full`} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.ai.model')}</span>
                    <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('automation.ai.model_placeholder')} className={`${inputClass} w-full`} />
                  </label>
                </div>
                <label className="space-y-1 block">
                  <span className="text-[9px] text-app-muted">{t('automation.ai.api_key')}</span>
                  <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t('automation.ai.api_key_placeholder')} className={`${inputClass} w-full`} />
                </label>
'''
new_provider_ui = '''                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.ai.provider')}</span>
                    <select
                      value={activeProvider?.id ?? ''}
                      onChange={(event) => setConfig({ activeAiProviderId: event.target.value || null })}
                      className={`${inputClass} w-full`}
                    >
                      {config.aiProviders.length === 0 && <option value="">{t('automation.ai.no_provider')}</option>}
                      {config.aiProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                    </select>
                  </label>
                  <div className="space-y-1">
                    <span className="text-[9px] text-app-muted">{t('automation.ai.model')}</span>
                    <div className={`${inputClass} w-full flex items-center`}>{activeProvider?.model ?? '—'}</div>
                  </div>
                </div>
                {activeProvider && <div className="text-[9px] text-app-muted select-text">{activeProvider.endpoint}</div>}
                <div className="text-[9px] text-app-muted">{t('automation.ai.provider_hint')}</div>
'''
s = replace_once(s, old_provider_ui, new_provider_ui, 'Automation Lab provider selector')
s = s.replace('disabled={!activeProfile || aiBusy || !prompt.trim() || !model.trim()}', 'disabled={!activeProfile || !activeProvider || aiBusy || !prompt.trim()}')
s = s.replace("<span className=\"ml-auto text-[9px] text-app-muted\">{t('automation.ai.draft_counts', { rules: materialized.rules.length, macros: materialized.macros.length })}</span>", "<span className=\"ml-auto text-[9px] font-semibold text-app-warning\">{t('automation.ai.not_installed')}</span>")
s = s.replace("{t('automation.ai.install')}", "{t('automation.ai.install_count', { rules: materialized.rules.length })}", 1)
p.write_text(s, encoding='utf-8')

# AI error and Automation Lab translations.
p = Path('src/lib/automationErrors.ts')
s = p.read_text(encoding='utf-8')
if "'ai_provider_missing'" not in s:
    s = replace_once(s, "  | 'ai_model_missing'\n", "  | 'ai_model_missing'\n  | 'ai_provider_missing'\n", 'AI provider missing error')
p.write_text(s, encoding='utf-8')

automation_strings = {
    'ru': {
        'provider': 'AI-профиль',
        'no_provider': 'Сначала добавьте AI-профиль в Настройках',
        'provider_hint': 'Endpoint, модель и ключ берутся из сохранённого AI-профиля. Ключ хранится локально в Windows Credential Manager.',
        'not_installed': 'ЧЕРНОВИК · ещё не установлен',
        'install_count': 'Установить {{rules}} правил',
    },
    'en': {
        'provider': 'AI profile',
        'no_provider': 'Add an AI profile in Settings first',
        'provider_hint': 'Endpoint, model, and key come from the saved AI profile. The key is stored locally in Windows Credential Manager.',
        'not_installed': 'DRAFT · not installed yet',
        'install_count': 'Install {{rules}} rules',
    },
}
error_text = {
    'ru': 'AI-провайдер не настроен. Добавьте профиль в Настройках.',
    'en': 'No AI provider is configured. Add one in Settings.',
}
for lang in ['ru', 'en']:
    p = Path(f'src/i18n/locales/automation.{lang}.json')
    data = json.loads(p.read_text(encoding='utf-8'))
    data.setdefault('ai', {}).update(automation_strings[lang])
    data.setdefault('errors', {})['ai_provider_missing'] = error_text[lang]
    # Correct now-stale wording about API key storage.
    if lang == 'ru':
        data['ai']['api_key'] = 'API key · хранится локально в Windows Credential Manager'
    else:
        data['ai']['api_key'] = 'API key · stored locally in Windows Credential Manager'
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# 8) Version metadata and changelog.
p = Path('package.json')
s = p.read_text(encoding='utf-8').replace('"version": "0.5.0"', '"version": "0.5.1"', 1)
p.write_text(s, encoding='utf-8')
p = Path('src-tauri/tauri.conf.json')
s = p.read_text(encoding='utf-8').replace('"version": "0.5.0"', '"version": "0.5.1"', 1)
p.write_text(s, encoding='utf-8')
p = Path('CHANGELOG.md')
s = p.read_text(encoding='utf-8')
if 'AI Provider Profiles' not in s:
    s = replace_once(
        s,
        '## [Unreleased]\n',
        '''## [Unreleased]

### Fixed
- **AI Provider Profiles:** save provider name/endpoint/model in KeyMaster settings and store API keys locally in Windows Credential Manager instead of asking on every visit.
- Automation Lab keeps the current prompt and generated draft while navigating between application sections.
- Generated automations are explicitly marked as drafts until installation is confirmed; successful install immediately opens Rules so the new rules are visible.
''',
        'changelog hotfix',
    )
p.write_text(s, encoding='utf-8')

# README wording must match the new security model.
for filename in ['README.md', 'README.ru.md']:
    p = Path(filename)
    s = p.read_text(encoding='utf-8')
    s = s.replace('API key is request-only and is not persisted', 'API provider metadata is saved locally; API keys are stored in Windows Credential Manager')
    s = s.replace('API key не сохраняется', 'API-профиль сохраняется локально; API key хранится в Windows Credential Manager')
    s = s.replace('API key request/UI-only not saved', 'AI provider metadata saved locally; API key stored in Windows Credential Manager')
    p.write_text(s, encoding='utf-8')
