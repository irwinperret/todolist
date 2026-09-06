import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  DndContext,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { Meeting, MeetingMinute, MeetingItem, MeetingCategory, TaskScore } from '../lib/types'

const todayStr = () => new Date().toISOString().slice(0, 10)

type CategoryDraft = { tempId: string; name: string; parentTempId: string | null }
type ItemRow = { content: string; comment: string; categoryTempId: string | null }
type MinuteWithData = MeetingMinute & { items: MeetingItem[]; categories: MeetingCategory[] }
type CategoryNode = MeetingCategory & { children: CategoryNode[] }

function buildTree(categories: MeetingCategory[]): CategoryNode[] {
  const nodes: Record<string, CategoryNode> = {}
  categories.forEach((c) => { nodes[c.id] = { ...c, children: [] } })
  const roots: CategoryNode[] = []
  categories.forEach((c) => {
    if (c.parent_id && nodes[c.parent_id]) {
      nodes[c.parent_id].children.push(nodes[c.id])
    } else if (!c.parent_id) {
      roots.push(nodes[c.id])
    }
  })

  const sortByName = (a: CategoryNode, b: CategoryNode) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })

  const sortRecursive = (list: CategoryNode[]) => {
    list.sort(sortByName)
    list.forEach((n) => sortRecursive(n.children))
  }
  sortRecursive(roots)

  return roots
}

