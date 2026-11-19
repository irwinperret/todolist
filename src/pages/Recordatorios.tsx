import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskScore } from '../lib/types'
import { googleCalendarUrl, isOverdue, formatTaskAge } from '../lib/calendar'
import { getTaskCardStyle } from '../lib/taskCardStyle'
import { reconcilePostponedTasks } from '../lib/dependencies'
import { formatRichText } from '../components/RichText'
import ProjectChip from '../components/ProjectChip'

export default function Recordatorios() {
  const { projectName, projectColor, personName } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    reconcilePostponedTasks().then(() => {
      supabase
        .from('task_scores')
        .select('*')
        .or('due_date.not.is.null,postponed_until.not.is.null')
        .neq('status_id', 8)
        .eq('archived', false)
        .then(({ data }) => {
          const rows = (data as TaskScore[]) ?? []
          rows.sort((a, b) => (a.postponed_until ?? a.due_date ?? '').localeCompare(b.postponed_until ?? b.due_date ?? ''))
          setTasks(rows)
          setLoading(false)
        })
    })
  }, [])

  return (
    <div className="px-4 pt-4 space-y-2">
      <h2 className="text-sm text-gray-500 mb-2">Fechas de entrega</h2>

      {loading && <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>}
      {!loading && tasks.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Nada por aquí todavía.</p>
      )}

      <div className="space-y-2">
        {tasks.map((t) => {
          const postponed = t.status_id === 6 && !!t.postponed_until
          const shownDate = postponed ? t.postponed_until : t.due_date
          const overdue = !postponed && isOverdue(t.due_date, t.status_id)
          const cardBg = getTaskCardStyle(t, { includeFollowUp: false })

          return (
            <div key={t.id} className={`border rounded-xl p-3 ${cardBg}`}>
              <Link to={`/task/${t.id}`} className="block">
                <p className="text-gray-900" dangerouslySetInnerHTML={{ __html: formatRichText(t.title) }} />
                {t.subactivity && <p className="text-sm text-gray-500">{t.subactivity}</p>}
                <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
                  <ProjectChip name={projectName(t.project_id)} color={projectColor(t.project_id)} />
                  <span className="text-gray-400">·</span>
                  <span className="text-purple-700 font-medium">{personName(t.responsible_id)}</span>
                  {shownDate && (
                    <>
                      <span className="text-gray-400">·</span>
                      <span className={postponed ? 'text-amber-700 font-medium' : overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                        {postponed ? '⏸ pospuesta hasta el ' : overdue ? 'venció el ' : 'vence '}
                        {new Date(shownDate + 'T00:00:00').toLocaleDateString()}
                      </span>
                    </>
                  )}
                  <span className="ml-auto text-xs text-gray-700" title={formatTaskAge(t.created_at).full}>
                    {formatTaskAge(t.created_at).label}
                  </span>
                </div>
              </Link>
              {shownDate && (
                <a href={googleCalendarUrl({
                    title: t.title,
                    dueDate: shownDate,
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
