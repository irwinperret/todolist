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

const DAYS = 3 // today + the next 2 days

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
      to.setDate(to.getDate() + DAYS)
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
  const days = Array.from({ length: DAYS }, (_, i) => {
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

  const dayTitle = (i: number, d: Date) =>
    i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : d.toLocaleDateString('es', { weekday: 'long' })

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700">
        <span>📅 Agenda</span>
        <span className="text-xs text-gray-400">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="px-2 pb-2">
          <div className="grid grid-cols-3 gap-2">
            {days.map((day, i) => {
              const events = eventsFor(day)
              return (
                <div
                  key={day.key}
                  className={`min-w-0 rounded-lg border p-2 ${i === 0 ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}
                >
                  <p className={`text-xs font-semibold uppercase tracking-wide ${i === 0 ? 'text-blue-700' : 'text-gray-600'}`}>
                    {dayTitle(i, day.start)}
                  </p>
                  <p className="text-[11px] text-gray-500 mb-1">
                    {day.start.toLocaleDateString('es', { day: 'numeric', month: 'short' })}
                  </p>
                  {events.length === 0 ? (
                    <p className="text-xs text-gray-400">Libre</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {events.map((e, j) => {
                        const past = !e.allDay && i === 0 && new Date(e.end) < now
                        return (
                          <li key={`${e.start}-${e.title}-${j}`} className={`leading-tight ${past ? 'text-gray-400' : 'text-gray-800'}`}>
                            <span className="block text-[11px] font-medium text-gray-500">
                              {e.allDay ? 'Todo el día' : timeLabel(e.start)}
                            </span>
                            <span className="block text-xs break-words">{e.title}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          {data?.failed ? (
            <p className="text-xs text-amber-700 mt-2 px-1">No se pudo leer {data.failed} calendario(s).</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
