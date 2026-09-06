import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskFollowup, TaskPhoto, TaskScore } from '../lib/types'

export default function TaskDetail() {
  const { id } = useParams()
  const isNew = id === 'new' || !id
  const navigate = useNavigate()
  const { projects, people, statuses, priorities } = useLookups()

  const [task, setTask] = useState<Partial<TaskScore>>({
    title: '',
    subactivity: '',
    project_id: '',
    discipline: '',
    responsible_id: '',
    indirect_id: '',
    type: '',
    status_id: 2,
    priority_id: 4,
    location: '',
    comment: '',
    due_date: null,
    follow_up_date: null,
  })
  const [showMore, setShowMore] = useState(!isNew)
  const [followups, setFollowups] = useState<TaskFollowup[]>([])
  const [photos, setPhotos] = useState<TaskPhoto[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [resolutionPrompt, setResolutionPrompt] = useState(false)
  const [resolutionText, setResolutionText] = useState('')

  const load = async () => {
    if (isNew) return
    const { data } = await supabase.from('task_scores').select('*').eq('id', id).single()
    if (data) setTask(data as TaskScore)

    const { data: fu } = await supabase
      .from('task_followups')
      .select('*')
      .eq('task_id', id)
      .order('created_at', { ascending: false })
    setFollowups((fu as TaskFollowup[]) ?? [])

    const { data: ph } = await supabase
      .from('task_photos')
      .select('*')
      .eq('task_id', id)
      .order('uploaded_at', { ascending: false })
    setPhotos((ph as TaskPhoto[]) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    // resolve signed urls for photo thumbnails
    photos.forEach(async (p) => {
      if (photoUrls[p.id]) return
      const { data } = await supabase.storage
        .from('task-photos')
        .createSignedUrl(p.storage_path, 60 * 60)
      if (data?.signedUrl) {
        setPhotoUrls((prev) => ({ ...prev, [p.id]: data.signedUrl }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos])

  const handleSave = async () => {
    if (!task.title || !task.project_id || !task.responsible_id) {
      alert('Título, proyecto y responsable son obligatorios.')
      return
    }
    setSaving(true)
    const payload = {
      title: task.title,
      subactivity: task.subactivity || null,
      project_id: task.project_id,
      discipline: task.discipline || null,
      responsible_id: task.responsible_id,
      indirect_id: task.indirect_id || null,
      type: task.type || null,
      status_id: task.status_id,
      priority_id: task.priority_id,
      location: task.location || null,
      comment: task.comment || null,
      due_date: task.due_date || null,
      follow_up_date: task.follow_up_date || null,
    }

    if (isNew) {
      const { data, error } = await supabase.from('tasks').insert(payload).select().single()
      setSaving(false)
      if (error) return alert(error.message)
      navigate(`/task/${data.id}`, { replace: true })
    } else {
      const { error } = await supabase.from('tasks').update(payload).eq('id', id)
      setSaving(false)
      if (error) return alert(error.message)
      load()
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim() || isNew) return
    const { error } = await supabase.from('task_followups').insert({ task_id: id, note: newNote.trim() })
    if (!error) {
      setNewNote('')
      load()
    }
  }

  const handlePhotoUpload = async (file: File) => {
    if (isNew) {
      alert('Guarda la tarea primero antes de agregar fotos.')
      return
    }
    const path = `${id}/${Date.now()}_${file.name}`
    const { error: uploadError } = await supabase.storage.from('task-photos').upload(path, file)
    if (uploadError) return alert(uploadError.message)
    const { error } = await supabase.from('task_photos').insert({ task_id: id, storage_path: path })
    if (!error) load()
  }

  const handleComplete = async () => {
    setResolutionPrompt(true)
  }

  const confirmComplete = async () => {
    const { error } = await supabase
      .from('tasks')
      .update({ status_id: 8, resolved_at: new Date().toISOString(), resolution_notes: resolutionText || null })
      .eq('id', id)
    if (!error) {
      setResolutionPrompt(false)
      navigate('/')
    }
  }

  const handleReopen = async () => {
    await supabase.from('tasks').update({ status_id: 2, resolved_at: null }).eq('id', id)
    load()
  }

  const handleArchiveToggle = async () => {
    await supabase.from('tasks').update({ archived: !task.archived }).eq('id', id)
    navigate('/')
  }

  return (
    <div className="px-4 pt-4 pb-8 space-y-4">
      <div className="space-y-3 bg-white border border-gray-200 rounded-xl p-4">
        <input
          type="text"
          placeholder="Título *"
          value={task.title ?? ''}
          onChange={(e) => setTask({ ...task, title: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base font-medium"
        />

        <select
          value={task.project_id ?? ''}
          onChange={(e) => setTask({ ...task, project_id: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
        >
          <option value="">Proyecto *</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={task.responsible_id ?? ''}
          onChange={(e) => setTask({ ...task, responsible_id: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
        >
          <option value="">Responsable *</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={task.priority_id ?? 4}
            onChange={(e) => setTask({ ...task, priority_id: Number(e.target.value) })}
            className="border border-gray-300 rounded-lg px-3 py-2.5 text-base"
          >
            {priorities.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select
            value={task.status_id ?? 2}
            onChange={(e) => setTask({ ...task, status_id: Number(e.target.value) })}
            className="border border-gray-300 rounded-lg px-3 py-2.5 text-base"
          >
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <button onClick={() => setShowMore((v) => !v)} className="text-sm text-gray-500 underline">
          {showMore ? 'Ocultar detalles' : 'Agregar más detalle'}
        </button>

        {showMore && (
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <input
              type="text"
              placeholder="Subactividad"
              value={task.subactivity ?? ''}
              onChange={(e) => setTask({ ...task, subactivity: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            />
            <input
              type="text"
              placeholder="Disciplina"
              value={task.discipline ?? ''}
              onChange={(e) => setTask({ ...task, discipline: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            />
            <select
              value={task.indirect_id ?? ''}
              onChange={(e) => setTask({ ...task, indirect_id: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            >
              <option value="">Involucrado (opcional)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Ubicación (opcional)"
              value={task.location ?? ''}
              onChange={(e) => setTask({ ...task, location: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            />
            <div>
              <label className="text-xs text-gray-500">Fecha entrega</label>
              <input
                type="date"
                value={task.due_date ?? ''}
                onChange={(e) => setTask({ ...task, due_date: e.target.value || null })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Seguimiento (recordarme el)</label>
              <input
                type="date"
                value={task.follow_up_date ?? ''}
                onChange={(e) => setTask({ ...task, follow_up_date: e.target.value || null })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
              />
            </div>
            <textarea
              placeholder="Comentario"
              value={task.comment ?? ''}
              onChange={(e) => setTask({ ...task, comment: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
              rows={3}
            />
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-gray-900 text-white rounded-lg py-3 font-medium disabled:opacity-50"
        >
          {saving ? 'Guardando...' : isNew ? 'Crear tarea' : 'Guardar cambios'}
        </button>
      </div>

      {!isNew && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="font-medium text-gray-900">Fotos</p>
            <div className="flex gap-2 flex-wrap">
              {photos.map((p) => (
                <img
                  key={p.id}
                  src={photoUrls[p.id]}
                  className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                />
              ))}
              <label className="w-20 h-20 flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg text-gray-400 text-2xl cursor-pointer">
                +
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handlePhotoUpload(file)
                  }}
                />
              </label>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="font-medium text-gray-900">Seguimiento</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Agregar nota..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <button onClick={handleAddNote} className="bg-gray-900 text-white rounded-lg px-4 text-sm">
                Agregar
              </button>
            </div>
            <div className="space-y-2">
              {followups.map((f) => (
                <div key={f.id} className="text-sm border-l-2 border-gray-200 pl-3">
                  <p className="text-gray-800">{f.note}</p>
                  <p className="text-xs text-gray-400">{new Date(f.created_at).toLocaleString()}</p>
                </div>
              ))}
              {followups.length === 0 && <p className="text-sm text-gray-400">Sin notas todavía.</p>}
            </div>
          </div>

          <div className="flex gap-2">
            {task.status_id === 8 ? (
              <button onClick={handleReopen} className="flex-1 border border-gray-300 rounded-lg py-3 text-sm">
                Reabrir
              </button>
            ) : (
              <button onClick={handleComplete} className="flex-1 bg-green-600 text-white rounded-lg py-3 text-sm">
                Marcar completada
              </button>
            )}
            <button onClick={handleArchiveToggle} className="flex-1 border border-gray-300 rounded-lg py-3 text-sm">
              {task.archived ? 'Desarchivar' : 'Archivar'}
            </button>
          </div>
        </>
      )}

      {resolutionPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-20">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-4 w-full sm:max-w-sm space-y-3">
            <p className="font-medium">¿Cómo se resolvió?</p>
            <textarea
              value={resolutionText}
              onChange={(e) => setResolutionText(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              rows={3}
              placeholder="Resolución (opcional)"
            />
            <div className="flex gap-2">
              <button onClick={() => setResolutionPrompt(false)} className="flex-1 border border-gray-300 rounded-lg py-2.5 text-sm">
                Cancelar
              </button>
              <button onClick={confirmComplete} className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
