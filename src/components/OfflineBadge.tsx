import { useEffect, useState } from 'react'
import { onQueueChange, getQueuedWrites, flushQueue } from '../lib/offlineQueue'

export default function OfflineBadge() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [justSynced, setJustSynced] = useState(false)

  useEffect(() => {
    getQueuedWrites().then((q) => setPending(q.length))

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // In case the app opens already online with leftover queued writes from
    // a previous offline session (the 'online' event won't fire in that case).
    flushQueue()

    const unsubscribe = onQueueChange((count) => {
      setPending((prev) => {
        if (prev > 0 && count === 0) {
          setJustSynced(true)
          setTimeout(() => setJustSynced(false), 3000)
        }
        return count
      })
    })

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsubscribe()
    }
  }, [])

  if (!isOnline) {
    return (
      <div className="bg-gray-800 text-white text-xs text-center py-1.5 px-3">
        Sin conexión{pending > 0 ? ` · ${pending} cambio${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'} de enviar` : ''}
      </div>
    )
  }

  if (pending > 0) {
    return (
      <div className="bg-amber-500 text-white text-xs text-center py-1.5 px-3">
        Enviando {pending} cambio{pending === 1 ? '' : 's'} pendiente{pending === 1 ? '' : 's'}...
      </div>
    )
  }

  if (justSynced) {
    return (
      <div className="bg-green-600 text-white text-xs text-center py-1.5 px-3">
        ✓ Todo sincronizado
      </div>
    )
  }

  return null
}
