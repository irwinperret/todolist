import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskScore } from '../lib/types'
import { googleCalendarUrl, isOverdue } from '../lib/calendar'

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function Recordatorios() {
  const { projects, people } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('task_scores')
      .select('*')
      .or('due_date.not.is.null,follow_up_date.not.is.null')
      .neq('status_id', 8)
      .eq('archived', false)
      .then(({ data }) => {
        const rows = (data as TaskScore[]) ?? []
        // sort by whichever date is relevant, soonest first
        rows.sort((a, b) => {
          const da = a.due_date ?? a.follow_up_date ?? ''
          const db = b.due_date ?? b.follow_up_date ?? ''
          return da.localeCompare(db)
        })
        setTasks(rows)
        setLoading(false)
      })
  }, [])

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—'

  return (
    <div className="px-4 pt-4 space-y-2">
      <h2 className="text-sm text-gray-500 mb-2">Fechas de entrega y actividades pospuestas</h2>

      {loading && <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>}
      {!loading && tasks.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Nada por aquí todavía.</p>
      )}

      <div className="space-y-2">
        {tasks.map((t) => {
          const overdue = isOverdue(t.due_date, t.status_id)
          const isPostponed = Boolean(t.follow_up_date) && t.follow_up_date! > todayStr()
          const cardBg = overdue
            ? 'border-red-300 bg-red-50'
            : isPostponed
            ? 'border-teal-300 bg-teal-50'
            : 'border-gray-200 bg-white'

          return (
            <div key={t.id} className={`border rounded-xl p-3 ${cardBg}`}>
              <Link to={`/task/${t.id}`} className="block">
                <p className="font-medium text-gray-900">{t.title}</p>
                {t.subactivity && <p className="text-sm text-gray-500">{t.subactivity}</p>}
                <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
                  <span className="text-blue-700 font-medium">{projectName(t.project_id)}</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-purple-700 font-medium">{personName(t.responsible_id)}</span>
                  {t.due_date && (
                    <>
                      <span className="text-gray-400">·</span>
                      <span className={overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                        {overdue ? 'venció el ' : 'vence '}
                        {new Date(t.due_date + 'T00:00:00').toLocaleDateString()}
                      </span>
                    </>
                  )}
                  {t.follow_up_date && (
                    <>
                      <span className="text-gray-400">·</span>
                      <span className={isPostponed ? 'text-teal-700 font-semibold' : 'text-gray-500'}>
                        vuelve el {new Date(t.follow_up_date + 'T00:00:00').toLocaleDateString()}
                      </span>
                    </>
                  )}
                </div>
              </Link>
              {t.due_date && (
                <a
                  href={googleCalendarUrl({
                    title: t.title,
                    dueDate: t.due_date,
                    details: t.comment,
                    location: t.location,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-2 text-xs bg-blue-50 text-blue-700 rounded-full px-3 py-1"
                >
                  📅 Agregar a Google Calendar
                </a>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
