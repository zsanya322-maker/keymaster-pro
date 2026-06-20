import { create } from 'zustand';

export type Category = 'rules' | 'layers' | 'settings';

interface KeyMapStore {
  activeCategory: Category;
  setActiveCategory: (cat: Category) => void;
}

export const useKeyMasterStore = create<KeyMapStore>((set) => ({
  activeCategory: 'rules',
  setActiveCategory: (cat) => set({ activeCategory: cat }),
}));
