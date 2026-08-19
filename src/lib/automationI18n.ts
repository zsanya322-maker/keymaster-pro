import type { TFunction } from 'i18next'
import { isAutomationError } from './automationErrors'
import type { AutomationWarning } from './innovation'

export function automationErrorMessage(t: TFunction, error: unknown): string {
  if (isAutomationError(error)) {
    return t(`automation.errors.${error.code}`, error.details)
  }
  return error instanceof Error ? error.message : String(error)
}

export function automationWarningMessage(t: TFunction, warning: AutomationWarning): string {
  if (warning.code === 'launch_app') {
    return t('automation.warnings.launch_app', { ruleName: warning.ruleName, path: warning.path })
  }
  return t('automation.warnings.system_power', { ruleName: warning.ruleName })
}
