import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskScore } from '../lib/types'
import PriorityBadge from '../components/PriorityBadge'

export default function Archive() {
  const { projects, people } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('task_scores')
      .select('*')
      .or('archived.eq.true,status_id.eq.8')
      .order('resolved_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        setTasks((data as TaskScore[]) ?? [])
        setLoading(false)
      })
  }, [])

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—'

  return (
    <div className="min-h-full bg-green-50 px-4 pt-4 space-y-2 pb-8">
      <h2 className="text-sm text-gray-500 mb-2">Completadas y archivadas</h2>
      {loading && <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>}
      {!loading && tasks.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Nada aquí todavía.</p>
      )}
      {tasks.map((t) => (
        <Link
          key={t.id}
          to={`/task/${t.id}`}
          className="block bg-white border border-gray-200 rounded-xl p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-gray-700 truncate">{t.title}</p>
            <PriorityBadge id={t.priority_id} label={t.priority_label} />
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
            <span>{projectName(t.project_id)}</span>
            <span>·</span>
            <span>{personName(t.responsible_id)}</span>
            {t.resolved_at && (
              <>
                <span>·</span>
                <span>resuelto {new Date(t.resolved_at).toLocaleDateString()}</span>
              </>
            )}
            {t.archived && <span className="text-gray-400">(archivado)</span>}
          </div>
          {t.resolution_notes && (
            <p className="text-xs text-gray-500 mt-1 italic">"{t.resolution_notes}"</p>
          )}
        </Link>
      ))}
    </div>
  )
}
