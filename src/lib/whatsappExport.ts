import type { TaskScore } from './types'

// Our **bold**/*italic*/__underline__/~~strike~~ markers down to plain text,
// so they don't clash with WhatsApp's own *bold* syntax.
function stripMarkers(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
}

export type WhatsappExportInput = {
  tasks: TaskScore[]
  viewLabel: string
  projectNames: string[] // selected project filter names (empty = no filter)
  personNames: string[]
  search: string
  projectName: (id: string | null) => string
  personName: (id: string | null) => string
}

const URGENTE_PRIORITY_ID = 1
const MUY_IMPORTANTE_PRIORITY_ID = 2

const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' })

export function buildWhatsappText(input: WhatsappExportInput): string {
  const { tasks, viewLabel, projectNames, personNames, search } = input
  const today = new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })

  const filters: string[] = []
  if (projectNames.length) filters.push(`Proyecto: ${projectNames.join(', ')}`)
  if (personNames.length) filters.push(`Responsable: ${personNames.join(', ')}`)
  if (search.trim()) filters.push(`Búsqueda: "${search.trim()}"`)

  // A detail already named in the header isn't repeated on every line.
  const showProject = projectNames.length !== 1
  const showPerson = personNames.length !== 1

  const lines: string[] = []
  lines.push(`*TO DO · ${viewLabel}*`)
  if (filters.length) lines.push(filters.join(' · '))
  lines.push(`${today} · ${tasks.length} ${tasks.length === 1 ? 'pendiente' : 'pendientes'}`)
  lines.push('')

  // Only the title carries the priority: Urgente is BOLD AND UPPERCASE,
  // Muy importante is bold, everything else is plain text.
  tasks.forEach((t, i) => {
    const title = stripMarkers(t.title).replace(/\n+/g, ' ')
    const shown =
      t.priority_id === URGENTE_PRIORITY_ID
        ? `*${title.toUpperCase()}*`
        : t.priority_id === MUY_IMPORTANTE_PRIORITY_ID
        ? `*${title}*`
        : title
    lines.push(`${i + 1}. ${shown}`)
    if (t.subactivity) lines.push(`   ${stripMarkers(t.subactivity)}`)
    const parts: string[] = []
    if (showProject) parts.push(input.projectName(t.project_id))
    if (showPerson) parts.push(input.personName(t.responsible_id))
    if (t.due_date) parts.push(`Vence ${shortDate(t.due_date)}`)
    if (parts.length > 0) lines.push(`   ${parts.join(' · ')}`)
    lines.push('')
  })

  return lines.join('\n').trimEnd()
}
