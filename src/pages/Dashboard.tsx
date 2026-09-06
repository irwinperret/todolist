import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskScore } from '../lib/types'
import PriorityBadge from '../components/PriorityBadge'

const ME_DEBEN_STATUS_ID = 3

export default function Dashboard() {
  const { projects, people, statuses } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showMeDeben, setShowMeDeben] = useState(false)
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

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      // "Me deben" is a separate bucket from your own to-dos: shown only
      // when the toggle is on, and hidden from the normal list otherwise.
      if (showMeDeben) {
        if (t.status_id !== ME_DEBEN_STATUS_ID) return false
      } else {
        if (t.status_id === ME_DEBEN_STATUS_ID) return false
      }

      if (projectFilter && t.project_id !== projectFilter) return false
      if (personFilter && t.responsible_id !== personFilter) return false
      if (statusFilter && String(t.status_id) !== statusFilter) return false
      if (search) {
        const s = search.toLowerCase()
        const hay = `${t.title} ${t.subactivity ?? ''} ${t.comment ?? ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [tasks, projectFilter, personFilter, statusFilter, search, showMeDeben])

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
          onClick={() => setShowMeDeben((v) => !v)}
          className={`flex-1 rounded-lg py-2 text-sm border font-medium ${
            showMeDeben
              ? 'bg-[#e8ddd3] text-red-900 border-[#d8c7b5]'
              : 'bg-white text-red-800 border-gray-300'
          }`}
        >
          Me deben
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
        <p className="text-gray-400 text-sm py-8 text-center">
          {showMeDeben ? 'Nadie te debe nada por ahora.' : 'Nada por aquí.'}
        </p>
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
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400 flex-wrap">
              <span className="text-blue-700 font-medium">{projectName(t.project_id)}</span>
              <span>·</span>
              <span className="text-purple-700 font-medium">{personName(t.responsible_id)}</span>
              <span>·</span>
              <span className="text-amber-700 font-medium">{t.status_label}</span>
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