export default function MeetingDetail() {
  const { id } = useParams()
  const { projects, people, statuses, priorities } = useLookups()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [minutes, setMinutes] = useState<MinuteWithData[]>([])
  const [taskById, setTaskById] = useState<Record<string, TaskScore>>({})
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [meetingDate, setMeetingDate] = useState(todayStr())
  const [attendees, setAttendees] = useState('')
  const [minutaText, setMinutaText] = useState('')
  const [acuerdos, setAcuerdos] = useState('')
  const [itemRows, setItemRows] = useState<ItemRow[]>([{ content: '', comment: '', categoryTempId: null }])
  const [saving, setSaving] = useState(false)

  const [categoryDrafts, setCategoryDrafts] = useState<CategoryDraft[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [addingSubTo, setAddingSubTo] = useState<string | null>(null)
  const [newSubName, setNewSubName] = useState('')

  const [convertingItemId, setConvertingItemId] = useState<string | null>(null)
  const [convProject, setConvProject] = useState('')
  const [convResponsible, setConvResponsible] = useState('')
  const [convStatus, setConvStatus] = useState<number>(2)
  const [convPriority, setConvPriority] = useState<number>(4)

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')

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
    let categoriesByMinute: Record<string, MeetingCategory[]> = {}
    const taskIds: string[] = []

    if (minuteRows.length > 0) {
      const minuteIds = minuteRows.map((r) => r.id)
      const { data: items } = await supabase
        .from('meeting_items')
        .select('*')
        .in('meeting_minute_id', minuteIds)
        .order('sort_order')
        .order('created_at')
      for (const it of (items as MeetingItem[]) ?? []) {
        itemsByMinute[it.meeting_minute_id] = itemsByMinute[it.meeting_minute_id] ?? []
        itemsByMinute[it.meeting_minute_id].push(it)
        if (it.task_id) taskIds.push(it.task_id)
      }

      const { data: cats } = await supabase
        .from('meeting_categories')
        .select('*')
        .in('meeting_minute_id', minuteIds)
        .order('sort_order')
      for (const c of (cats as MeetingCategory[]) ?? []) {
        categoriesByMinute[c.meeting_minute_id] = categoriesByMinute[c.meeting_minute_id] ?? []
        categoriesByMinute[c.meeting_minute_id].push(c)
      }
    }

    if (taskIds.length > 0) {
      const { data: tasks } = await supabase.from('task_scores').select('*').in('id', taskIds)
      const map: Record<string, TaskScore> = {}
      for (const t of (tasks as TaskScore[]) ?? []) map[t.id] = t
      setTaskById(map)

      // When an item is synchronized with the main To Do, keep its comment
      // synchronized with the task comment whenever the task has one.
      for (const [minuteId, items] of Object.entries(itemsByMinute)) {
        for (const item of items) {
          if (!item.task_id) continue
          const task = map[item.task_id]
          if (task?.comment && task.comment !== item.comment) {
            await supabase.from('meeting_items').update({ comment: task.comment }).eq('id', item.id)
            item.comment = task.comment
          }
          itemsByMinute[minuteId] = items
        }
      }
    } else {
      setTaskById({})
    }

    setMinutes(
      minuteRows.map((r) => ({
        ...r,
        items: itemsByMinute[r.id] ?? [],
        categories: categoriesByMinute[r.id] ?? [],
      }))
    )

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ---- composition: categories ----
  const addTopCategory = () => {
    if (!newCategoryName.trim()) return
    setCategoryDrafts((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), name: newCategoryName.trim(), parentTempId: null },
    ])
    setNewCategoryName('')
  }

  const addSubCategory = (parentTempId: string) => {
    if (!newSubName.trim()) return
    setCategoryDrafts((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), name: newSubName.trim(), parentTempId },
    ])
    setNewSubName('')
    setAddingSubTo(null)
  }

  const removeCategoryDraft = (tempId: string) => {
    setCategoryDrafts((prev) => prev.filter((c) => c.tempId !== tempId && c.parentTempId !== tempId))
    setItemRows((prev) =>
      prev.map((r) => (r.categoryTempId === tempId ? { ...r, categoryTempId: null } : r))
    )
  }

  const draftOptions = useMemo(() => {
    const out: { tempId: string; label: string }[] = []
    const walk = (parentId: string | null, depth: number) => {
      categoryDrafts
        .filter((c) => c.parentTempId === parentId)
        .forEach((c) => {
          out.push({ tempId: c.tempId, label: `${'— '.repeat(depth)}${c.name}` })
          walk(c.tempId, depth + 1)
        })
    }
    walk(null, 0)
    return out
  }, [categoryDrafts])

  // ---- composition: items ----
  const updateItemRow = (idx: number, field: keyof ItemRow, value: string | null) => {
    setItemRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }
  const addItemRow = () => setItemRows((prev) => [...prev, { content: '', comment: '', categoryTempId: null }])
  const removeItemRow = (idx: number) => setItemRows((prev) => prev.filter((_, i) => i !== idx))

  const resetForm = () => {
    setMeetingDate(todayStr())
    setAttendees('')
    setMinutaText('')
    setAcuerdos('')
    setItemRows([{ content: '', comment: '', categoryTempId: null }])
    setCategoryDrafts([])
    setShowForm(false)
  }

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

    // insert categories parents first, then children, mapping temp -> real id
    const tempToReal: Record<string, string> = {}
    const parents = categoryDrafts.filter((c) => !c.parentTempId)
    for (let i = 0; i < parents.length; i++) {
      const { data: cat } = await supabase
        .from('meeting_categories')
        .insert({ meeting_minute_id: minute.id, parent_id: null, name: parents[i].name, sort_order: i })
        .select()
        .single()
      if (cat) tempToReal[parents[i].tempId] = cat.id
    }
    const children = categoryDrafts.filter((c) => c.parentTempId)
    for (let i = 0; i < children.length; i++) {
      const realParentId = tempToReal[children[i].parentTempId!]
      if (!realParentId) continue
      const { data: cat } = await supabase
        .from('meeting_categories')
        .insert({ meeting_minute_id: minute.id, parent_id: realParentId, name: children[i].name, sort_order: i })
        .select()
        .single()
      if (cat) tempToReal[children[i].tempId] = cat.id
    }

    const validItems = itemRows.filter((r) => r.content.trim())
    if (validItems.length > 0) {
      await supabase.from('meeting_items').insert(
        validItems.map((r, idx) => ({
          meeting_minute_id: minute.id,
          content: r.content.trim(),
          comment: r.comment.trim() || null,
          category_id: r.categoryTempId ? tempToReal[r.categoryTempId] ?? null : null,
          sort_order: idx,
        }))
      )
    }

    setSaving(false)
    resetForm()
    load()
  }

  const handleDeleteMinute = async (minuteId: string) => {
    if (!confirm('¿Borrar esta minuta, sus categorías e items? Las tareas ya creadas NO se borran, solo se desvinculan. No se puede deshacer.')) return
    await supabase.from('meeting_minutes').delete().eq('id', minuteId)
    load()
  }

  const toggleDone = async (item: MeetingItem) => {
    await supabase.from('meeting_items').update({ is_done: !item.is_done }).eq('id', item.id)
    load()
  }

  const saveItemComment = async (item: MeetingItem, comment: string) => {
    const cleanComment = comment.trim() || null
    const { error } = await supabase
      .from('meeting_items')
      .update({ comment: cleanComment })
      .eq('id', item.id)

    if (error) {
      alert(error.message)
      return
    }

    if (item.task_id) {
      const { error: taskError } = await supabase
        .from('tasks')
        .update({ comment: cleanComment })
        .eq('id', item.task_id)
      if (taskError) {
        alert(taskError.message)
        return
      }
    }

    load()
  }

  const openConvert = (item: MeetingItem, presetStatus?: number) => {
    setConvertingItemId(item.id)
    setConvProject('')
    setConvResponsible('')
    setConvStatus(presetStatus ?? 2)
    setConvPriority(4)
  }

  const startRenameCategory = (cat: MeetingCategory) => {
    setEditingCategoryId(cat.id)
    setEditingCategoryName(cat.name)
  }

  const saveRenameCategory = async () => {
    if (!editingCategoryId || !editingCategoryName.trim()) return
    await supabase
      .from('meeting_categories')
      .update({ name: editingCategoryName.trim() })
      .eq('id', editingCategoryId)
    setEditingCategoryId(null)
    load()
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
        comment: item.comment?.trim() || null,
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

  const reorderItems = async (
    updates: { id: string; category_id: string | null; sort_order: number }[]
  ) => {
    await Promise.all(
      updates.map((u) =>
        supabase
          .from('meeting_items')
          .update({ category_id: u.category_id, sort_order: u.sort_order })
          .eq('id', u.id)
      )
    )
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
            <p className="text-xs text-gray-500">Categorías (opcional, para agrupar los items)</p>

            {categoryDrafts.filter((c) => !c.parentTempId).map((cat) => (
              <div key={cat.tempId} className="space-y-1">
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1.5">
                  <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setAddingSubTo(cat.tempId)} className="text-xs text-blue-600">
                      + Subcategoría
                    </button>
                    <button onClick={() => removeCategoryDraft(cat.tempId)} className="text-xs text-gray-400">
                      ✕
                    </button>
                  </div>
                </div>
                {categoryDrafts.filter((c) => c.parentTempId === cat.tempId).map((sub) => (
                  <div key={sub.tempId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1 ml-4">
                    <span className="text-xs text-gray-700">— {sub.name}</span>
                    <button onClick={() => removeCategoryDraft(sub.tempId)} className="text-xs text-gray-400">✕</button>
                  </div>
                ))}
                {addingSubTo === cat.tempId && (
                  <div className="flex gap-2 ml-4">
                    <input
                      type="text"
                      placeholder="Nombre de subcategoría"
                      value={newSubName}
                      onChange={(e) => setNewSubName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addSubCategory(cat.tempId)}
                      className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs"
                      autoFocus
                    />
                    <button onClick={() => addSubCategory(cat.tempId)} className="text-xs text-green-600">Agregar</button>
                    <button onClick={() => { setAddingSubTo(null); setNewSubName('') }} className="text-xs text-gray-400">Cancelar</button>
                  </div>
                )}
              </div>
            ))}

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nueva categoría (ej. IPA, FENOFF)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTopCategory()}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <button onClick={addTopCategory} className="text-xs text-blue-600 shrink-0 px-2">+ Agregar</button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500">Items</p>
            {itemRows.map((r, idx) => (
              <div key={idx} className="border border-gray-100 rounded-lg p-2 space-y-2">
                <div className="flex gap-2">
                  <select
                    value={r.categoryTempId ?? ''}
                    onChange={(e) => updateItemRow(idx, 'categoryTempId', e.target.value || null)}
                    className="w-28 border border-gray-300 rounded-lg px-1 py-2 text-xs"
                  >
                    <option value="">Sin categoría</option>
                    {draftOptions.map((o) => (
                      <option key={o.tempId} value={o.tempId}>{o.label}</option>
                    ))}
                  </select>
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
                <textarea
                  placeholder="Comentario (opcional)"
                  value={r.comment}
                  onChange={(e) => updateItemRow(idx, 'comment', e.target.value)}
                  className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm text-purple-700 placeholder:text-purple-300"
                  rows={2}
                />
              </div>
            ))}
            <button onClick={addItemRow} className="text-xs text-blue-600">+ Agregar item</button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={resetForm}
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
            onSaveComment={saveItemComment}
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
            editingCategoryId={editingCategoryId}
            editingCategoryName={editingCategoryName}
            setEditingCategoryName={setEditingCategoryName}
            onStartRenameCategory={startRenameCategory}
            onSaveRenameCategory={saveRenameCategory}
            onCancelRenameCategory={() => setEditingCategoryId(null)}
            onReorderItems={reorderItems}
          />
        ))}
      </div>
    </div>
  )
}

