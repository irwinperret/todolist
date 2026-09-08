import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { Person, TaskScore } from '../lib/types'
import { PRIORITY_COLORS } from '../lib/types'
import { isOverdue } from '../lib/calendar'
import { getFreedTasks, type FreedTask } from '../lib/dependencies'
import FreedTasksModal from '../components/FreedTasksModal'

const REVISAR_STATUS_ID = 4
const LARGO_PLAZO_STATUS_ID = 9
const RUTINA_STATUS_ID = 10

type Bucket = 'none' | 'meDeben' | 'revision' | 'largoPlazo'
type ContactAction = 'call' | 'whatsapp-call' | 'whatsapp-message' | 'email'

export default function Dashboard() {
  const navigate = useNavigate()
  const { projects, people, statuses, priorities } = useLookups()
  const [tasks, setTasks] = useState<TaskScore[]>([])
  const [loading, setLoading] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bucket, setBucket] = useState<Bucket>('none')
  const [search, setSearch] = useState('')
  const [contactPerson, setContactPerson] = useState<Person | null>(null)
  const [freedTasks, setFreedTasks] = useState<FreedTask[] | null>(null)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

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

  const updateStatus = async (taskId: string, newStatusId: number, blockingCount: number) => {
    const payload: { status_id: number; resolved_at?: string; rutina_frequency?: string | null } =
      newStatusId === 8 ? { status_id: 8, resolved_at: new Date().toISOString() } : { status_id: newStatusId }

    if (newStatusId === RUTINA_STATUS_ID) {
      const freq = window.prompt('¿Cada cuánto tiempo es esta rutina? (ej. Semanal, Mensual, cada 3 meses)')
      payload.rutina_frequency = freq?.trim() || null
    }

    const { error } = await supabase.from('tasks').update(payload).eq('id', taskId)
    if (error) {
      alert(error.message)
      return
    }

    // A task shown in the main To Do can also be linked to one or more
    // meeting-minute items. Keep the minute checkbox synchronized with the
    // task's completion state when the status is changed here.
    const { error: meetingItemsError } = await supabase
      .from('meeting_items')
      .update({ is_done: newStatusId === 8 })
      .eq('task_id', taskId)

    if (meetingItemsError) {
      alert(meetingItemsError.message)
      return
    }

    // Keep prelaciones in sync too: resolve them when this task is completed,
    // reactivate them if it's reopened.
    if (newStatusId === 8) {
      await supabase
        .from('task_dependencies')
        .update({ resolved_at: new Date().toISOString() })
        .eq('depends_on_task_id', taskId)
        .is('resolved_at', null)
      const freed = blockingCount > 0 ? await getFreedTasks(taskId) : []
      if (freed.length > 0) setFreedTasks(freed)
    } else {
      await supabase.from('task_dependencies').update({ resolved_at: null }).eq('depends_on_task_id', taskId)
    }

    load()
  }

  const updatePriority = async (taskId: string, newPriorityId: number) => {
    const { error } = await supabase.from('tasks').update({ priority_id: newPriorityId }).eq('id', taskId)
    if (error) return alert(error.message)
    load()
  }

  const toggleBucket = (b: Bucket) => {
    setBucket((current) => (current === b ? 'none' : b))
  }

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  const personForTask = (id: string | null) => people.find((p) => p.id === id) ?? null
  const ipaPersonId = people.find((p) => p.name.trim().toUpperCase() === 'IPA')?.id

  // "Me deben" includes status Me deben always, and status Recurrente only
  // when it's not something IPA does themselves (those stay in the normal To Do).
  const belongsToMeDeben = (t: TaskScore) =>
    t.status_id === 3 || (t.status_id === 5 && t.responsible_id !== ipaPersonId)

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      // "Me deben" and "Pendiente Revisión" are separate buckets from your
      // own to-dos: each shown only when its toggle is active, and both
      // hidden from the normal list otherwise.
      if (bucket === 'meDeben') {
        if (!belongsToMeDeben(t)) return false
      } else if (bucket === 'revision') {
        if (t.status_id !== REVISAR_STATUS_ID) return false
      } else if (bucket === 'largoPlazo') {
        if (t.status_id !== LARGO_PLAZO_STATUS_ID) return false
      } else {
        if (
          belongsToMeDeben(t) ||
          t.status_id === REVISAR_STATUS_ID ||
          t.status_id === LARGO_PLAZO_STATUS_ID ||
          t.status_id === RUTINA_STATUS_ID
        ) return false
      }

      if (projectFilter && t.project_id !== projectFilter) return false
      if (personFilter && t.responsible_id !== personFilter) return false
      if (statusFilter && String(t.status_id) !== statusFilter) return false
      if (search) {
        const s = search.toLowerCase()
        const responsibleName = people.find((p) => p.id === t.responsible_id)?.name ?? ''
        const hay = `${t.title} ${t.subactivity ?? ''} ${t.comment ?? ''} ${projectName(t.project_id)} ${responsibleName}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [tasks, projectFilter, personFilter, statusFilter, search, bucket, projects, people])

  const isDesktop = () => !/Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent)

  const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '')

  const showDesktopWarning = (message: string) => {
    window.alert(message)
  }

  const handleContactAction = (action: ContactAction) => {
    if (!contactPerson) return

    const phone = contactPerson.phone ? normalizePhone(contactPerson.phone) : ''
    const encodedEmail = contactPerson.email ? encodeURIComponent(contactPerson.email) : ''

    if (action === 'email' && contactPerson.email) {
      window.location.href = `mailto:${encodedEmail}`
      setContactPerson(null)
      return
    }

    if ((action === 'call' || action === 'whatsapp-call' || action === 'whatsapp-message') && !phone) {
      showDesktopWarning('Este responsable no tiene un número de teléfono registrado.')
      return
    }

    if (action === 'call') {
      if (isDesktop()) {
        showDesktopWarning('Las llamadas por línea normal no están disponibles desde la computadora. Usa WhatsApp Desktop para llamar.')
        return
      }
      window.location.href = `tel:+${phone}`
      setContactPerson(null)
      return
    }

    if (action === 'whatsapp-message') {
      window.location.href = `https://wa.me/${phone}`
      setContactPerson(null)
      return
    }

    // WhatsApp calls require the WhatsApp application. On desktop we use
    // the app protocol so the browser does not fall back to a web call.
    if (action === 'whatsapp-call') {
      if (isDesktop()) {
        let appOpened = false
        const handleVisibility = () => { appOpened = true }
        document.addEventListener('visibilitychange', handleVisibility, { once: true })
        window.location.href = `whatsapp://call?phone=${phone}`
        window.setTimeout(() => {
          document.removeEventListener('visibilitychange', handleVisibility)
          if (!appOpened) {
            showDesktopWarning('No se pudo abrir WhatsApp Desktop. Para hacer llamadas desde la computadora debes tener la aplicación de WhatsApp Desktop instalada y configurada.')
          }
        }, 1800)
      } else {
        window.location.href = `whatsapp://call?phone=${phone}`
      }
      setContactPerson(null)
    }
  }

  const emptyMessage =
    bucket === 'meDeben'
      ? 'Nadie te debe nada por ahora.'
      : bucket === 'revision'
      ? 'Nada pendiente de revisión.'
      : bucket === 'largoPlazo'
      ? 'Nada a largo plazo por ahora.'
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
        <button
          onClick={() => toggleBucket('largoPlazo')}
          className={`flex-1 rounded-lg py-2 text-sm border font-medium ${
            bucket === 'largoPlazo'
              ? 'bg-gray-300 text-gray-700 border-gray-400'
              : 'bg-white text-gray-500 border-gray-300'
          }`}
        >
          Largo Plazo
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
        {filtered.map((t) => {
          const person = personForTask(t.responsible_id)
          const indirectPerson = personForTask(t.indirect_id)
          const hasContact = Boolean(person?.email || person?.phone)
          const isExpanded = expandedTaskId === t.id
          const overdue = isOverdue(t.due_date, t.status_id)
          const isPrelada = t.pending_dependency_count > 0
          const cardBg = overdue
            ? 'bg-red-50 border-red-300'
            : isPrelada
            ? 'bg-gray-100 border-gray-300'
            : 'bg-white border-gray-200'

          return (
            <div
              key={t.id}
              onClick={() => {
                if (isExpanded) navigate(`/task/${t.id}`)
                else setExpandedTaskId(t.id)
              }}
              className={`block border rounded-xl p-3 active:bg-gray-50 cursor-pointer ${cardBg}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{t.title}</p>
                  {t.subactivity && (
                    <p className="text-sm text-gray-500">{t.subactivity}</p>
                  )}
                </div>

                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                >
                  <select
                    value={t.status_id}
                    onChange={(e) => updateStatus(t.id, Number(e.target.value), t.blocking_count)}
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
                {hasContact ? (
                  <button
                    type="button"
                    className="text-purple-700 font-medium underline underline-offset-2 hover:text-purple-900"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setContactPerson(person)
                    }}
                  >
                    {person?.name}
                  </button>
                ) : (
                  <span className="text-purple-700 font-medium">{person?.name ?? '—'}</span>
                )}
                {t.due_date && (
                  <>
                    <span>·</span>
                    <span className={isOverdue(t.due_date, t.status_id) ? 'text-red-600 font-semibold' : ''}>
                      {isOverdue(t.due_date, t.status_id) ? 'venció el ' : 'vence '}
                      {new Date(t.due_date + 'T00:00:00').toLocaleDateString()}
                    </span>
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

              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm">
                  {person && (
                    <p>
                      <span className="text-gray-400">Subcontratista/responsable: </span>
                      <span className="text-gray-800">{person.name}{person.role ? ` (${person.role})` : ''}</span>
                    </p>
                  )}
                  {indirectPerson && (
                    <p>
                      <span className="text-gray-400">Involucrado: </span>
                      <span className="text-gray-800">{indirectPerson.name}</span>
                    </p>
                  )}
                  {t.discipline && (
                    <p><span className="text-gray-400">Disciplina: </span><span className="text-gray-800">{t.discipline}</span></p>
                  )}
                  {t.location && (
                    <p><span className="text-gray-400">Ubicación: </span><span className="text-gray-800">{t.location}</span></p>
                  )}
                  {t.follow_up_date && (
                    <p><span className="text-gray-400">Seguimiento: </span><span className="text-gray-800">{new Date(t.follow_up_date).toLocaleDateString()}</span></p>
                  )}
                  {t.comment && (
                    <div>
                      <p className="text-gray-400">Notas:</p>
                      <p className="text-gray-800 whitespace-pre-wrap">{t.comment}</p>
                    </div>
                  )}
                  {t.resolution_notes && (
                    <div>
                      <p className="text-gray-400">Resolución:</p>
                      <p className="text-gray-800 whitespace-pre-wrap">{t.resolution_notes}</p>
                    </div>
                  )}
                  {!person && !indirectPerson && !t.discipline && !t.location && !t.follow_up_date && !t.comment && !t.resolution_notes && (
                    <p className="text-gray-400 italic">Sin más detalle agregado.</p>
                  )}
                  <p className="text-xs text-gray-300 pt-1">Toca de nuevo para editar</p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {contactPerson && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
          onClick={() => setContactPerson(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Contactar a {contactPerson.name}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {contactPerson.phone || contactPerson.email || 'Sin datos de contacto'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setContactPerson(null)}
                className="text-gray-400 text-xl px-2"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            {contactPerson.phone && (
              <>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Llamar</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleContactAction('call')}
                    className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium bg-white"
                  >
                    ☎️ Línea normal
                  </button>
                  <button
                    type="button"
                    onClick={() => handleContactAction('whatsapp-call')}
                    className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium bg-white"
                  >
                    📞 WhatsApp
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleContactAction('whatsapp-message')}
                  className="w-full rounded-lg px-3 py-2.5 text-sm font-medium bg-gray-900 text-white"
                >
                  💬 Mensaje por WhatsApp
                </button>
              </>
            )}

            {contactPerson.email && (
              <button
                type="button"
                onClick={() => handleContactAction('email')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium bg-white"
              >
                ✉️ Enviar email
              </button>
            )}
          </div>
        </div>
      )}

      {freedTasks && <FreedTasksModal tasks={freedTasks} onClose={() => setFreedTasks(null)} />}
    </div>
  )
}