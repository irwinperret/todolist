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