function ItemRowView(props: {
  item: MeetingItem
  taskById: Record<string, TaskScore>
  convertingItemId: string | null
  onOpenConvert: (item: MeetingItem, presetStatus?: number) => void
  onCancelConvert: () => void
  onConfirmConvert: (item: MeetingItem) => void
  onToggleDone: (item: MeetingItem) => void
  onUnlink: (item: MeetingItem) => void
  onSaveComment: (item: MeetingItem, comment: string) => void
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
  const { item, taskById } = props
  const task = item.task_id ? taskById[item.task_id] : null
  const [editingComment, setEditingComment] = useState(false)
  const [commentDraft, setCommentDraft] = useState(item.comment ?? task?.comment ?? '')

  useEffect(() => {
    setCommentDraft(item.comment ?? task?.comment ?? '')
  }, [item.comment, task?.comment])

  const saveComment = () => {
    props.onSaveComment(item, commentDraft)
    setEditingComment(false)
  }

  const displayedComment = item.comment ?? task?.comment ?? null

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative' as const,
  }

  const grip = (
    <button
      {...attributes}
      {...listeners}
      className="text-gray-300 shrink-0 px-1 touch-none cursor-grab active:cursor-grabbing"
      aria-label="Arrastrar"
    >
      ⠿
    </button>
  )

  const commentEditor = (
    <div className="ml-7 mt-1 mb-1">
      {editingComment ? (
        <div className="space-y-1.5">
          <textarea
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            placeholder="Comentario..."
            className="w-full border border-purple-200 rounded-lg px-2.5 py-2 text-sm text-purple-700 placeholder:text-purple-300"
            rows={2}
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={saveComment} className="text-xs text-green-600">Guardar</button>
            <button
              onClick={() => {
                setCommentDraft(displayedComment ?? '')
                setEditingComment(false)
              }}
              className="text-xs text-gray-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : displayedComment ? (
        <button
          type="button"
          onClick={() => setEditingComment(true)}
          className="text-left text-xs text-purple-700 whitespace-pre-wrap hover:text-purple-900"
          title="Editar comentario"
        >
          {displayedComment}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditingComment(true)}
          className="text-xs text-purple-500 hover:text-purple-700"
        >
          + Agregar comentario
        </button>
      )}
    </div>
  )

  if (task) {
    return (
      <div ref={setNodeRef} style={dragStyle} className={isDragging ? 'opacity-60' : ''}>
        <div className="flex items-center gap-1">
          {grip}
          <Link
            to={`/task/${task.id}`}
            className="flex-1 flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2"
          >
            <span className="text-sm text-gray-800 truncate">{item.content}</span>
            <span className="text-xs bg-gray-800 text-white rounded-full px-2 py-0.5 shrink-0">
              {task.status_label}
            </span>
          </Link>
        </div>
        {commentEditor}
        <button onClick={() => props.onUnlink(item)} className="text-xs text-gray-400 mt-1 ml-7">
          Desvincular
        </button>
      </div>
    )
  }

  if (props.convertingItemId === item.id) {
    return (
      <div ref={setNodeRef} style={dragStyle} className="border border-gray-200 rounded-lg p-2 space-y-2">
        <p className="text-sm text-gray-800">{item.content}</p>
        {commentEditor}
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
          <button onClick={props.onCancelConvert} className="flex-1 border border-gray-300 rounded-lg py-1.5 text-xs">
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
    )
  }

  return (
    <div ref={setNodeRef} style={dragStyle} className={`flex items-center gap-2 flex-wrap ${isDragging ? 'opacity-60' : ''}`}>
      {grip}
      <input
        type="checkbox"
        checked={item.is_done}
        onChange={() => props.onToggleDone(item)}
        className="w-4 h-4 shrink-0"
      />
      <span className={`text-sm flex-1 min-w-[100px] ${item.is_done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
        {item.content}
      </span>
      <div className="flex gap-1 shrink-0">
        <button
          onClick={() => props.onOpenConvert(item, 2)}
          className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5"
        >
          To Do
        </button>
        <button
          onClick={() => props.onOpenConvert(item, 4)}
          className="text-xs bg-blue-50 text-blue-800 rounded-full px-2 py-0.5"
        >
          Revisar
        </button>
        <button
          onClick={() => props.onOpenConvert(item, 3)}
          className="text-xs bg-[#e8ddd3] text-red-900 rounded-full px-2 py-0.5"
        >
          Me deben
        </button>
      </div>
      {commentEditor}
    </div>
  )
}

function CategoryBlock(props: {
  node: CategoryNode
  depth: number
  itemsByCategory: Record<string, MeetingItem[]>
  itemProps: Omit<Parameters<typeof ItemRowView>[0], 'item'>
  editingCategoryId: string | null
  editingCategoryName: string
  setEditingCategoryName: (v: string) => void
  onStartRenameCategory: (cat: MeetingCategory) => void
  onSaveRenameCategory: () => void
  onCancelRenameCategory: () => void
}) {
  const items = props.itemsByCategory[props.node.id] ?? []
  const isEditing = props.editingCategoryId === props.node.id
  const { setNodeRef, isOver } = useDroppable({ id: `cat:${props.node.id}` })
  return (
    <div className={props.depth > 0 ? 'ml-4 space-y-1.5' : 'space-y-1.5'}>
      {isEditing ? (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={props.editingCategoryName}
            onChange={(e) => props.setEditingCategoryName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && props.onSaveRenameCategory()}
            className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs"
            autoFocus
          />
          <button onClick={props.onSaveRenameCategory} className="text-xs text-green-600">Guardar</button>
          <button onClick={props.onCancelRenameCategory} className="text-xs text-gray-400">Cancelar</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <p
            className={
              props.depth === 0
                ? 'text-xs font-semibold text-gray-500 uppercase tracking-wide'
                : 'text-xs font-medium text-gray-400'
            }
          >
            {props.depth > 0 ? '— ' : ''}{props.node.name}
          </p>
          <button onClick={() => props.onStartRenameCategory(props.node)} className="text-xs text-blue-600">
            Editar
          </button>
        </div>
      )}
      <div
        ref={setNodeRef}
        className={`space-y-1.5 rounded-lg ${isOver ? 'bg-blue-50 ring-2 ring-blue-200' : ''} ${items.length === 0 ? 'min-h-[28px]' : ''}`}
      >
        {items.length === 0 && (
          <p className="text-xs text-gray-300 italic px-1">Suelta aquí para mover un item</p>
        )}
        <SortableContext items={items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <ItemRowView key={item.id} item={item} {...props.itemProps} />
          ))}
        </SortableContext>
      </div>
      {props.node.children.map((child) => (
        <CategoryBlock
          key={child.id}
          node={child}
          depth={props.depth + 1}
          itemsByCategory={props.itemsByCategory}
          itemProps={props.itemProps}
          editingCategoryId={props.editingCategoryId}
          editingCategoryName={props.editingCategoryName}
          setEditingCategoryName={props.setEditingCategoryName}
          onStartRenameCategory={props.onStartRenameCategory}
          onSaveRenameCategory={props.onSaveRenameCategory}
          onCancelRenameCategory={props.onCancelRenameCategory}
        />
      ))}
    </div>
  )
}

function MinuteCard(props: {
  minute: MinuteWithData
  taskById: Record<string, TaskScore>
  onDeleteMinute: (id: string) => void
  onToggleDone: (item: MeetingItem) => void
  onUnlink: (item: MeetingItem) => void
  onSaveComment: (item: MeetingItem, comment: string) => void
  convertingItemId: string | null
  onOpenConvert: (item: MeetingItem, presetStatus?: number) => void
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
  editingCategoryId: string | null
  editingCategoryName: string
  setEditingCategoryName: (v: string) => void
  onStartRenameCategory: (cat: MeetingCategory) => void
  onSaveRenameCategory: () => void
  onCancelRenameCategory: () => void
  onReorderItems: (updates: { id: string; category_id: string | null; sort_order: number }[]) => void
}) {
  const { minute: m } = props

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const catKey = (catId: string | null) => catId ?? '__none__'

    // snapshot current items grouped by category, in their current order
    const byCat: Record<string, MeetingItem[]> = {}
    for (const it of m.items) {
      const k = catKey(it.category_id)
      byCat[k] = byCat[k] ?? []
      byCat[k].push(it)
    }
    Object.values(byCat).forEach((arr) => arr.sort((a, b) => a.sort_order - b.sort_order))

    let sourceCatKey: string | null = null
    for (const [k, arr] of Object.entries(byCat)) {
      if (arr.some((it) => it.id === activeId)) {
        sourceCatKey = k
        break
      }
    }
    if (!sourceCatKey) return
    const sourceArr = byCat[sourceCatKey]
    const activeItem = sourceArr.find((it) => it.id === activeId)!

    let targetCatKey: string
    let targetIndex: number

    if (overId.startsWith('cat:')) {
      targetCatKey = overId.replace(/^cat:/, '')
      targetIndex = (byCat[targetCatKey] ?? []).length
    } else {
      let found: string | null = null
      let idx = 0
      for (const [k, arr] of Object.entries(byCat)) {
        const i = arr.findIndex((it) => it.id === overId)
        if (i !== -1) {
          found = k
          idx = i
          break
        }
      }
      if (!found) return
      targetCatKey = found
      targetIndex = idx
    }

    const newCategoryId = targetCatKey === '__none__' ? null : targetCatKey
    const updates: { id: string; category_id: string | null; sort_order: number }[] = []

    if (sourceCatKey === targetCatKey) {
      const oldIndex = sourceArr.findIndex((it) => it.id === activeId)
      const reordered = arrayMove(sourceArr, oldIndex, targetIndex)
      reordered.forEach((it, i) => updates.push({ id: it.id, category_id: newCategoryId, sort_order: i }))
    } else {
      const newSourceArr = sourceArr.filter((it) => it.id !== activeId)
      const targetArr = [...(byCat[targetCatKey] ?? [])]
      targetArr.splice(targetIndex, 0, activeItem)
      const sourceCategoryId = sourceCatKey === '__none__' ? null : sourceCatKey
      newSourceArr.forEach((it, i) => updates.push({ id: it.id, category_id: sourceCategoryId, sort_order: i }))
      targetArr.forEach((it, i) =>
        updates.push({ id: it.id, category_id: newCategoryId, sort_order: i })
      )
    }

    props.onReorderItems(updates)
  }

  const tree = useMemo(() => buildTree(m.categories), [m.categories])

  const itemsByCategory = useMemo(() => {
    const map: Record<string, MeetingItem[]> = {}
    for (const item of m.items) {
      const key = item.category_id ?? '__none__'
      map[key] = map[key] ?? []
      map[key].push(item)
    }
    return map
  }, [m.items])

  const uncategorized = itemsByCategory['__none__'] ?? []

  const itemProps = {
    taskById: props.taskById,
    convertingItemId: props.convertingItemId,
    onOpenConvert: props.onOpenConvert,
    onCancelConvert: props.onCancelConvert,
    onConfirmConvert: props.onConfirmConvert,
    onToggleDone: props.onToggleDone,
    onUnlink: props.onUnlink,
    onSaveComment: props.onSaveComment,
    projects: props.projects,
    people: props.people,
    statuses: props.statuses,
    priorities: props.priorities,
    convProject: props.convProject,
    setConvProject: props.setConvProject,
    convResponsible: props.convResponsible,
    setConvResponsible: props.setConvResponsible,
    convStatus: props.convStatus,
    setConvStatus: props.setConvStatus,
    convPriority: props.convPriority,
    setConvPriority: props.setConvPriority,
  }

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

      {(tree.length > 0 || uncategorized.length > 0) && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="space-y-4 pt-2 border-t border-gray-100">
            {tree.map((node) => (
              <CategoryBlock
                key={node.id}
                node={node}
                depth={0}
                itemsByCategory={itemsByCategory}
                itemProps={itemProps}
                editingCategoryId={props.editingCategoryId}
                editingCategoryName={props.editingCategoryName}
                setEditingCategoryName={props.setEditingCategoryName}
                onStartRenameCategory={props.onStartRenameCategory}
                onSaveRenameCategory={props.onSaveRenameCategory}
                onCancelRenameCategory={props.onCancelRenameCategory}
              />
            ))}
            <UncategorizedZone items={uncategorized} itemProps={itemProps} />
          </div>
        </DndContext>
      )}
    </div>
  )
}

function UncategorizedZone(props: {
  items: MeetingItem[]
  itemProps: Omit<Parameters<typeof ItemRowView>[0], 'item'>
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'cat:__none__' })
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sin categoría</p>
      <div
        ref={setNodeRef}
        className={`space-y-1.5 rounded-lg ${isOver ? 'bg-blue-50 ring-2 ring-blue-200' : ''} ${
          props.items.length === 0 ? 'min-h-[28px]' : ''
        }`}
      >
        {props.items.length === 0 && (
          <p className="text-xs text-gray-300 italic px-1">Suelta aquí para quitar la categoría</p>
        )}
        <SortableContext items={props.items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
          {props.items.map((item) => (
            <ItemRowView key={item.id} item={item} {...props.itemProps} />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}
