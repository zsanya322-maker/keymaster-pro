import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { triggerToast } from '../lib/toast';

export interface RemapRule {
  id: string;
  profileId: string;
  originalKey: string;
  mappedKey: string;
  layerId?: string;
}

interface RemapState {
  rules: RemapRule[];
  addRule: (rule: RemapRule) => void;
  updateRule: (id: string, updates: Partial<RemapRule>) => void;
  deleteRule: (id: string) => void;
  loadRules: (profileId: string) => Promise<void>;
}

// Временные мок-данные
const MOCK_RULES: RemapRule[] = [
  { id: '1', profileId: '1', originalKey: 'Caps Lock', mappedKey: 'Escape' },
  { id: '2', profileId: '1', originalKey: 'F1', mappedKey: 'Mute' },
];

export const useRemapStore = create<RemapState>((set) => ({
  rules: MOCK_RULES,
  addRule: async (rule) => {
    set((state) => ({ rules: [...state.rules, rule] }));
    try {
      await invoke('ipc_call', { method: 'remap.add', params: rule });
    } catch (e) {
      triggerToast('Failed to add remap rule via IPC', 'error');
    }
  },
  updateRule: async (id, updates) => {
    set((state) => ({
      rules: state.rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }));
    const rule = useRemapStore.getState().rules.find((r) => r.id === id);
    if (rule) {
      try {
        await invoke('ipc_call', { method: 'remap.add', params: rule });
      } catch (e) {
        triggerToast('Failed to update remap rule via IPC', 'error');
      }
    }
  },
  deleteRule: async (id) => {
    set((state) => ({ rules: state.rules.filter((r) => r.id !== id) }));
    try {
      await invoke('ipc_call', { method: 'remap.remove', params: { id } });
    } catch (e) {
      triggerToast('Failed to delete remap rule via IPC', 'error');
    }
  },
  loadRules: async (profileId) => {
    try {
      const res: any = await invoke('ipc_call', { method: 'remap.list', params: { profileId } });
      if (res && res.rules) set({ rules: res.rules });
    } catch (e) {
      // Quiet offline fallback
    }
  },
}));