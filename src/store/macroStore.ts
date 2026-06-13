import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type MacroActionType = 'key_down' | 'key_up' | 'mouse_click' | 'delay' | 'mouse_move';

export interface MacroStep {
  id: string;
  actionType: MacroActionType;
  value: string | number;
}

export interface Macro {
  id: string;
  profileId: string;
  name: string;
  triggerKey: string;
  steps: MacroStep[];
  targetApp?: string;
  triggerType?: 'single' | 'double_press' | 'long_press';
  triggerTime?: number;
  triggerLayout?: 'any' | 'en' | 'ru';
}

interface MacroState {
  macros: Macro[];
  addMacro: (macro: Macro) => void;
  deleteMacro: (id: string) => void;
  updateMacro: (id: string, updates: Partial<Macro>) => void;
  loadMacros: (profileId: string) => Promise<void>;
}

const MOCK_MACROS: Macro[] = [
  {
    id: '1', profileId: '1', name: 'Быстрое лечение (Heal Potion)', triggerKey: 'F5', steps: [
      { id: 's1', actionType: 'key_down', value: 'I' },
      { id: 's2', actionType: 'delay', value: 50 },
      { id: 's3', actionType: 'mouse_click', value: 'Left' },
      { id: 's4', actionType: 'delay', value: 50 },
      { id: 's5', actionType: 'key_up', value: 'I' },
    ]
  }
];

export const useMacroStore = create<MacroState>((set) => ({
  macros: MOCK_MACROS,
  addMacro: async (macro) => {
    set((state) => ({ macros: [...state.macros, macro] }));
    try { await invoke('ipc_call', { method: 'macro.create', params: macro }); } catch (e) {}
  },
  deleteMacro: async (id) => {
    set((state) => ({ macros: state.macros.filter((m) => m.id !== id) }));
    try { await invoke('ipc_call', { method: 'macro.delete', params: { id } }); } catch (e) {}
  },
  updateMacro: async (id, updates) => {
    set((state) => ({ macros: state.macros.map((m) => (m.id === id ? { ...m, ...updates } : m)) }));
    try { await invoke('ipc_call', { method: 'macro.update', params: { id, updates } }); } catch (e) {}
  },
  loadMacros: async (profileId) => {
    try {
      const res: any = await invoke('ipc_call', { method: 'macro.list', params: { profileId } });
      if (res && res.macros) set({ macros: res.macros });
    } catch (e) {
      // Quiet offline fallback
    }
  },
}));