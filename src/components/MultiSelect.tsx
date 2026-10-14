import { useState } from 'react'

type Option = { value: string; label: string }

// A filter dropdown that lets you tick several options at once. Nothing
// ticked means "all".
export default function MultiSelect(props: {
  allLabel: string
  options: Option[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { allLabel, options, selected, onChange } = props

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? allLabel
      : `${selected.length} seleccionados`

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])

  // Typing narrows the list (accents and capitals ignored); Enter picks the
  // first match and clears the box so you can type the next one.
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const visible = query.trim() ? options.filter((o) => norm(o.label).includes(norm(query.trim()))) : options

  return (
    <div className="border border-gray-300 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setQuery('') }}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left"
      >
        <span className={selected.length > 0 ? 'font-medium text-gray-900 truncate' : 'text-gray-600 truncate'}>{summary}</span>
        <span className="text-xs text-gray-400 ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-200 max-h-56 overflow-y-auto p-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visible.length > 0) {
                e.preventDefault()
                toggle(visible[0].value)
                setQuery('')
              }
            }}
            placeholder="Escribe para buscar..."
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm mb-1"
            autoFocus
          />
          {visible.length === 0 && <p className="px-2 py-1.5 text-xs text-gray-400">Sin resultados</p>}
          {visible.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-gray-50">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="w-4 h-4" />
              <span className="min-w-0 break-words">{o.label}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full text-left px-2 py-1.5 text-xs text-blue-600">
              Limpiar selección
            </button>
          )}
        </div>
      )}
    </div>
  )
}
