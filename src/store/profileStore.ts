import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { triggerToast } from '../lib/toast';

export interface Profile {
  id: string;
  name: string;
  isDefault: boolean;
  linkedApps: string[]; // Массив .exe файлов для авто-переключения
}

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
  addProfile: (profile: Profile) => void;
  updateProfile: (id: string, updates: Partial<Profile>) => void;
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;
  loadProfiles: () => Promise<void>;
}

// Временные мок-данные для UI
const MOCK_PROFILES: Profile[] = [
  { id: '1', name: 'Default (По умолчанию)', isDefault: true, linkedApps: [] },
  { id: '2', name: 'Gaming (Игры)', isDefault: false, linkedApps: ['cyberpunk.exe'] },
];

export const useProfileStore = create<ProfileState>((set) => ({
  profiles: MOCK_PROFILES,
  activeProfileId: '1',
  addProfile: async (profile) => {
    set((state) => ({ profiles: [...state.profiles, profile] }));
    try {
      await invoke('ipc_call', { method: 'profile.create', params: profile });
    } catch (e) {
      triggerToast('Failed to create profile in Daemon', 'error');
    }
  },
  updateProfile: async (id, updates) => {
    set((state) => ({
      profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
    try {
      await invoke('ipc_call', { method: 'profile.update', params: { id, ...updates } });
    } catch (e) {
      triggerToast('Failed to update profile in Daemon', 'error');
    }
  },
  deleteProfile: async (id) => {
    set((state) => ({ profiles: state.profiles.filter((p) => p.id !== id) }));
    try { await invoke('ipc_call', { method: 'profile.delete', params: { id } }); } catch (e) {}
  },
  setActiveProfile: async (id) => {
    set({ activeProfileId: id });
    try {
      await invoke('ipc_call', { method: 'profile.activate', params: { id } });
    } catch (e) {
      triggerToast('Failed to activate profile in Daemon', 'error');
    }
  },
  loadProfiles: async () => {
    try {
      const res: any = await invoke('ipc_call', { method: 'profile.list', params: {} });
      if (res && res.profiles) set({ profiles: res.profiles, activeProfileId: res.active });
    } catch (e) {
      // Quiet offline fallback
    }
  },
}));