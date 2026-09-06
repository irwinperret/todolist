import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { Meeting, MeetingMinute, MeetingItem, TaskScore } from '../lib/types'

const todayStr = () => new Date().toISOString().slice(0, 10)

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
  const [itemTexts, setItemTexts] = useState<string[]>([''])
  const [saving, setSaving] = useState(false)

  // which item (by temp key `${minuteId}:${itemId}`) has its "convertir en
  // tarea" mini-form open right now
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

  const updateItemText = (idx: number, value: string) => {
    setItemTexts((prev) => prev.map((t, i) => (i === idx ? value : t)))
  }

  const addItemRow = () => setItemTexts((prev) => [...prev, ''])
  const removeItemRow = (idx: number) =>
    setItemTexts((prev) => prev.filter((_, i) => i !== idx))

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

    const validItems = itemTexts.map((t) => t.trim()).filter(Boolean)
    if (validItems.length > 0) {
      await supabase
        .from('meeting_items')
        .insert(validItems.map((content) => ({ meeting_minute_id: minute.id, content })))
    }

    setSaving(false)
    setMeetingDate(todayStr())
    setAttendees('')
    setMinutaText('')
    setAcuerdos('')
    setItemTexts([''])
    setShowForm(false)
    load()
  }

  const handleDeleteMinute = async (minuteId: string) => {
    if (!confirm('¿Borrar esta minuta y sus items? Las tareas ya creadas NO se borran, solo se desvinculan. No se puede deshacer.')) return
    await supabase.from('meeting_minutes').delete().eq('id', minuteId)
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
              Items puntuales (algunos se pueden convertir en tareas después)
            </p>
            {itemTexts.map((t, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  placeholder={`Item ${idx + 1}`}
                  value={t}
                  onChange={(e) => updateItemText(idx, e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {itemTexts.length > 1 && (
                  <button onClick={() => removeItemRow(idx)} className="text-gray-400 px-2">✕</button>
                )}
              </div>
            ))}
            <button onClick={addItemRow} className="text-xs text-blue-600">+ Agregar item</button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 border border-gray-300 rounded-lg py-2.5 text-sm"
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
          <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900">
                {new Date(m.meeting_date + 'T00:00:00').toLocaleDateString('es-ES', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <button onClick={() => handleDeleteMinute(m.id)} className="text-xs text-red-500">
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

            {m.items.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-100">
                {m.items.map((item) => {
                  const task = item.task_id ? taskById[item.task_id] : null
                  return (
                    <div key={item.id} className="text-sm">
                      {task ? (
                        <Link
                          to={`/task/${task.id}`}
                          className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2"
                        >
                          <span className="text-gray-800 truncate">{item.content}</span>
                          <span className="text-xs bg-gray-800 text-white rounded-full px-2 py-0.5 shrink-0">
                            {task.status_label}
                          </span>
                        </Link>
                      ) : convertingItemId === item.id ? (
                        <div className="border border-gray-200 rounded-lg p-2 space-y-2">
                          <p className="text-gray-800">{item.content}</p>
                          <select
                            value={convProject}
                            onChange={(e) => setConvProject(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          >
                            <option value="">Proyecto *</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          <select
                            value={convResponsible}
                            onChange={(e) => setConvResponsible(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          >
                            <option value="">Responsable *</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={convPriority}
                              onChange={(e) => setConvPriority(Number(e.target.value))}
                              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                            >
                              {priorities.map((p) => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                              ))}
                            </select>
                            <select
                              value={convStatus}
                              onChange={(e) => setConvStatus(Number(e.target.value))}
                              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                            >
                              {statuses.map((s) => (
                                <option key={s.id} value={s.id}>{s.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setConvertingItemId(null)}
                              className="flex-1 border border-gray-300 rounded-lg py-1.5 text-xs"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => confirmConvert(item)}
                              className="flex-1 bg-gray-900 text-white rounded-lg py-1.5 text-xs"
                            >
                              Crear tarea
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-700">• {item.content}</span>
                          <button
                            onClick={() => openConvert(item)}
                            className="text-xs text-blue-600 shrink-0"
                          >
                            Convertir en tarea
                          </button>
                        </div>
                      )}
                      {task && (
                        <button
                          onClick={() => unlinkItem(item)}
                          className="text-xs text-gray-400 mt-1 ml-1"
                        >
                          Desvincular
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
