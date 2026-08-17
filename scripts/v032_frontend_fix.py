from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, text): (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected one match, got {text.count(old)}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))

# profileStore: transformed Profile now has structured fields and explicit helpers.
path = 'src/store/profileStore.ts'
text = read(path)
if 'renameProfile:' not in text:
    text = text.replace(
        '  deleteProfile: (id: string) => Promise<boolean>\n',
        '  deleteProfile: (id: string) => Promise<boolean>\n  renameProfile: (id: string, name: string) => Promise<boolean>\n  duplicateProfile: (id: string, name: string) => Promise<boolean>\n  reorderProfiles: (ids: string[]) => Promise<boolean>\n',
        1,
    )
if 'profiles: res.profiles.map' not in text:
    text = text.replace(
        '        profiles: res.profiles,\n',
        '        profiles: res.profiles.map(profile => ({ ...profile, bindings: profile.bindings ?? [], order: profile.order ?? 0 })),\n',
        1,
    )
if 'bindings: [],' not in text[text.find('const newProfile'):text.find('await invoke', text.find('const newProfile'))]:
    text = text.replace(
        '        linkedApps: [],\n        rules: [],\n',
        '        linkedApps: [],\n        bindings: [],\n        order: 0,\n        rules: [],\n',
        1,
    )
if 'renameProfile: async' not in text:
    anchor = '  deleteProfile: async (id) => {'
    helpers = '''  renameProfile: async (id, name) => {
    try {
      await invoke('ipc_call', { method: 'profile.rename', params: { id, name } })
      return await get().loadProfiles()
    } catch (error) {
      mutationFailed('Не удалось переименовать профиль', error)
      return false
    }
  },

  duplicateProfile: async (id, name) => {
    try {
      await invoke('ipc_call', { method: 'profile.duplicate', params: { id, newId: crypto.randomUUID(), name } })
      return await get().loadProfiles()
    } catch (error) {
      mutationFailed('Не удалось дублировать профиль', error)
      return false
    }
  },

  reorderProfiles: async (ids) => {
    try {
      await invoke('ipc_call', { method: 'profile.reorder', params: { ids } })
      return await get().loadProfiles()
    } catch (error) {
      mutationFailed('Не удалось изменить порядок профилей', error)
      return false
    }
  },

'''
    if anchor not in text:
        raise RuntimeError('profileStore deleteProfile anchor missing')
    text = text.replace(anchor, helpers + anchor, 1)
write(path, text)

# RulesPage condition formatter must cover the new discriminated-union member.
path = 'src/pages/RulesPage.tsx'
text = read(path)
if "case 'contextMatch':" not in text[text.find('function formatConditionLabel'):text.find('function formatActionLabel')]:
    anchor = "    case 'windowMatch': {\n"
    block = '''    case 'contextMatch': {
      const parts = [condition.process, condition.path, condition.title, condition.className, condition.virtualDesktopId, condition.monitorId].filter(Boolean)
      const geometry = [condition.minWidth, condition.maxWidth, condition.minHeight, condition.maxHeight].some(value => value !== undefined)
        ? `${condition.minWidth ?? '—'}..${condition.maxWidth ?? '—'} × ${condition.minHeight ?? '—'}..${condition.maxHeight ?? '—'}`
        : ''
      if (geometry) parts.push(geometry)
      if (condition.fullscreen !== undefined) parts.push(condition.fullscreen ? 'fullscreen' : 'windowed')
      return `Context (${condition.mode.toUpperCase()}): ${parts.length ? parts.join(' / ') : '—'}`
    }
'''
    if anchor not in text:
        raise RuntimeError('RulesPage windowMatch anchor missing')
    text = text.replace(anchor, block + anchor, 1)
write(path, text)

print('v0.3.2 frontend fixes applied')
