import { eventsFromIcs, type AgendaEvent } from './_ical.js'

// Reads the private iCal feeds of your Google calendars (secret URLs kept in
// the GOOGLE_CALENDAR_ICAL_URLS env var on Vercel, never sent to the browser)
// and returns only the events in the requested window. Requires a valid
// Supabase session so strangers can't read your agenda.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })

async function isSignedIn(request: Request): Promise<boolean> {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const auth = request.headers.get('authorization')
  if (!url || !anon || !auth) return false
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } })
  return res.ok
}

export async function GET(request: Request) {
  if (!(await isSignedIn(request))) return json({ error: 'unauthorized' }, 401)

  const feeds = (process.env.GOOGLE_CALENDAR_ICAL_URLS ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s))
  if (feeds.length === 0) return json({ configured: false, events: [] })

  const params = new URL(request.url).searchParams
  const from = new Date(params.get('from') ?? '')
  const to = new Date(params.get('to') ?? '')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 14 * 86400000) {
    return json({ error: 'bad range' }, 400)
  }

  const results = await Promise.allSettled(
    feeds.map(async (feedUrl, i) => {
      const res = await fetch(feedUrl.replace(/^webcal:/, 'https:'), { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`feed ${i + 1}: HTTP ${res.status}`)
      return eventsFromIcs(await res.text(), from, to)
    })
  )

  const events: AgendaEvent[] = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  const failed = results.filter((r) => r.status === 'rejected').length
  return json({ configured: true, failed, events })
}
