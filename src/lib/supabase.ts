import { createClient } from '@supabase/supabase-js'
import { enqueueWrite } from './offlineQueue'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

// A fetch that behaves normally when online. When a write to Supabase's
// REST API fails because there's no connection, it queues the request
// instead of throwing, and hands back a synthetic "OK" response so the
// calling code (insert/update/delete) proceeds as if it succeeded. The
// queued request is replayed automatically once the connection returns.
const offlineAwareFetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init)
  const method = (init?.method ?? request.method ?? 'GET').toUpperCase()
  const isSupabaseWrite = WRITE_METHODS.has(method) && request.url.includes('supabase.co')

  if (!isSupabaseWrite) {
    return fetch(input, init)
  }

  try {
    return await fetch(input, init)
  } catch (err) {
    // A network error (offline, airplane mode, etc). Queue it and pretend
    // it worked so the UI doesn't show an error for something that will
    // sync automatically.
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => { headers[key] = value })
    const body = init?.body != null ? String(init.body) : await request.clone().text().catch(() => null)

    await enqueueWrite({ url: request.url, method, headers, body: body || null })

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const supabase = createClient(url, anonKey, {
  global: { fetch: offlineAwareFetch },
})
