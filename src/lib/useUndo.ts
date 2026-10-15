import { useCallback, useEffect, useSyncExternalStore } from 'react'

type Entry = { label: string; run: () => Promise<void> }

// Throws when a Supabase call came back with an error, so a failed undo step
// stops and is reported instead of silently leaving things half-restored.
export function assertOk(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message)
}

// Global in-memory history of the last changes made anywhere in the app. Each
// change registers how to reverse itself; undo() runs the most recent one.
// History lives only while the app is open (the stack survives page changes).
const LIMIT = 20
const stack: Entry[] = []
let running = false
let state = { labels: [] as string[], busy: false }
const listeners = new Set<() => void>()
let errorHandler: (message: string) => void = () => {}

function emit(next: Partial<typeof state>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const getState = () => state

function pushEntry(label: string, run: () => Promise<void>) {
  stack.push({ label, run })
  if (stack.length > LIMIT) stack.shift()
  emit({ labels: stack.map((e) => e.label) })
}

async function undoLast() {
  if (running) return
  const entry = stack.pop()
  if (!entry) return
  running = true
  emit({ busy: true, labels: stack.map((e) => e.label) })
  try {
    await entry.run()
  } catch (err) {
    errorHandler(`No se pudo deshacer: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    running = false
    emit({ busy: false })
  }
}

// For pages that register undoable changes.
export function useUndo(_onError?: (message: string) => void) {
  const push = useCallback(pushEntry, [])
  return { push }
}

// For the single global Undo button (Layout): state, undo action and Ctrl/Cmd+Z.
export function useUndoControls(onError: (message: string) => void) {
  const s = useSyncExternalStore(subscribe, getState)
  useEffect(() => { errorHandler = onError }, [onError])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (stack.length === 0) return
      e.preventDefault()
      undoLast()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return { undo: undoLast, canUndo: s.labels.length > 0, lastLabel: s.labels[s.labels.length - 1] ?? '', busy: s.busy }
}
