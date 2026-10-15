import { useCallback, useEffect, useRef, useState } from 'react'

type Entry = { label: string; run: () => Promise<void> }

// Throws when a Supabase call came back with an error, so a failed undo step
// stops and is reported instead of silently leaving things half-restored.
export function assertOk(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message)
}

// A small in-memory history of the last changes made on a page. Each change
// registers how to reverse itself; undo() runs the most recent one. History
// lives only while the page is open. Ctrl/Cmd+Z does the same as the button
// (except while typing in a field, where it keeps its normal text-undo job).
export function useUndo(onError: (message: string) => void, limit = 20) {
  const stack = useRef<Entry[]>([])
  const running = useRef(false)
  const [labels, setLabels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const push = useCallback((label: string, run: () => Promise<void>) => {
    stack.current.push({ label, run })
    if (stack.current.length > limit) stack.current.shift()
    setLabels(stack.current.map((e) => e.label))
  }, [limit])

  const undo = useCallback(async () => {
    if (running.current) return
    const entry = stack.current.pop()
    if (!entry) return
    running.current = true
    setBusy(true)
    setLabels(stack.current.map((e) => e.label))
    try {
      await entry.run()
    } catch (err) {
      onError(`No se pudo deshacer: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [onError])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (stack.current.length === 0) return
      e.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  return { push, undo, canUndo: labels.length > 0, lastLabel: labels[labels.length - 1] ?? '', busy }
}
