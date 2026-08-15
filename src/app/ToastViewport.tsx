import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react'
import type { ToastMessage } from './useToastQueue'

interface ToastViewportProps {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div className="fixed bottom-9 right-2.5 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        const Icon = {
          success: CheckCircle,
          error: XCircle,
          warning: AlertTriangle,
          info: Info,
        }[toast.type]
        const accent = {
          success: 'text-app-success',
          error: 'text-app-danger',
          warning: 'text-app-warning',
          info: 'text-app-primary',
        }[toast.type]

        return (
          <div
            key={toast.id}
            className="flex items-center gap-3 px-3 py-2.5 bg-app-bg border border-app-border shadow-lg pointer-events-auto"
          >
            <Icon size={15} className={`shrink-0 ${accent}`} />
            <p className="text-xs text-app-text flex-1 select-text">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-app-muted hover:text-app-text"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
