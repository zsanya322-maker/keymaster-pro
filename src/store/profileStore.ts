import { create } from 'zustand'
import { invoke } from '../lib/ipc'
import type { Profile } from '../lib/types'

interface ProfileState {
  profiles: Profile[]
  activeProfileId: string | null
  
  loadProfiles: () => Promise<void>
  activateProfile: (id: string) => Promise<void>
  saveProfile: (profile: Profile) => Promise<void>
  createProfile: (profile: Partial<Profile>) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,

  loadProfiles: async () => {
    try {
      const res = await invoke<{ profiles: Profile[], active: string }>('ipc_call', { method: 'profile.list' })
      set({ 
        profiles: res.profiles, 
        activeProfileId: res.active
      })
    } catch (e) {
      console.error('Failed to load profiles', e)
    }
  },

  activateProfile: async (id) => {
    try {
      await invoke('ipc_call', { method: 'profile.activate', params: { id } })
      set({ activeProfileId: id })
    } catch (e) {
      console.error('Failed to activate profile', e)
    }
  },

  saveProfile: async (profile) => {
    try {
      await invoke('ipc_call', { method: 'profile.save', params: profile })
      
      const { profiles } = get()
      const newProfiles = profiles.map(p => p.id === profile.id ? profile : p)
      
      set({ profiles: newProfiles })
    } catch (e) {
      console.error('Failed to save profile', e)
    }
  },

  createProfile: async (partial) => {
    try {
      const newProfile = {
        id: crypto.randomUUID(),
        name: 'New Profile',
        isDefault: false,
        linkedApps: [],
        rules: [],
        layers: [],
        ...partial
      }
      await invoke('ipc_call', { method: 'profile.create', params: newProfile })
      await get().loadProfiles()
    } catch (e) {
      console.error('Failed to create profile', e)
    }
  },

  deleteProfile: async (id) => {
    try {
      await invoke('ipc_call', { method: 'profile.delete', params: { id } })
      await get().loadProfiles()
    } catch (e) {
      console.error('Failed to delete profile', e)
    }
  }
}))