// Minimal IndexedDB-backed queue for writes made while offline. Each queued
// entry stores exactly what's needed to replay the original fetch() call
// later: url, method, headers, and body.

const DB_NAME = 'todolist-offline'
const STORE_NAME = 'pending-writes'

type QueuedWrite = {
  id: number
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
  queuedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function enqueueWrite(entry: Omit<QueuedWrite, 'id' | 'queuedAt'>): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).add({ ...entry, queuedAt: new Date().toISOString() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  notifyQueueChanged()
}

export async function getQueuedWrites(): Promise<QueuedWrite[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result as QueuedWrite[])
    req.onerror = () => reject(req.error)
  })
}

async function removeQueuedWrite(id: number): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  notifyQueueChanged()
}

// Replays queued writes in the order they were made. Stops at the first
// failure so we never apply changes out of order; whatever's left stays
// queued for the next time we're back online.
export async function flushQueue(): Promise<void> {
  const pending = await getQueuedWrites()
  pending.sort((a, b) => a.id - b.id)
  for (const item of pending) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body ?? undefined,
      })
      if (!res.ok && res.status !== 409) {
        // A real server-side error (not just "already applied"): stop here,
        // leave it queued, and let the person notice via the pending count.
        break
      }
      await removeQueuedWrite(item.id)
    } catch {
      // Still offline or a transient failure: stop and try again next time.
      break
    }
  }
}

type QueueListener = (count: number) => void
const listeners = new Set<QueueListener>()

export function onQueueChange(listener: QueueListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function notifyQueueChanged() {
  const count = (await getQueuedWrites()).length
  listeners.forEach((l) => l(count))
}

// Kick off a flush attempt whenever the browser regains connectivity, and
// notify listeners so UI (the offline badge) can update its pending count.
window.addEventListener('online', () => {
  flushQueue().then(notifyQueueChanged)
})
