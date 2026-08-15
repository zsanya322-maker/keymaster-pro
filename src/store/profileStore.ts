import { create } from 'zustand'
import { invoke } from '../lib/ipc'
import type { Profile } from '../lib/types'

interface ProfileState {
  profiles: Profile[]
  activeProfileId: string | null

  loadProfiles: () => Promise<boolean>
  activateProfile: (id: string) => Promise<boolean>
  saveProfile: (profile: Profile) => Promise<boolean>
  createProfile: (profile: Partial<Profile>) => Promise<boolean>
  deleteProfile: (id: string) => Promise<boolean>
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,

  loadProfiles: async () => {
    try {
      const res = await invoke<{ profiles: Profile[], active: string }>('ipc_call', { method: 'profile.list' })
      set({
        profiles: res.profiles,
        activeProfileId: res.active,
      })
      return true
    } catch (error) {
      console.error('Failed to load profiles', error)
      return false
    }
  },

  activateProfile: async (id) => {
    try {
      await invoke('ipc_call', { method: 'profile.activate', params: { id } })
      set({ activeProfileId: id })
      return true
    } catch (error) {
      console.error('Failed to activate profile', error)
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
      console.error('Failed to save profile', error)
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
        rules: [],
        layers: [],
        ...partial,
      }
      await invoke('ipc_call', { method: 'profile.create', params: newProfile })
      return await get().loadProfiles()
    } catch (error) {
      console.error('Failed to create profile', error)
      return false
    }
  },

  deleteProfile: async (id) => {
    try {
      await invoke('ipc_call', { method: 'profile.delete', params: { id } })
      return await get().loadProfiles()
    } catch (error) {
      console.error('Failed to delete profile', error)
      return false
    }
  },
}))
