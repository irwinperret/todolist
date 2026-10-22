import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Row = { id: string; title: string; due_date: string | null; responsible_id: string | null }

// "bloqueada por N tareas" / "bloquea N tareas" chip for a task card. Tapping
// it opens the list of those tasks right under the card's info row.
export default function DependencyList(props: {
  taskId: string
  direction: 'blockedBy' | 'blocks'
  count: number
  urgent: boolean
  personName: (id: string | null) => string
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const next = !open
    setOpen(next)
    if (next) {
      const blockedBy = props.direction === 'blockedBy'
      const { data } = await supabase
        .from('task_dependencies')
        .select(`tasks:${blockedBy ? 'depends_on_task_id' : 'task_id'}(id, title, due_date, responsible_id)`)
        .eq(blockedBy ? 'task_id' : 'depends_on_task_id', props.taskId)
        .is('resolved_at', null)
      setRows(((data as unknown as { tasks: Row | null }[]) ?? []).map((r) => r.tasks).filter((t): t is Row => Boolean(t)))
    }
  }

  const label =
    props.direction === 'blockedBy'
      ? `🔒 bloqueada por ${props.count} ${props.count === 1 ? 'tarea' : 'tareas'}`
      : `bloquea ${props.count} ${props.count === 1 ? 'tarea' : 'tareas'}`
  const color = props.urgent ? 'text-red-900 font-bold' : 'text-red-500 font-medium'

  return (
    <>
      <span>·</span>
      <button type="button" onClick={toggle} className={`${color} underline underline-offset-2`}>
        {label} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="basis-full w-full mt-1 space-y-1" onClick={(e) => e.stopPropagation()}>
          {rows === null && <p className="text-gray-500">Cargando...</p>}
          {rows?.length === 0 && <p className="text-gray-500">Nada pendiente.</p>}
          {rows?.map((r) => (
            <Link
              key={r.id}
              to={`/task/${r.id}`}
              className="block bg-white/80 border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            >
              <span className="text-sm">{r.title}</span>
              <span className="block text-xs text-gray-600">
                {props.personName(r.responsible_id)}
                {r.due_date ? ` · vence ${new Date(r.due_date + 'T00:00:00').toLocaleDateString()}` : ''}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
