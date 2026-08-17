import { create } from 'zustand';

export type Category = 'rules' | 'layers' | 'macros' | 'settings';

interface KeyMapStore {
  activeCategory: Category;
  setActiveCategory: (cat: Category) => void;
  rulesDirty: boolean;
  setRulesDirty: (dirty: boolean) => void;
}

export const useKeyMasterStore = create<KeyMapStore>((set) => ({
  activeCategory: 'rules',
  setActiveCategory: (cat) => set({ activeCategory: cat }),
  rulesDirty: false,
  setRulesDirty: (dirty) => set({ rulesDirty: dirty }),
}));
