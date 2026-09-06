import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskScore } from '../lib/types'
import PriorityBadge from '../components/PriorityBadge'

const FOLLOWUP_STALE_DAYS = 14

export default function Dashboard() {
  const { projects, people, statuses } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showFollowupOnly, setShowFollowupOnly] = useState(false)
  const [search, setSearch] = useState('')

  const [projectFilter, setProjectFilter] = useState('')
  const [personFilter, setPersonFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('task_scores')
      .select('*')
      .eq('archived', false)
      .neq('status_id', 8) // exclude Completada
      .order('priority_score', { ascending: false })

    if (!error) setTasks((data as TaskScore[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const lastFollowupByTask = useLastFollowupMap(tasks.map((t) => t.id))

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (projectFilter && t.project_id !== projectFilter) return false
      if (personFilter && t.responsible_id !== personFilter) return false
      if (statusFilter && String(t.status_id) !== statusFilter) return false
      if (search) {
        const s = search.toLowerCase()
        const hay = `${t.title} ${t.subactivity ?? ''} ${t.comment ?? ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      if (showFollowupOnly) {
        const isOverdueFollowup = t.follow_up_date && new Date(t.follow_up_date) <= new Date()
        const lastTouch = lastFollowupByTask[t.id] ?? t.created_at
        const daysSince = (Date.now() - new Date(lastTouch).getTime()) / (1000 * 60 * 60 * 24)
        const isStaleAndUrgent = t.priority_score >= 50 && daysSince >= FOLLOWUP_STALE_DAYS
        if (!isOverdueFollowup && !isStaleAndUrgent) return false
      }
      return true
    })
  }, [tasks, projectFilter, personFilter, statusFilter, search, showFollowupOnly, lastFollowupByTask])

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—'

  return (
    <div className="px-4 pt-4 space-y-3">
      <input
        type="text"
        placeholder="Buscar..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base bg-white"
      />

      <div className="flex gap-2">
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex-1 border border-gray-300 rounded-lg py-2 text-sm bg-white"
        >
          Filtros {filtersOpen ? '▲' : '▼'}
        </button>
        <button
          onClick={() => setShowFollowupOnly((v) => !v)}
          className={`flex-1 rounded-lg py-2 text-sm border ${
            showFollowupOnly ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'
          }`}
        >
          Requiere seguimiento
        </button>
      </div>

      {filtersOpen && (
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos los proyectos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos los responsables</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos los status</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      {loading && <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Nada por aquí.</p>
      )}

      <div className="space-y-2">
        {filtered.map((t) => (
          <Link
            key={t.id}
            to={`/task/${t.id}`}
            className="block bg-white border border-gray-200 rounded-xl p-3 active:bg-gray-50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{t.title}</p>
                {t.subactivity && (
                  <p className="text-sm text-gray-500 truncate">{t.subactivity}</p>
                )}
              </div>
              <PriorityBadge id={t.priority_id} label={t.priority_label} />
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
              <span>{projectName(t.project_id)}</span>
              <span>·</span>
              <span>{personName(t.responsible_id)}</span>
              <span>·</span>
              <span>{t.status_label}</span>
              {t.due_date && (
                <>
                  <span>·</span>
                  <span>vence {new Date(t.due_date).toLocaleDateString()}</span>
                </>
              )}
              {t.blocking_count > 0 && (
                <>
                  <span>·</span>
                  <span className="text-red-500 font-medium">
                    bloquea {t.blocking_count} {t.blocking_count === 1 ? 'tarea' : 'tareas'}
                  </span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// fetches only the most recent followup timestamp per task, to power the
// "needs follow-up" heuristic without pulling the full followup log
function useLastFollowupMap(taskIds: string[]) {
  const [map, setMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (taskIds.length === 0) return
    supabase
      .from('task_followups')
      .select('task_id, created_at')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        const m: Record<string, string> = {}
        for (const row of data as { task_id: string; created_at: string }[]) {
          if (!m[row.task_id]) m[row.task_id] = row.created_at
        }
        setMap(m)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskIds.join(',')])

  return map
}
