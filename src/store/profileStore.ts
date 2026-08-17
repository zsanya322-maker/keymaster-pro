import { create } from 'zustand'
import { invoke } from '../lib/ipc'
import { triggerToast } from '../lib/toast'
import type { Profile } from '../lib/types'

interface ProfileState {
  profiles: Profile[]
  activeProfileId: string | null

  loadProfiles: () => Promise<boolean>
  activateProfile: (id: string) => Promise<boolean>
  saveProfile: (profile: Profile) => Promise<boolean>
  createProfile: (profile: Partial<Profile>) => Promise<boolean>
  deleteProfile: (id: string) => Promise<boolean>
  renameProfile: (id: string, name: string) => Promise<boolean>
  duplicateProfile: (id: string, name: string) => Promise<boolean>
  reorderProfiles: (ids: string[]) => Promise<boolean>
}

function mutationFailed(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${action}:`, error)
  triggerToast(`${action}: ${message}`, 'error')
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,

  loadProfiles: async () => {
    try {
      const res = await invoke<{ profiles: Profile[], active: string }>('ipc_call', { method: 'profile.list' })
      set({
        profiles: res.profiles.map(profile => ({ ...profile, bindings: profile.bindings ?? [], macros: profile.macros ?? [], order: profile.order ?? 0 })),
        activeProfileId: res.active,
      })
      return true
    } catch (error) {
      mutationFailed('Не удалось загрузить профили', error)
      return false
    }
  },

  activateProfile: async (id) => {
    try {
      await invoke('ipc_call', { method: 'profile.activate', params: { id } })
      set({ activeProfileId: id })
      return true
    } catch (error) {
      mutationFailed('Не удалось активировать профиль', error)
      return false
    }
  },

  saveProfile: async (profile) => {
    try {
      await invoke('ipc_call', { method: 'profile.save', params: profile })
      const { profiles } = get()
      set({ profiles: profiles.map(item => item.id === profile.id ? profile : item) })
      return true
    } catch (error) {
      mutationFailed(`Не удалось сохранить профиль “${profile.name}”`, error)
      return false
    }
  },

  createProfile: async (partial) => {
    try {
      const newProfile: Profile = {
        id: crypto.randomUUID(),
        name: 'New Profile',
        isDefault: false,
        linkedApps: [],
        bindings: [],
        order: 0,
        rules: [],
        macros: [],
        layers: [],
        folders: [],
        ...partial,
      }
      await invoke('ipc_call', { method: 'profile.create', params: newProfile })
      return await get().loadProfiles()
    } catch (error) {
      mutationFailed('Не удалось создать профиль', error)
      return false
    }
  },

  renameProfile: async (id, name) => {
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

  deleteProfile: async (id) => {
    const state = get()
    const profile = state.profiles.find(item => item.id === id)

    if (!profile) {
      triggerToast('Профиль для удаления не найден', 'error')
      return false
    }
    if (profile.isDefault) {
      triggerToast('Профиль по умолчанию нельзя удалить', 'warning')
      return false
    }
    if (state.activeProfileId === id) {
      triggerToast('Сначала переключитесь на другой профиль, затем удалите этот', 'warning')
      return false
    }

    try {
      await invoke('ipc_call', { method: 'profile.delete', params: { id } })
      return await get().loadProfiles()
    } catch (error) {
      mutationFailed('Не удалось удалить профиль', error)
      return false
    }
  },
}))
