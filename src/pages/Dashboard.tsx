import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskScore } from '../lib/types'
import PriorityBadge from '../components/PriorityBadge'

const ME_DEBEN_STATUS_IDS = [3, 5] // Me deben, Recurrente
const REVISAR_STATUS_ID = 4

type Bucket = 'none' | 'meDeben' | 'revision'

export default function Dashboard() {
  const { projects, people, statuses } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bucket, setBucket] = useState<Bucket>('none')
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

  const updateStatus = async (taskId: string, newStatusId: number) => {
    const payload: { status_id: number; resolved_at?: string } =
      newStatusId === 8 ? { status_id: 8, resolved_at: new Date().toISOString() } : { status_id: newStatusId }
    await supabase.from('tasks').update(payload).eq('id', taskId)
    load()
  }

  const toggleBucket = (b: Bucket) => {
    setBucket((current) => (current === b ? 'none' : b))
  }

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      // "Me deben" and "Pendiente Revisión" are separate buckets from your
      // own to-dos: each shown only when its toggle is active, and both
      // hidden from the normal list otherwise.
      if (bucket === 'meDeben') {
        if (!ME_DEBEN_STATUS_IDS.includes(t.status_id)) return false
      } else if (bucket === 'revision') {
        if (t.status_id !== REVISAR_STATUS_ID) return false
      } else {
        if (ME_DEBEN_STATUS_IDS.includes(t.status_id) || t.status_id === REVISAR_STATUS_ID) return false
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
  }, [tasks, projectFilter, personFilter, statusFilter, search, bucket])

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—'

  const emptyMessage =
    bucket === 'meDeben'
      ? 'Nadie te debe nada por ahora.'
      : bucket === 'revision'
      ? 'Nada pendiente de revisión.'
      : 'Nada por aquí.'

  return (
    <div className="px-4 pt-4 space-y-3">
      <input
        type="text"
        placeholder="Buscar..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base bg-white"
      />

      <button
        onClick={() => setFiltersOpen((v) => !v)}
        className="w-full border border-gray-300 rounded-lg py-2 text-sm bg-white"
      >
        Filtros {filtersOpen ? '▲' : '▼'}
      </button>

      <div className="flex gap-2">
        <button
          onClick={() => setBucket('none')}
          className={`flex-1 rounded-lg py-2 text-sm border font-medium ${
            bucket === 'none'
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white text-gray-700 border-gray-300'
          }`}
        >
          IPA
        </button>
        <button
          onClick={() => toggleBucket('revision')}
          className={`flex-1 rounded-lg py-2 text-sm border font-medium ${
            bucket === 'revision'
              ? 'bg-[#dbe7f0] text-blue-900 border-[#c3d8e6]'
              : 'bg-white text-blue-800 border-gray-300'
          }`}
        >
          Pendiente Revisión
        </button>
        <button
          onClick={() => toggleBucket('meDeben')}
          className={`flex-1 rounded-lg py-2 text-sm border font-medium ${
            bucket === 'meDeben'
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
        <p className="text-gray-400 text-sm py-8 text-center">{emptyMessage}</p>
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
                <PriorityBadge id={t.priority_id} label={t.priority_label} />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400 flex-wrap">
              <span className="text-blue-700 font-medium">{projectName(t.project_id)}</span>
              <span>·</span>
              <span className="text-purple-700 font-medium">{personName(t.responsible_id)}</span>
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
