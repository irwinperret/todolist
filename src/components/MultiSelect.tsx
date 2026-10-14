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
  const { allLabel, options, selected, onChange } = props

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? allLabel
      : `${selected.length} seleccionados`

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])

  return (
    <div className="border border-gray-300 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left"
      >
        <span className={selected.length > 0 ? 'font-medium text-gray-900 truncate' : 'text-gray-600 truncate'}>{summary}</span>
        <span className="text-xs text-gray-400 ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-200 max-h-56 overflow-y-auto p-1">
          {options.map((o) => (
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
