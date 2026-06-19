import { create } from 'zustand';

export type Category = 'rules' | 'layers' | 'settings';

interface KeyMapStore {
  activeCategory: Category;
  selectedProfileId: string;
  daemonActive: boolean;
  setActiveCategory: (cat: Category) => void;
  setSelectedProfileId: (id: string) => void;
  toggleDaemon: () => void;
}

export const useKeyMasterStore = create<KeyMapStore>((set) => ({
  activeCategory: 'rules',
  selectedProfileId: 'default',
  daemonActive: true,
  setActiveCategory: (cat) => set({ activeCategory: cat }),
  setSelectedProfileId: (id) => set({ selectedProfileId: id }),
  toggleDaemon: () => set((state) => ({ daemonActive: !state.daemonActive })),
}));
