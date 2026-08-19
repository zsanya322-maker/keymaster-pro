import { invoke } from './ipc'
import type { FrontendRule, LayerMeta, MacroDefinition, RuleFolder } from './types'

export interface AutomationAdditions {
  rules: FrontendRule[]
  macros: MacroDefinition[]
  layers: LayerMeta[]
  folders: RuleFolder[]
}

export interface AutomationInstallReceipt {
  profileId: string
  backupName: string
  postRevision: string
}

interface ValidateResponse {
  valid: boolean
}

interface UndoResponse {
  success: boolean
  profileId: string
  revision: string
}

export class AutomationUndoStaleError extends Error {
  constructor() {
    super('AUTOMATION_UNDO_STALE')
    this.name = 'AutomationUndoStaleError'
  }
}

export async function validateAutomationInstall(
  profileId: string,
  additions: AutomationAdditions,
): Promise<void> {
  const response = await invoke<ValidateResponse>('ipc_call', {
    method: 'automation.validate',
    params: { profileId, additions },
  })
  if (!response.valid) throw new Error('Automation validation was not confirmed by daemon')
}

export async function installAutomation(
  profileId: string,
  additions: AutomationAdditions,
): Promise<AutomationInstallReceipt> {
  await validateAutomationInstall(profileId, additions)
  return invoke<AutomationInstallReceipt>('ipc_call', {
    method: 'automation.install',
    params: { profileId, additions },
  })
}

export async function undoAutomationInstall(
  receipt: AutomationInstallReceipt,
): Promise<UndoResponse> {
  try {
    return await invoke<UndoResponse>('ipc_call', {
      method: 'automation.undo_install',
      params: {
        profileId: receipt.profileId,
        backupName: receipt.backupName,
        expectedRevision: receipt.postRevision,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('AUTOMATION_UNDO_STALE')) throw new AutomationUndoStaleError()
    throw error
  }
}
