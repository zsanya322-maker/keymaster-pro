import { create } from 'zustand'
import type { AutomationInstallReceipt } from '../lib/automationInstall'
import type { AiAutomationDraft, MaterializedAutomation } from '../lib/innovation'

export type Category = 'rules' | 'layers' | 'macros' | 'automation' | 'settings'

export interface AutomationLabSession {
  tab: 'ai' | 'mcp' | 'hub'
  prompt: string
  draft: AiAutomationDraft | null
  materialized: MaterializedAutomation | null
  draftProfileId: string | null
}

interface KeyMapStore {
  activeCategory: Category
  setActiveCategory: (cat: Category) => void
  rulesDirty: boolean
  setRulesDirty: (dirty: boolean) => void
  lastAutomationInstall: AutomationInstallReceipt | null
  setLastAutomationInstall: (receipt: AutomationInstallReceipt | null) => void
  automationLabSession: AutomationLabSession
  setAutomationLabSession: (patch: Partial<AutomationLabSession>) => void
}

export const useKeyMasterStore = create<KeyMapStore>((set) => ({
  activeCategory: 'rules',
  setActiveCategory: (cat) => set({ activeCategory: cat }),
  rulesDirty: false,
  setRulesDirty: (dirty) => set({ rulesDirty: dirty }),
  lastAutomationInstall: null,
  setLastAutomationInstall: (receipt) => set({ lastAutomationInstall: receipt }),
  automationLabSession: { tab: 'ai', prompt: '', draft: null, materialized: null, draftProfileId: null },
  setAutomationLabSession: (patch) => set((state) => ({ automationLabSession: { ...state.automationLabSession, ...patch } })),
}))
