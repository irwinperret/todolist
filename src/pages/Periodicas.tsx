import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskScore } from '../lib/types'
import { PRIORITY_COLORS } from '../lib/types'
import { isOverdue } from '../lib/calendar'

const RUTINA_STATUS_ID = 10

export default function Periodicas() {
  const { projects, people, statuses, priorities } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = () => {
    setLoading(true)
    supabase
      .from('task_scores')
      .select('*')
      .eq('status_id', RUTINA_STATUS_ID)
      .eq('archived', false)
      .order('priority_score', { ascending: false })
      .then(({ data }) => {
        setTasks((data as TaskScore[]) ?? [])
        setLoading(false)
      })
  }

  useEffect(() => {
    load()
  }, [])

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—'

  const updateStatus = async (taskId: string, newStatusId: number) => {
    await supabase.from('tasks').update({ status_id: newStatusId }).eq('id', taskId)
    load()
  }

  const updatePriority = async (taskId: string, newPriorityId: number) => {
    await supabase.from('tasks').update({ priority_id: newPriorityId }).eq('id', taskId)
    load()
  }

  const filtered = tasks.filter((t) => {
    if (!search) return true
    const s = search.toLowerCase()
    const hay = `${t.title} ${t.subactivity ?? ''} ${t.comment ?? ''} ${projectName(t.project_id)} ${personName(t.responsible_id)}`.toLowerCase()
    return hay.includes(s)
  })

  return (
    <div className="px-4 pt-4 space-y-3">
      <input
        type="text"
        placeholder="Buscar..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base bg-white"
      />

      {loading && <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Nada periódico por ahora.</p>
      )}

      <div className="space-y-2">
        {filtered.map((t) => {
          const overdue = isOverdue(t.due_date, t.status_id)
          const isPrelada = t.pending_dependency_count > 0 || t.status_id === 6
          const today = new Date().toISOString().slice(0, 10)
          const hasFollowUp = Boolean(t.follow_up_date) && t.follow_up_date! > today && t.status_id !== 8
          const cardBg = overdue
            ? 'bg-red-50 border-red-300'
            : isPrelada
            ? 'bg-gray-200 border-gray-400'
            : hasFollowUp
            ? 'bg-orange-50 border-orange-300'
            : 'bg-white border-gray-200'
          return (
          <Link
            key={t.id}
            to={`/task/${t.id}`}
            className={`block border rounded-xl p-3 active:bg-gray-50 ${cardBg}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{t.title}</p>
                {t.subactivity && <p className="text-sm text-gray-500">{t.subactivity}</p>}
              </div>

              <div
                className="flex items-center gap-1 shrink-0"
                onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
              >
                <select
                  value={t.status_id}
                  onChange={(e) => updateStatus(t.id, Number(e.target.value))}
                  className="text-xs bg-amber-100 text-amber-800 font-medium rounded-full pl-2 pr-1 py-0.5 border-0 appearance-none"
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <select
                  value={t.priority_id}
                  onChange={(e) => updatePriority(t.id, Number(e.target.value))}
                  className={`text-xs text-white font-medium rounded-full pl-2 pr-1 py-0.5 border-0 appearance-none ${PRIORITY_COLORS[t.priority_id] ?? 'bg-gray-400'}`}
                >
                  {priorities.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400 flex-wrap">
              <span className="text-blue-700 font-medium">{projectName(t.project_id)}</span>
              <span>·</span>
              <span className="text-purple-700 font-medium">{personName(t.responsible_id)}</span>
              {t.rutina_frequency && (
                <>
                  <span>·</span>
                  <span className="text-gray-600 font-medium">{t.rutina_frequency}</span>
                </>
              )}
              {t.due_date && (
                <>
                  <span>·</span>
                  <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                    {overdue ? 'venció el ' : 'vence '}
                    {new Date(t.due_date + 'T00:00:00').toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
          </Link>
          )
        })}
      </div>
    </div>
  )
}
