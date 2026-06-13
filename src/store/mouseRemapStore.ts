import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { triggerToast } from '../lib/toast';

export interface MouseRemapRule {
  id: string;
  profileId: string;
  originalButton: string;
  mappedAction: string;
  layerId?: string;
}

interface MouseRemapState {
  rules: MouseRemapRule[];
  addRule: (rule: MouseRemapRule) => void;
  updateRule: (id: string, updates: Partial<MouseRemapRule>) => void;
  deleteRule: (id: string) => void;
  loadRules: (profileId: string) => Promise<void>;
}

const MOCK_RULES: MouseRemapRule[] = [
  { id: '1', profileId: '1', originalButton: 'XButton 1 (Back)', mappedAction: 'Copy (Ctrl+C)' },
  { id: '2', profileId: '1', originalButton: 'XButton 2 (Forward)', mappedAction: 'Paste (Ctrl+V)' },
];

export const useMouseRemapStore = create<MouseRemapState>((set) => ({
  rules: MOCK_RULES,
  addRule: async (rule) => {
    set((state) => ({ rules: [...state.rules, rule] }));
    try {
      await invoke('ipc_call', { method: 'remap.mouse.add', params: rule });
    } catch (e) {
      triggerToast('Failed to add mouse remap rule to Daemon', 'error');
    }
  },
  updateRule: async (id, updates) => {
    set((state) => ({
      rules: state.rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }));
    const rule = useMouseRemapStore.getState().rules.find((r) => r.id === id);
    if (rule) {
      try {
        await invoke('ipc_call', { method: 'remap.mouse.add', params: rule });
      } catch (e) {
        triggerToast('Failed to update mouse remap rule via IPC', 'error');
      }
    }
  },
  deleteRule: async (id) => {
    set((state) => ({ rules: state.rules.filter((r) => r.id !== id) }));
    try {
      await invoke('ipc_call', { method: 'remap.mouse.remove', params: { id } });
    } catch (e) {
      triggerToast('Failed to delete mouse remap rule from Daemon', 'error');
    }
  },
  loadRules: async (profileId) => {
    try {
      const res: any = await invoke('ipc_call', { method: 'remap.mouse.list', params: { profileId } });
      if (res && res.rules) set({ rules: res.rules });
    } catch (e) {
      // Quiet offline fallback
    }
  },
}));