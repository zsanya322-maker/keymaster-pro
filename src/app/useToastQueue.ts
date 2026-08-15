import { useCallback, useEffect, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastMessage {
  id: string
  message: string
  type: ToastType
}

interface ToastEventDetail {
  message: string
  type: ToastType
}

export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).substring(2, 9)
    setToasts((previous) => [...previous, { id, message, type }])
    window.setTimeout(() => dismissToast(id), 4000)
  }, [dismissToast])

  useEffect(() => {
    const handleToastEvent = (event: Event) => {
      const customEvent = event as CustomEvent<ToastEventDetail>
      if (customEvent.detail) {
        showToast(customEvent.detail.message, customEvent.detail.type)
      }
    }

    window.addEventListener('keymaster-toast', handleToastEvent)
    return () => window.removeEventListener('keymaster-toast', handleToastEvent)
  }, [showToast])

  return { toasts, showToast, dismissToast }
}
