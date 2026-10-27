import { useState } from 'react'

type Option = { value: string; label: string }

// A single-choice picker that opens inside the page (not as the system's
// native popup), so the list can never end up off-screen. Typing narrows the
// list; accents and capitals are ignored.
export default function InlinePicker(props: {
  value: string
  placeholder: string
  options: Option[]
  onChange: (value: string) => void
  extra?: Option // optional last row, e.g. "+ Agregar nuevo..."
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { value, placeholder, options, onChange, extra, compact } = props

  const selectedLabel = options.find((o) => o.value === value)?.label
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const visible = query.trim() ? options.filter((o) => norm(o.label).includes(norm(query.trim()))) : options

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="w-full border border-gray-300 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setQuery('') }}
        aria-expanded={open}
        className={`w-full flex items-center justify-between text-left ${compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2.5 text-base'}`}
      >
        <span className={`truncate ${selectedLabel ? 'text-gray-900' : 'text-gray-500'}`}>{selectedLabel ?? placeholder}</span>
        <span className="text-xs text-gray-400 ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-200 max-h-60 overflow-y-auto p-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visible.length > 0) { e.preventDefault(); pick(visible[0].value) }
            }}
            placeholder="Escribe para buscar..."
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm mb-1"
            autoFocus
          />
          {visible.length === 0 && <p className="px-2 py-1.5 text-xs text-gray-400">Sin resultados</p>}
          {visible.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => pick(o.value)}
              className={`block w-full text-left px-2 py-2 text-sm rounded break-words hover:bg-gray-50 ${o.value === value ? 'font-medium bg-gray-100' : ''}`}
            >
              {o.label}
            </button>
          ))}
          {extra && (
            <button type="button" onClick={() => pick(extra.value)} className="block w-full text-left px-2 py-2 text-sm text-blue-600">
              {extra.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
