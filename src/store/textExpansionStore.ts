import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { triggerToast } from '../lib/toast';

export interface TextExpansion {
  id: string;
  profileId: string;
  trigger: string;
  replacement: string;
  enabled: boolean;
}

interface TextExpansionState {
  expansions: TextExpansion[];
  addExpansion: (expansion: TextExpansion) => Promise<void>;
  deleteExpansion: (id: string) => Promise<void>;
  updateExpansion: (id: string, updates: Partial<TextExpansion>) => Promise<void>;
  loadExpansions: (profileId: string) => Promise<void>;
}

const MOCK_EXPANSIONS: TextExpansion[] = [
  { id: 'te_1', profileId: '1', trigger: '!email', replacement: 'user@example.com', enabled: true },
  { id: 'te_2', profileId: '1', trigger: '!shg', replacement: '¯\\_(ツ)_/¯', enabled: true },
];

export const useTextExpansionStore = create<TextExpansionState>((set) => ({
  expansions: MOCK_EXPANSIONS,
  addExpansion: async (expansion) => {
    set((state) => ({ expansions: [...state.expansions, expansion] }));
    try {
      await invoke('ipc_call', { method: 'text_expansion.create', params: expansion });
    } catch (e) {
      triggerToast('Failed to create text expansion in Daemon', 'error');
    }
  },
  deleteExpansion: async (id) => {
    set((state) => ({ expansions: state.expansions.filter((te) => te.id !== id) }));
    try {
      await invoke('ipc_call', { method: 'text_expansion.delete', params: { id } });
    } catch (e) {
      triggerToast('Failed to delete text expansion from Daemon', 'error');
    }
  },
  updateExpansion: async (id, updates) => {
    set((state) => ({
      expansions: state.expansions.map((te) => (te.id === id ? { ...te, ...updates } : te)),
    }));
    try {
      const expansions = useTextExpansionStore.getState().expansions;
      const te = expansions.find((t) => t.id === id);
      if (te) {
        await invoke('ipc_call', { method: 'text_expansion.update', params: te });
      }
    } catch (e) {
      triggerToast('Failed to update text expansion in Daemon', 'error');
    }
  },
  loadExpansions: async (profileId) => {
    try {
      const res: any = await invoke('ipc_call', { method: 'text_expansion.list', params: { profileId } });
      if (res && res.expansions) {
        set({ expansions: res.expansions });
      }
    } catch (e) {
      // Quiet offline fallback
    }
  },
}));
