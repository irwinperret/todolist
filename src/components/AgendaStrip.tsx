import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type AgendaEvent = {
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  calendar: string | null
}

type ApiResult = { configured: boolean; failed?: number; events: AgendaEvent[] }

const DAYS_AHEAD = 3 // today + the next 3 days

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' })

function readCollapsed(): boolean {
  try { return localStorage.getItem('agendaCollapsed') === '1' } catch { return false }
}

export default function AgendaStrip() {
  const [data, setData] = useState<ApiResult | null>(null)
  const [error, setError] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const load = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      const to = new Date(from)
      to.setDate(to.getDate() + DAYS_AHEAD + 1)
      const res = await fetch(`/api/calendar?from=${from.toISOString()}&to=${to.toISOString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(String(res.status))
      setData((await res.json()) as ApiResult)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('agendaCollapsed', next ? '1' : '0') } catch { /* ignore */ }
  }

  // Nothing to show until the calendar is set up (or while offline with no data yet).
  if (!data && !error) return null
  if (error && !data) return null
  if (data && !data.configured) return null

  const now = new Date()
  const days = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1)
    return { start, end, key: dayKey(start) }
  })

  const eventsFor = (day: (typeof days)[number]) =>
    (data?.events ?? [])
      .filter((e) =>
        e.allDay
          ? e.start <= day.key && day.key < e.end
          : new Date(e.start) < day.end && new Date(e.end) > day.start
      )
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))

  const dayTitle = (i: number, d: Date) => {
    const label = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
    return i === 0 ? `Hoy · ${label}` : i === 1 ? `Mañana · ${label}` : label
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700">
        <span>📅 Agenda · próximos {DAYS_AHEAD + 1} días</span>
        <span className="text-xs text-gray-400">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3">
          {days.map((day, i) => {
            const events = eventsFor(day)
            return (
              <div key={day.key}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${i === 0 ? 'text-blue-700' : 'text-gray-500'}`}>
                  {dayTitle(i, day.start)}
                </p>
                {events.length === 0 ? (
                  <p className="text-xs text-gray-400 pl-2">Libre</p>
                ) : (
                  <ul className="mt-0.5 space-y-0.5">
                    {events.map((e, j) => {
                      const past = !e.allDay && i === 0 && new Date(e.end) < now
                      return (
                        <li key={`${e.start}-${e.title}-${j}`} className={`flex gap-2 text-sm pl-2 ${past ? 'text-gray-400' : 'text-gray-800'}`}>
                          <span className="w-24 shrink-0 text-xs pt-0.5 text-gray-500">
                            {e.allDay ? 'Todo el día' : `${timeLabel(e.start)}`}
                          </span>
                          <span className="min-w-0">
                            {e.title}
                            {e.location && <span className="text-xs text-gray-400"> · {e.location}</span>}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
          {data?.failed ? (
            <p className="text-xs text-amber-700">No se pudo leer {data.failed} calendario(s).</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
