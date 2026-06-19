import { useState } from 'react'
import { invoke } from '../lib/ipc'
import { Check, ChevronRight, Keyboard, Type, PlaySquare, Shield } from 'lucide-react'
import { useAppStore } from '../stores/app-store'
import { useProfileStore } from '../store/profileStore'

export function OnboardingWizard() {
  const { config, setConfig } = useAppStore()
  const [step, setStep] = useState(1)
  const [isProcessing, setIsProcessing] = useState(false)
  
  if (config.onboardingComplete) return null

  const handleActivate = async (type: string) => {
    setIsProcessing(true)
    try {
      await invoke('ipc_call', { method: 'apply_onboarding_example', params: { type } })
      await useProfileStore.getState().loadProfiles()
      // Trigger a toast so the user knows it worked
      window.dispatchEvent(new CustomEvent('keymaster-toast', { detail: { message: 'Example applied!', type: 'success' } }))
      
      if (step < 3) {
        setStep(step + 1)
      } else {
        handleComplete()
      }
    } catch (e) {
      window.dispatchEvent(new CustomEvent('keymaster-toast', { detail: { message: 'Failed to apply example', type: 'error' } }))
    } finally {
      setIsProcessing(false)
    }
  }

  const handleComplete = () => {
    setConfig({ onboardingComplete: true })
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-app-surface border border-app-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="bg-app-bg/50 px-6 py-4 flex items-center justify-between border-b border-app-border">
          <div className="flex items-center gap-3">
            <div className="bg-app-primary/20 p-2 rounded-xl text-app-primary">
              <Shield size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-app-text leading-tight">Welcome to KeyMaster Pro</h2>
              <p className="text-xs text-app-muted">Let's set up some useful examples to get you started</p>
            </div>
          </div>
          <div className="text-app-muted text-xs font-mono font-bold bg-app-surface-hover px-2 py-1 rounded-lg">
            Step {step} of 3
          </div>
        </div>

        {/* Content */}
        <div className="p-8">
          {step === 1 && (
            <div className="flex flex-col items-center text-center gap-4 animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-app-surface-hover flex items-center justify-center text-app-primary">
                <Keyboard size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-app-text mb-2">Remap CapsLock</h3>
                <p className="text-sm text-app-muted">
                  CapsLock is rarely used. Remap it to <span className="font-mono text-app-text bg-app-bg px-1 rounded">Backspace</span> for faster typing ergonomics.
                </p>
              </div>
              <button 
                onClick={() => handleActivate('remap')}
                disabled={isProcessing}
                className="mt-4 bg-app-primary hover:bg-app-primary/90 text-white font-bold py-2 px-8 rounded-xl transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                <span>Activate Remap</span>
                <Check size={18} />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col items-center text-center gap-4 animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-app-surface-hover flex items-center justify-center text-app-primary">
                <Type size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-app-text mb-2">Text Expansions</h3>
                <p className="text-sm text-app-muted">
                  Type <span className="font-mono text-app-text bg-app-bg px-1 rounded">@@</span> anywhere to instantly insert your email address. 
                </p>
              </div>
              <button 
                onClick={() => handleActivate('expansion')}
                disabled={isProcessing}
                className="mt-4 bg-app-primary hover:bg-app-primary/90 text-white font-bold py-2 px-8 rounded-xl transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                <span>Activate Expansion</span>
                <Check size={18} />
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center text-center gap-4 animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-app-surface-hover flex items-center justify-center text-app-primary">
                <PlaySquare size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-app-text mb-2">Keyboard Macros</h3>
                <p className="text-sm text-app-muted">
                  Press <span className="font-mono text-app-text bg-app-bg px-1 rounded">F12</span> to automatically type a "Hello World" message. You can record your own macros later.
                </p>
              </div>
              <button 
                onClick={() => handleActivate('macro')}
                disabled={isProcessing}
                className="mt-4 bg-app-primary hover:bg-app-primary/90 text-white font-bold py-2 px-8 rounded-xl transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                <span>Activate Macro</span>
                <Check size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-app-border flex items-center justify-between bg-app-bg/50">
          <button 
            onClick={handleComplete}
            className="text-app-muted hover:text-app-text text-sm transition-colors cursor-pointer"
          >
            Skip all
          </button>
          
          <div className="flex gap-2">
            <button 
              onClick={() => {
                if (step < 3) setStep(step + 1)
                else handleComplete()
              }}
              className="text-app-text hover:bg-app-surface-hover px-4 py-1.5 rounded-lg text-sm font-bold transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>{step === 3 ? 'Finish' : 'Next'}</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
