import { useEffect, useState } from 'react'

// Like useState, but the value also lives in sessionStorage so it survives
// navigating to another page and coming back (or a reload) while the app
// stays open. Storage can be unavailable, so every access is guarded.
export function usePersistedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }, [key, value])

  return [value, setValue] as const
}
