import { useState } from 'react'
import { Check, ChevronRight, Keyboard, PlaySquare, Shield, Type } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../lib/ipc'
import { useAppStore } from '../store/appStore'
import { useProfileStore } from '../store/profileStore'

export function OnboardingWizard() {
  const { t } = useTranslation()
  const { config, setConfig } = useAppStore()
  const [step, setStep] = useState(1)
  const [isProcessing, setIsProcessing] = useState(false)

  if (config.onboardingComplete) return null

  const handleComplete = () => {
    setConfig({ onboardingComplete: true })
  }

  const handleActivate = async (type: string) => {
    if (isProcessing) return
    setIsProcessing(true)
    try {
      await invoke('ipc_call', { method: 'apply_onboarding_example', params: { type } })
      await useProfileStore.getState().loadProfiles()
      window.dispatchEvent(new CustomEvent('keymaster-toast', {
        detail: { message: t('onboarding.toast_applied'), type: 'success' },
      }))

      if (step < 3) setStep((current) => current + 1)
      else handleComplete()
    } catch {
      window.dispatchEvent(new CustomEvent('keymaster-toast', {
        detail: { message: t('onboarding.toast_failed'), type: 'error' },
      }))
    } finally {
      setIsProcessing(false)
    }
  }

  const stepData = step === 1
    ? {
        icon: Keyboard,
        title: t('onboarding.remap_title'),
        description: t('onboarding.remap_desc'),
        button: t('onboarding.remap_btn'),
        type: 'remap',
      }
    : step === 2
      ? {
          icon: Type,
          title: t('onboarding.expansion_title'),
          description: t('onboarding.expansion_desc'),
          button: t('onboarding.expansion_btn'),
          type: 'expansion',
        }
      : {
          icon: PlaySquare,
          title: t('onboarding.macro_title'),
          description: t('onboarding.macro_desc'),
          button: t('onboarding.macro_btn'),
          type: 'macro',
        }

  const StepIcon = stepData.icon

  return (
    <div className="fixed inset-0 z-[1000] bg-black/35 flex items-center justify-center p-4">
      <div className="w-[560px] max-w-full border border-app-border bg-app-bg shadow-2xl">
        <div className="h-11 px-3 flex items-center border-b border-app-border bg-app-surface/60">
          <Shield size={16} className="text-app-primary mr-2" />
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-app-text truncate">{t('onboarding.welcome_title')}</h2>
            <p className="text-[10px] text-app-muted truncate">{t('onboarding.welcome_subtitle')}</p>
          </div>
          <span className="ml-auto text-[10px] font-mono text-app-muted">
            {t('onboarding.step_of', { current: step, total: 3 })}
          </span>
        </div>

        <div className="grid grid-cols-[150px_minmax(0,1fr)] min-h-[250px]">
          <aside className="border-r border-app-border bg-app-surface/20 py-2">
            {[1, 2, 3].map((number) => (
              <div
                key={number}
                className={`h-9 px-3 flex items-center gap-2 border-l-2 text-[11px] ${
                  number === step
                    ? 'border-app-primary bg-app-primary/8 text-app-text font-semibold'
                    : number < step
                      ? 'border-transparent text-app-success'
                      : 'border-transparent text-app-muted'
                }`}
              >
                <span className="w-4 text-center font-mono">{number < step ? '✓' : number}</span>
                <span>{number === 1 ? t('nav.rules', { defaultValue: 'Правила' }) : number === 2 ? t('nav.text', { defaultValue: 'Текст' }) : t('nav.macros', { defaultValue: 'Макросы' })}</span>
              </div>
            ))}
          </aside>

          <main className="p-5 flex flex-col">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 shrink-0 flex items-center justify-center border border-app-border bg-app-surface/45 text-app-primary">
                <StepIcon size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-app-text">{stepData.title}</h3>
                <p className="mt-1.5 text-[11px] leading-5 text-app-muted">{stepData.description}</p>
              </div>
            </div>

            <div className="mt-auto pt-5">
              <button
                type="button"
                onClick={() => void handleActivate(stepData.type)}
                disabled={isProcessing}
                className="h-8 px-3 inline-flex items-center gap-2 border border-app-primary bg-app-primary text-[11px] font-semibold text-white hover:bg-app-primary-hover disabled:opacity-45"
              >
                <Check size={12} />
                {isProcessing ? t('common.saving', { defaultValue: 'Применение…' }) : stepData.button}
              </button>
            </div>
          </main>
        </div>

        <div className="h-11 px-3 flex items-center border-t border-app-border bg-app-surface/35">
          <button
            type="button"
            onClick={handleComplete}
            disabled={isProcessing}
            className="h-7 px-2 text-[11px] text-app-muted hover:text-app-text disabled:opacity-40"
          >
            {t('onboarding.skip_all')}
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => {
              if (step < 3) setStep((current) => current + 1)
              else handleComplete()
            }}
            className="ml-auto h-7 px-3 inline-flex items-center gap-1.5 border border-app-border bg-app-bg text-[11px] text-app-text hover:bg-app-surface-hover disabled:opacity-40"
          >
            {step === 3 ? t('onboarding.finish') : t('onboarding.next')}
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
