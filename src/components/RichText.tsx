import { useRef, type KeyboardEvent } from 'react'

// Lightweight formatting: **bold**, *italic*, __underline__, ~~strikethrough~~.
// Escapes HTML first so nothing else can be injected, then applies the
// patterns and turns newlines into <br/>.
export function formatRichText(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

export function RichText({ text, className }: { text: string; className?: string }) {
  return <p className={className} dangerouslySetInnerHTML={{ __html: formatRichText(text) }} />
}

// Shared logic behind the formatting keyboard shortcuts (Ctrl/Cmd+B/I/U,
// Ctrl/Cmd+Shift+X for strikethrough), usable on any <input> or <textarea>.
export function useFormatShortcuts<T extends HTMLInputElement | HTMLTextAreaElement>(
  value: string,
  onChange: (v: string) => void
) {
  const ref = useRef<T>(null)

  const wrapSelection = (marker: string) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const before = value.slice(0, start)
    const selected = value.slice(start, end)
    const after = value.slice(end)
    const next = `${before}${marker}${selected || 'texto'}${marker}${after}`
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const selStart = start + marker.length
      const selEnd = selStart + (selected || 'texto').length
      el.setSelectionRange(selStart, selEnd)
    })
  }

  const onKeyDown = (e: KeyboardEvent<T>) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const key = e.key.toLowerCase()
    if (key === 'b') { e.preventDefault(); wrapSelection('**') }
    else if (key === 'i') { e.preventDefault(); wrapSelection('*') }
    else if (key === 'u') { e.preventDefault(); wrapSelection('__') }
    else if (e.shiftKey && key === 'x') { e.preventDefault(); wrapSelection('~~') }
  }

  return { ref, onKeyDown }
}

export function RichTextArea(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  className?: string
}) {
  const { ref, onKeyDown } = useFormatShortcuts<HTMLTextAreaElement>(props.value, props.onChange)

  return (
    <textarea
      ref={ref}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={props.placeholder}
      rows={props.rows ?? 4}
      className={props.className ?? 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base'}
    />
  )
}
