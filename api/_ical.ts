import ical from 'node-ical'

export type AgendaEvent = {
  title: string
  // Timed events: ISO instants. All-day events: plain YYYY-MM-DD (end is exclusive).
  start: string
  end: string
  allDay: boolean
  location: string | null
  calendar: string | null
}

const text = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && 'val' in v) return String((v as { val: unknown }).val ?? '')
  return ''
}

export async function eventsFromIcs(icsText: string, from: Date, to: Date): Promise<AgendaEvent[]> {
  const parsed = await ical.async.parseICS(icsText)
  const all = Object.values(parsed) as Array<Record<string, unknown>>
  const calendarName = text(all.find((o) => o.type === 'VCALENDAR')?.['WR-CALNAME']) || null

  const out: AgendaEvent[] = []
  for (const obj of all) {
    if (obj.type !== 'VEVENT') continue
    if (text(obj.status).toUpperCase() === 'CANCELLED') continue
    const instances = ical.expandRecurringEvent(obj as never, {
      from,
      to,
      includeOverrides: true,
      excludeExdates: true,
      expandOngoing: true,
    })
    for (const inst of instances) {
      if (text(inst.event?.status).toUpperCase() === 'CANCELLED') continue
      const allDay = inst.isFullDay
      out.push({
        title: text(inst.summary) || '(Sin título)',
        start: allDay ? inst.start.toISOString().slice(0, 10) : inst.start.toISOString(),
        end: allDay ? inst.end.toISOString().slice(0, 10) : inst.end.toISOString(),
        allDay,
        location: text(inst.event?.location) || null,
        calendar: calendarName,
      })
    }
  }
  return out
}
