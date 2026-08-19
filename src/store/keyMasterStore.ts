import { create } from 'zustand'
import type { AutomationInstallReceipt } from '../lib/automationInstall'

export type Category = 'rules' | 'layers' | 'macros' | 'automation' | 'settings'

interface KeyMapStore {
  activeCategory: Category
  setActiveCategory: (cat: Category) => void
  rulesDirty: boolean
  setRulesDirty: (dirty: boolean) => void
  lastAutomationInstall: AutomationInstallReceipt | null
  setLastAutomationInstall: (receipt: AutomationInstallReceipt | null) => void
}

export const useKeyMasterStore = create<KeyMapStore>((set) => ({
  activeCategory: 'rules',
  setActiveCategory: (cat) => set({ activeCategory: cat }),
  rulesDirty: false,
  setRulesDirty: (dirty) => set({ rulesDirty: dirty }),
  lastAutomationInstall: null,
  setLastAutomationInstall: (receipt) => set({ lastAutomationInstall: receipt }),
}))
