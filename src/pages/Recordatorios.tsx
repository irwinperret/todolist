import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskScore } from '../lib/types'
import { googleCalendarUrl, isOverdue } from '../lib/calendar'

export default function Recordatorios() {
  const { projects, people } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('task_scores')
      .select('*')
      .not('due_date', 'is', null)
      .eq('archived', false)
      .order('due_date', { ascending: true })
      .then(({ data }) => {
        setTasks((data as TaskScore[]) ?? [])
        setLoading(false)
      })
  }, [])

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—'

  return (
    <div className="px-4 pt-4 space-y-2">
      <h2 className="text-sm text-gray-500 mb-2">Actividades con fecha de entrega</h2>

      {loading && <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>}
      {!loading && tasks.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Nada con fecha de entrega todavía.</p>
      )}

      <div className="space-y-2">
        {tasks.map((t) => {
          const overdue = isOverdue(t.due_date, t.status_id)
          return (
            <div
              key={t.id}
              className={`bg-white border rounded-xl p-3 ${overdue ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
            >
              <Link to={`/task/${t.id}`} className="block">
                <p className="font-medium text-gray-900">{t.title}</p>
                {t.subactivity && <p className="text-sm text-gray-500">{t.subactivity}</p>}
                <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
                  <span className="text-blue-700 font-medium">{projectName(t.project_id)}</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-purple-700 font-medium">{personName(t.responsible_id)}</span>
                  <span className="text-gray-400">·</span>
                  <span className={overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                    {overdue ? 'venció el ' : 'vence '}
                    {new Date(t.due_date! + 'T00:00:00').toLocaleDateString()}
                  </span>
                </div>
              </Link>
              <a
                href={googleCalendarUrl({
                  title: t.title,
                  dueDate: t.due_date!,
                  details: t.comment,
                  location: t.location,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-xs bg-blue-50 text-blue-700 rounded-full px-3 py-1"
              >
                📅 Agregar a Google Calendar
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}
