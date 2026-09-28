import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

// Replaces the browser's native alert()/confirm() with in-app UI that
// matches the rest of the app (same modal look used for postpone/complete),
// doesn't block the whole page, and behaves consistently on mobile.

type Toast = { id: number; message: string }

type ConfirmState = {
  message: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
}

type FeedbackContextType = {
  notifyError: (message: string) => void
  confirm: (message: string, options?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackContextType | undefined>(undefined)

let nextToastId = 1

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const notifyError = useCallback((message: string) => {
    const id = nextToastId++
    setToasts((prev) => [...prev, { id, message }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 6000)
  }, [])

  const dismissToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id))

  const confirm = useCallback((message: string, options?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean }) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setConfirmState({
        message,
        confirmLabel: options?.confirmLabel ?? 'Confirmar',
        cancelLabel: options?.cancelLabel ?? 'Cancelar',
        danger: options?.danger ?? false,
      })
    })
  }, [])

  const settle = (value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setConfirmState(null)
  }

  return (
    <FeedbackContext.Provider value={{ notifyError, confirm }}>
      {children}

      <div className="fixed top-4 inset-x-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2 border border-red-300 bg-red-50 text-red-900 rounded-xl px-3 py-2.5 text-sm shadow-lg max-w-md mx-auto"
          >
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} className="text-red-400 shrink-0 text-base leading-none px-1">✕</button>
          </div>
        ))}
      </div>

      {confirmState && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-4 w-full sm:max-w-sm space-y-3">
            <p className="font-medium whitespace-pre-line">{confirmState.message}</p>
            <div className="flex gap-2">
              <button onClick={() => settle(false)} className="flex-1 border border-gray-300 rounded-lg py-2.5 text-sm">
                {confirmState.cancelLabel}
              </button>
              <button
                onClick={() => settle(true)}
                className={`flex-1 rounded-lg py-2.5 text-sm text-white ${confirmState.danger ? 'bg-red-600' : 'bg-gray-900'}`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  )
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider')
  return ctx
}
