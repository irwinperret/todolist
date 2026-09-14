import type { MeetingItem } from './types'

type CategoryNodeLike = {
  id: string
  name: string
  children: CategoryNodeLike[]
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Strip our **bold**/*italic*/__underline__/~~strike~~ markers down to plain
// text for the export, since the target (Google Docs) gets its formatting
// from real HTML tags instead.
function stripMarkers(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
}

function buildCategoryHtml(
  nodes: CategoryNodeLike[],
  itemsByCategory: Record<string, MeetingItem[]>,
  depth: number
): string {
  let html = ''
  for (const node of nodes) {
    const headerMargin = depth * 24
    html += `<p style="margin:10px 0 4px ${headerMargin}px;font-weight:bold;">${escapeHtml(node.name)}</p>`
    const items = itemsByCategory[node.id] ?? []
    const itemMargin = headerMargin + 20
    for (const item of items) {
      const strike = item.is_done ? 'text-decoration:line-through;color:#888888;' : ''
      html += `<p style="margin:2px 0 2px ${itemMargin}px;${strike}">- ${escapeHtml(stripMarkers(item.content))}</p>`
      if (item.comment) {
        html += `<p style="margin:2px 0 6px ${itemMargin + 20}px;color:#7c3aed;font-style:italic;">${escapeHtml(stripMarkers(item.comment))}</p>`
      }
    }
    html += buildCategoryHtml(node.children, itemsByCategory, depth + 1)
  }
  return html
}

function buildCategoryText(
  nodes: CategoryNodeLike[],
  itemsByCategory: Record<string, MeetingItem[]>,
  depth: number
): string {
  let out = ''
  const indent = '  '.repeat(depth)
  for (const node of nodes) {
    out += `\n${indent}${node.name}\n`
    const items = itemsByCategory[node.id] ?? []
    const itemIndent = '  '.repeat(depth + 1)
    for (const item of items) {
      const doneMark = item.is_done ? '[x] ' : ''
      out += `${itemIndent}- ${doneMark}${stripMarkers(item.content)}\n`
      if (item.comment) {
        out += `${itemIndent}  (${stripMarkers(item.comment)})\n`
      }
    }
    out += buildCategoryText(node.children, itemsByCategory, depth + 1)
  }
  return out
}

export function buildMeetingExport(params: {
  meetingName: string
  meetingDate: string
  minutaText: string
  attendees: string | null
  acuerdos: string | null
  categoryTree: CategoryNodeLike[]
  itemsByCategory: Record<string, MeetingItem[]>
  uncategorized: MeetingItem[]
}): { html: string; text: string } {
  const dateLabel = new Date(params.meetingDate + 'T00:00:00').toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  let html = `<p style="font-weight:bold;color:#1d4ed8;">${escapeHtml(params.meetingName.toUpperCase())} ${dateLabel}</p>`
  if (params.attendees) {
    html += `<p style="color:#555;">Asistentes: ${escapeHtml(params.attendees)}</p>`
  }
  html += buildCategoryHtml(params.categoryTree, params.itemsByCategory, 0)
  if (params.uncategorized.length > 0) {
    for (const item of params.uncategorized) {
      const strike = item.is_done ? 'text-decoration:line-through;color:#888888;' : ''
      html += `<p style="margin:2px 0;${strike}">- ${escapeHtml(stripMarkers(item.content))}</p>`
    }
  }
  if (params.acuerdos) {
    html += `<p style="margin-top:12px;font-weight:bold;">Acuerdos generales</p>`
    html += `<p>${escapeHtml(stripMarkers(params.acuerdos))}</p>`
  }

  let text = `${params.meetingName.toUpperCase()} ${dateLabel}\n`
  if (params.attendees) text += `Asistentes: ${params.attendees}\n`
  text += buildCategoryText(params.categoryTree, params.itemsByCategory, 0)
  if (params.uncategorized.length > 0) {
    text += '\n'
    for (const item of params.uncategorized) {
      text += `- ${item.is_done ? '[x] ' : ''}${stripMarkers(item.content)}\n`
    }
  }
  if (params.acuerdos) {
    text += `\nAcuerdos generales\n${stripMarkers(params.acuerdos)}\n`
  }

  return { html, text }
}

export async function copyMeetingExportToClipboard(params: Parameters<typeof buildMeetingExport>[0]): Promise<'html' | 'text' | 'failed'> {
  const { html, text } = buildMeetingExport(params)
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      return 'html'
    }
  } catch {
    // fall through to plain text
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'text'
  } catch {
    return 'failed'
  }
}
