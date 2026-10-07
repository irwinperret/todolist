export function googleCalendarUrl(params: {
  title: string
  dueDate: string // YYYY-MM-DD
  details?: string | null
  location?: string | null
}): string {
  const start = params.dueDate.replace(/-/g, '')
  const endDate = new Date(params.dueDate + 'T00:00:00')
  endDate.setDate(endDate.getDate() + 1)
  const end = endDate.toISOString().slice(0, 10).replace(/-/g, '')

  const query = new URLSearchParams({
    action: 'TEMPLATE',
    text: params.title,
    dates: `${start}/${end}`,
  })
  if (params.details) query.set('details', params.details)
  if (params.location) query.set('location', params.location)

  return `https://calendar.google.com/calendar/render?${query.toString()}`
}

export function isOverdue(dueDate: string | null, statusId: number): boolean {
  if (!dueDate || statusId === 8) return false
  const today = new Date().toISOString().slice(0, 10)
  return dueDate < today
}

// Discreet "how old is this task" label for task cards, e.g. "2 oct · 5d".
// Date plus a compact age so you can spot stale tasks at a glance.
export function formatTaskAge(createdAt: string): { label: string; full: string } {
  const created = new Date(createdAt)
  const now = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.max(0, Math.round((startOf(now) - startOf(created)) / 86400000))

  let age: string
  if (days < 1) age = 'hoy'
  else if (days < 30) age = `${days}d`
  else if (days < 365) age = `${Math.floor(days / 30)}m`
  else age = `${Math.floor(days / 365)}a`

  const sameYear = created.getFullYear() === now.getFullYear()
  const date = created.toLocaleDateString('es', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
  return { label: `${date} · ${age}`, full: `Creada el ${created.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}` }
}
