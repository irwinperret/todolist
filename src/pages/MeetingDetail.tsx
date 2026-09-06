import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { Meeting, MeetingMinute, MeetingItem, TaskScore } from '../lib/types'

const todayStr = () => new Date().toISOString().slice(0, 10)

type ItemRow = { content: string; group: string }
type MinuteWithItems = MeetingMinute & { items: MeetingItem[] }

export default function MeetingDetail() {
  const { id } = useParams()
  const { projects, people, statuses, priorities } = useLookups()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [minutes, setMinutes] = useState<MinuteWithItems[]>([])
  const [taskById, setTaskById] = useState<Record<string, TaskScore>>({})
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [meetingDate, setMeetingDate] = useState(todayStr())
  const [attendees, setAttendees] = useState('')
  const [minutaText, setMinutaText] = useState('')
  const [acuerdos, setAcuerdos] = useState('')
  const [itemRows, setItemRows] = useState<ItemRow[]>([{ content: '', group: '' }])
  const [saving, setSaving] = useState(false)

  const [convertingItemId, setConvertingItemId] = useState<string | null>(null)
  const [convProject, setConvProject] = useState('')
  const [convResponsible, setConvResponsible] = useState('')
  const [convStatus, setConvStatus] = useState<number>(2)
  const [convPriority, setConvPriority] = useState<number>(4)

  const load = async () => {
    setLoading(true)
    const { data: m } = await supabase.from('meetings').select('*').eq('id', id).single()
    setMeeting((m as Meeting) ?? null)

    const { data: mm } = await supabase
      .from('meeting_minutes')
      .select('*')
      .eq('meeting_id', id)
      .order('meeting_date', { ascending: false })
      .order('created_at', { ascending: false })
    const minuteRows = (mm as MeetingMinute[]) ?? []

    let itemsByMinute: Record<string, MeetingItem[]> = {}
    const taskIds: string[] = []
    if (minuteRows.length > 0) {
      const { data: items } = await supabase
        .from('meeting_items')
        .select('*')
        .in('meeting_minute_id', minuteRows.map((r) => r.id))
        .order('sort_order')
        .order('created_at')
      for (const it of (items as MeetingItem[]) ?? []) {
        itemsByMinute[it.meeting_minute_id] = itemsByMinute[it.meeting_minute_id] ?? []
        itemsByMinute[it.meeting_minute_id].push(it)
        if (it.task_id) taskIds.push(it.task_id)
      }
    }

    setMinutes(minuteRows.map((r) => ({ ...r, items: itemsByMinute[r.id] ?? [] })))

    if (taskIds.length > 0) {
      const { data: tasks } = await supabase.from('task_scores').select('*').in('id', taskIds)
      const map: Record<string, TaskScore> = {}
      for (const t of (tasks as TaskScore[]) ?? []) map[t.id] = t
      setTaskById(map)
    } else {
      setTaskById({})
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const updateItemRow = (idx: number, field: keyof ItemRow, value: string) => {
    setItemRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }
  const addItemRow = () => setItemRows((prev) => [...prev, { content: '', group: '' }])
  const removeItemRow = (idx: number) => setItemRows((prev) => prev.filter((_, i) => i !== idx))

  const handleSave = async () => {
    if (!minutaText.trim()) {
      alert('Escribe algo en la minuta.')
      return
    }
    setSaving(true)
    const { data: minute, error } = await supabase
      .from('meeting_minutes')
      .insert({
        meeting_id: id,
        meeting_date: meetingDate,
        attendees: attendees.trim() || null,
        minuta: minutaText.trim(),
        acuerdos: acuerdos.trim() || null,
      })
      .select()
      .single()

    if (error) {
      setSaving(false)
      return alert(error.message)
    }

    const validItems = itemRows.filter((r) => r.content.trim())
    if (validItems.length > 0) {
      await supabase.from('meeting_items').insert(
        validItems.map((r, idx) => ({
          meeting_minute_id: minute.id,
          content: r.content.trim(),
          group_label: r.group.trim() || null,
          sort_order: idx,
        }))
      )
    }

    setSaving(false)
    setMeetingDate(todayStr())
    setAttendees('')
    setMinutaText('')
    setAcuerdos('')
    setItemRows([{ content: '', group: '' }])
    setShowForm(false)
    load()
  }

  const handleDeleteMinute = async (minuteId: string) => {
    if (!confirm('¿Borrar esta minuta y sus items? Las tareas ya creadas NO se borran, solo se desvinculan. No se puede deshacer.')) return
    await supabase.from('meeting_minutes').delete().eq('id', minuteId)
    load()
  }

  const toggleDone = async (item: MeetingItem) => {
    await supabase.from('meeting_items').update({ is_done: !item.is_done }).eq('id', item.id)
    load()
  }

  const openConvert = (item: MeetingItem) => {
    setConvertingItemId(item.id)
    setConvProject('')
    setConvResponsible('')
    setConvStatus(2)
    setConvPriority(4)
  }

  const confirmConvert = async (item: MeetingItem) => {
    if (!convProject || !convResponsible) {
      alert('Selecciona proyecto y responsable.')
      return
    }
    const { data: task, error } = await supabase
      .from('tasks')
      .insert({
        title: item.content,
        project_id: convProject,
        responsible_id: convResponsible,
        status_id: convStatus,
        priority_id: convPriority,
      })
      .select()
      .single()

    if (error) return alert(error.message)

    await supabase.from('meeting_items').update({ task_id: task.id }).eq('id', item.id)
    setConvertingItemId(null)
    load()
  }

  const unlinkItem = async (item: MeetingItem) => {
    if (!confirm('¿Desvincular esta tarea del item? La tarea sigue existiendo en el To Do, solo deja de mostrarse aquí.')) return
    await supabase.from('meeting_items').update({ task_id: null }).eq('id', item.id)
    load()
  }

  if (loading) return <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>
  if (!meeting) return <p className="text-gray-400 text-sm py-8 text-center">Reunión no encontrada.</p>

  return (
    <div className="px-4 pt-4 space-y-4 pb-8">
      <h2 className="text-lg font-semibold text-gray-900">{meeting.name}</h2>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full bg-gray-900 text-white rounded-lg py-3 font-medium"
        >
          + Nueva minuta
        </button>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500">Fecha</label>
            <input
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            />
          </div>
          <input
            type="text"
            placeholder="Asistentes (opcional)"
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
          />
          <textarea
            placeholder="Minuta / temas tratados"
            value={minutaText}
            onChange={(e) => setMinutaText(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            rows={4}
          />
          <textarea
            placeholder="Acuerdos generales (opcional)"
            value={acuerdos}
            onChange={(e) => setAcuerdos(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            rows={2}
          />

          <div className="space-y-2 pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Items del checklist. El grupo (opcional) organiza los items en secciones, ej. "IPA", "FENOFF - Safety"
            </p>
            {itemRows.map((r, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Grupo (opcional)"
                  value={r.group}
                  onChange={(e) => updateItemRow(idx, 'group', e.target.value)}
                  className="w-28 border border-gray-300 rounded-lg px-2 py-2 text-xs"
                />
                <input
                  type="text"
                  placeholder={`Item ${idx + 1}`}
                  value={r.content}
                  onChange={(e) => updateItemRow(idx, 'content', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {itemRows.length > 1 && (
                  <button onClick={() => removeItemRow(idx)} className="text-gray-400 px-2">✕</button>
                )}
              </div>
            ))}
            <button onClick={addItemRow} className="text-xs text-blue-600">+ Agregar item</button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 border border-red-900 text-red-900 rounded-lg py-2.5 text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-gray-900 text-white rounded-lg py-2.5 text-sm disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar minuta'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {minutes.length === 0 && (
          <p className="text-gray-400 text-sm py-8 text-center">Sin minutas todavía.</p>
        )}
        {minutes.map((m) => (
          <MinuteCard
            key={m.id}
            minute={m}
            taskById={taskById}
            onDeleteMinute={handleDeleteMinute}
            onToggleDone={toggleDone}
            onUnlink={unlinkItem}
            convertingItemId={convertingItemId}
            onOpenConvert={openConvert}
            onCancelConvert={() => setConvertingItemId(null)}
            onConfirmConvert={confirmConvert}
            projects={projects}
            people={people}
            statuses={statuses}
            priorities={priorities}
            convProject={convProject}
            setConvProject={setConvProject}
            convResponsible={convResponsible}
            setConvResponsible={setConvResponsible}
            convStatus={convStatus}
            setConvStatus={setConvStatus}
            convPriority={convPriority}
            setConvPriority={setConvPriority}
          />
        ))}
      </div>
    </div>
  )
}

function MinuteCard(props: {
  minute: MinuteWithItems
  taskById: Record<string, TaskScore>
  onDeleteMinute: (id: string) => void
  onToggleDone: (item: MeetingItem) => void
  onUnlink: (item: MeetingItem) => void
  convertingItemId: string | null
  onOpenConvert: (item: MeetingItem) => void
  onCancelConvert: () => void
  onConfirmConvert: (item: MeetingItem) => void
  projects: { id: string; name: string }[]
  people: { id: string; name: string }[]
  statuses: { id: number; label: string }[]
  priorities: { id: number; label: string }[]
  convProject: string
  setConvProject: (v: string) => void
  convResponsible: string
  setConvResponsible: (v: string) => void
  convStatus: number
  setConvStatus: (v: number) => void
  convPriority: number
  setConvPriority: (v: number) => void
}) {
  const { minute: m, taskById } = props

  const groups = useMemo(() => {
    const order: string[] = []
    const map: Record<string, MeetingItem[]> = {}
    for (const item of m.items) {
      const key = item.group_label ?? 'General'
      if (!map[key]) {
        map[key] = []
        order.push(key)
      }
      map[key].push(item)
    }
    return order.map((key) => ({ key, items: map[key] }))
  }, [m.items])

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">
          {new Date(m.meeting_date + 'T00:00:00').toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
        <button onClick={() => props.onDeleteMinute(m.id)} className="text-xs text-red-500">
          Borrar
        </button>
      </div>
      {m.attendees && (
        <p className="text-xs text-gray-500">
          <span className="font-medium">Asistentes:</span> {m.attendees}
        </p>
      )}
      <p className="text-sm text-gray-800 whitespace-pre-wrap">{m.minuta}</p>
      {m.acuerdos && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-2">
          <p className="text-xs font-medium text-amber-800 mb-1">Acuerdos generales</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{m.acuerdos}</p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-4 pt-2 border-t border-gray-100">
          {groups.map((g) => (
            <div key={g.key} className="space-y-1.5">
              {g.key !== 'General' && (
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{g.key}</p>
              )}
              {g.items.map((item) => {
                const task = item.task_id ? taskById[item.task_id] : null
                return (
                  <div key={item.id}>
                    {task ? (
                      <Link
                        to={`/task/${task.id}`}
                        className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2"
                      >
                        <span className="text-sm text-gray-800 truncate">{item.content}</span>
                        <span className="text-xs bg-gray-800 text-white rounded-full px-2 py-0.5 shrink-0">
                          {task.status_label}
                        </span>
                      </Link>
                    ) : props.convertingItemId === item.id ? (
                      <div className="border border-gray-200 rounded-lg p-2 space-y-2">
                        <p className="text-sm text-gray-800">{item.content}</p>
                        <select
                          value={props.convProject}
                          onChange={(e) => props.setConvProject(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="">Proyecto *</option>
                          {props.projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <select
                          value={props.convResponsible}
                          onChange={(e) => props.setConvResponsible(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="">Responsable *</option>
                          {props.people.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={props.convPriority}
                            onChange={(e) => props.setConvPriority(Number(e.target.value))}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          >
                            {props.priorities.map((p) => (
                              <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                          </select>
                          <select
                            value={props.convStatus}
                            onChange={(e) => props.setConvStatus(Number(e.target.value))}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          >
                            {props.statuses.map((s) => (
                              <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={props.onCancelConvert}
                            className="flex-1 border border-gray-300 rounded-lg py-1.5 text-xs"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => props.onConfirmConvert(item)}
                            className="flex-1 bg-gray-900 text-white rounded-lg py-1.5 text-xs"
                          >
                            Sincronizar con To Do
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={item.is_done}
                          onChange={() => props.onToggleDone(item)}
                          className="w-4 h-4 shrink-0"
                        />
                        <span
                          className={`text-sm flex-1 ${
                            item.is_done ? 'text-gray-400 line-through' : 'text-gray-800'
                          }`}
                        >
                          {item.content}
                        </span>
                        <button
                          onClick={() => props.onOpenConvert(item)}
                          className="text-xs text-blue-600 shrink-0"
                        >
                          Sincronizar
                        </button>
                      </div>
                    )}
                    {task && (
                      <button
                        onClick={() => props.onUnlink(item)}
                        className="text-xs text-gray-400 mt-1 ml-1"
                      >
                        Desvincular
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
