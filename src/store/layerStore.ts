import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Layer {
  id: string;
  profileId: string;
  name: string;
  priority: number;
  triggerType: 'hotkey' | 'process' | 'window_title' | 'none';
  triggerValue: string;
}

interface LayerState {
  layers: Layer[];
  addLayer: (layer: Layer) => void;
  deleteLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  loadLayers: (profileId: string) => Promise<void>;
}

const MOCK_LAYERS: Layer[] = [
  { id: '1', profileId: '1', name: 'Базовый слой', priority: 0, triggerType: 'none', triggerValue: '' },
  { id: '2', profileId: '1', name: 'Режим снайпера', priority: 10, triggerType: 'hotkey', triggerValue: 'LAlt' },
];

export const useLayerStore = create<LayerState>((set) => ({
  layers: MOCK_LAYERS,
  addLayer: async (layer) => {
    set((state) => ({ layers: [...state.layers, layer] }));
    try { await invoke('ipc_call', { method: 'layer.create', params: layer }); } catch (e) {}
  },
  deleteLayer: async (id) => {
    set((state) => ({ layers: state.layers.filter((l) => l.id !== id) }));
    try { await invoke('ipc_call', { method: 'layer.delete', params: { id } }); } catch (e) {}
  },
  updateLayer: async (id, updates) => {
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    }));
    try { await invoke('ipc_call', { method: 'layer.update', params: { id, updates } }); } catch (e) {}
  },
  loadLayers: async (profileId) => {
    try {
      const res: any = await invoke('ipc_call', { method: 'layer.list', params: { profileId } });
      if (res && res.layers) {
        set({ layers: res.layers });
      }
    } catch (e) {
      // Quiet offline fallback
    }
  },
}));