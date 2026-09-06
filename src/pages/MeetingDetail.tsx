import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  DndContext,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import { RichText, RichTextArea, formatRichText } from '../components/RichText'
import type { Meeting, MeetingMinute, MeetingItem, MeetingCategory, TaskScore, Project, Person, Status, PriorityLevel } from '../lib/types'

const todayStr = () => new Date().toISOString().slice(0, 10)

type MinuteWithData = MeetingMinute & { items: MeetingItem[]; categories: MeetingCategory[] }
type CategoryNode = MeetingCategory & { children: CategoryNode[] }

function buildTree(categories: MeetingCategory[]): CategoryNode[] {
  const nodes: Record<string, CategoryNode> = {}
  categories.forEach((c) => { nodes[c.id] = { ...c, children: [] } })
  const roots: CategoryNode[] = []
  categories.forEach((c) => {
    if (c.parent_id && nodes[c.parent_id]) nodes[c.parent_id].children.push(nodes[c.id])
    else if (!c.parent_id) roots.push(nodes[c.id])
  })
  const sortByName = (a: CategoryNode, b: CategoryNode) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  const sortRecursive = (list: CategoryNode[]) => { list.sort(sortByName); list.forEach((n) => sortRecursive(n.children)) }
  sortRecursive(roots)
  return roots
}

function flattenCategories(nodes: CategoryNode[], depth = 0): { id: string; label: string }[] {
  let out: { id: string; label: string }[] = []
  for (const n of nodes) {
    out.push({ id: n.id, label: `${'— '.repeat(depth)}${n.name}` })
    out = out.concat(flattenCategories(n.children, depth + 1))
  }
  return out
}

// Shared props every item row and category block needs for the sync/convert/comment actions
type ItemActions = {
  taskById: Record<string, TaskScore>
  convertingItemId: string | null
  onOpenConvert: (item: MeetingItem, presetStatus?: number) => void
  onCancelConvert: () => void
  onConfirmConvert: (item: MeetingItem) => void
  onToggleDone: (item: MeetingItem) => void
  onToggleLongTerm: (item: MeetingItem) => void
  onUnlink: (item: MeetingItem) => void
  onSaveComment: (item: MeetingItem, comment: string) => void
  onSaveContent: (item: MeetingItem, content: string) => void
  onDeleteItem: (item: MeetingItem) => void
  projects: Project[]
  people: Person[]
  statuses: Status[]
  priorities: PriorityLevel[]
  convProject: string
  setConvProject: (v: string) => void
  convResponsible: string
  setConvResponsible: (v: string) => void
  convStatus: number
  setConvStatus: (v: number) => void
  convPriority: number
  setConvPriority: (v: number) => void
}

export default function MeetingDetail() {
  const { id } = useParams()
  const { projects, people, statuses, priorities } = useLookups()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [minutes, setMinutes] = useState<MinuteWithData[]>([])
  const [taskById, setTaskById] = useState<Record<string, TaskScore>>({})
  const [loading, setLoading] = useState(true)

  const [creatingFirstMinute, setCreatingFirstMinute] = useState(false)
  const [meetingDate, setMeetingDate] = useState(todayStr())
  const [attendees, setAttendees] = useState('')
  const [minutaText, setMinutaText] = useState('')
  const [acuerdos, setAcuerdos] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingMinuteId, setEditingMinuteId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editAttendees, setEditAttendees] = useState('')
  const [editMinuta, setEditMinuta] = useState('')
  const [editAcuerdos, setEditAcuerdos] = useState('')

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

    const itemsByMinute: Record<string, MeetingItem[]> = {}
    const categoriesByMinute: Record<string, MeetingCategory[]> = {}
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

    // Reconcile: if a linked task changed (status/comment/title) since we last
    // looked, mirror that onto the meeting item so both sides stay in sync
    // regardless of which side was edited most recently.
    let taskMap: Record<string, TaskScore> = {}
    if (taskIds.length > 0) {
      const { data: tasks } = await supabase.from('task_scores').select('*').in('id', taskIds)
      for (const t of (tasks as TaskScore[]) ?? []) taskMap[t.id] = t

      for (const items of Object.values(itemsByMinute)) {
        for (const item of items) {
          if (!item.task_id) continue
          const task = taskMap[item.task_id]
          if (!task) continue
          const updates: Partial<MeetingItem> = {}
          if ((task.comment ?? null) !== (item.comment ?? null)) updates.comment = task.comment ?? null
          if ((task.status_id === 8) !== item.is_done) updates.is_done = task.status_id === 8
          if (task.title !== item.content) updates.content = task.title
          if (Object.keys(updates).length > 0) {
            await supabase.from('meeting_items').update(updates).eq('id', item.id)
            Object.assign(item, updates)
          }
        }
      }
    }
    setTaskById(taskMap)

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

  const handleCreateFirstMinute = async () => {
    if (!minutaText.trim()) return alert('Escribe algo en la minuta.')
    setSaving(true)
    const { error } = await supabase.from('meeting_minutes').insert({
      meeting_id: id,
      meeting_date: meetingDate,
      attendees: attendees.trim() || null,
      minuta: minutaText.trim(),
      acuerdos: acuerdos.trim() || null,
    })
    setSaving(false)
    if (error) return alert(error.message)
    setCreatingFirstMinute(false)
    setAttendees('')
    setMinutaText('')
    setAcuerdos('')
    load()
  }

  const startEditMinute = (m: MeetingMinute) => {
    setEditingMinuteId(m.id)
    setEditDate(m.meeting_date)
    setEditAttendees(m.attendees ?? '')
    setEditMinuta(m.minuta)
    setEditAcuerdos(m.acuerdos ?? '')
  }

  const saveEditMinute = async () => {
    if (!editingMinuteId) return
    if (!editMinuta.trim()) return alert('La minuta no puede quedar vacía.')
    const { error } = await supabase
      .from('meeting_minutes')
      .update({
        meeting_date: editDate,
        attendees: editAttendees.trim() || null,
        minuta: editMinuta.trim(),
        acuerdos: editAcuerdos.trim() || null,
      })
      .eq('id', editingMinuteId)
    if (error) return alert(error.message)
    setEditingMinuteId(null)
    load()
  }

  const handleDeleteMinute = async (minuteId: string) => {
    if (!confirm('¿Borrar esta minuta, sus categorías e items? Las tareas ya creadas NO se borran, solo se desvinculan. No se puede deshacer.')) return
    await supabase.from('meeting_minutes').delete().eq('id', minuteId)
    load()
  }

  const addCategory = async (minuteId: string, parentId: string | null, name: string, siblingCount: number) => {
    if (!name.trim()) return
    const { error } = await supabase
      .from('meeting_categories')
      .insert({ meeting_minute_id: minuteId, parent_id: parentId, name: name.trim(), sort_order: siblingCount })
    if (error) return alert(error.message)
    load()
  }

  const startRenameCategory = (cat: MeetingCategory) => {
    setEditingCategoryId(cat.id)
    setEditingCategoryName(cat.name)
  }

  const saveRenameCategory = async () => {
    if (!editingCategoryId || !editingCategoryName.trim()) return
    await supabase.from('meeting_categories').update({ name: editingCategoryName.trim() }).eq('id', editingCategoryId)
    setEditingCategoryId(null)
    load()
  }

  const addItem = async (minuteId: string, categoryId: string | null, content: string, itemCount: number) => {
    if (!content.trim()) return
    const { error } = await supabase
      .from('meeting_items')
      .insert({ meeting_minute_id: minuteId, category_id: categoryId, content: content.trim(), sort_order: itemCount })
    if (error) return alert(error.message)
    load()
  }

  const saveItemContent = async (item: MeetingItem, content: string) => {
    if (!content.trim()) return
    const { error } = await supabase.from('meeting_items').update({ content: content.trim() }).eq('id', item.id)
    if (error) return alert(error.message)
    if (item.task_id) {
      await supabase.from('tasks').update({ title: content.trim() }).eq('id', item.task_id)
    }
    load()
  }

  const deleteItem = async (item: MeetingItem) => {
    if (!confirm('¿Borrar este item? Si está sincronizado con una tarea, la tarea NO se borra, solo se desvincula.')) return
    await supabase.from('meeting_items').delete().eq('id', item.id)
    load()
  }

  const toggleDone = async (item: MeetingItem) => {
    const nextDone = !item.is_done
    const { error } = await supabase.from('meeting_items').update({ is_done: nextDone }).eq('id', item.id)
    if (error) return alert(error.message)
    if (item.task_id) {
      await supabase.from('tasks').update({ status_id: nextDone ? 8 : 2 }).eq('id', item.task_id)
    }
    load()
  }

  const toggleLongTerm = async (item: MeetingItem) => {
    const { error } = await supabase.from('meeting_items').update({ is_long_term: !item.is_long_term }).eq('id', item.id)
    if (error) return alert(error.message)
    load()
  }

  const saveItemComment = async (item: MeetingItem, comment: string) => {
    const cleanComment = comment.trim() || null
    const { error } = await supabase.from('meeting_items').update({ comment: cleanComment }).eq('id', item.id)
    if (error) return alert(error.message)
    if (item.task_id) {
      await supabase.from('tasks').update({ comment: cleanComment }).eq('id', item.task_id)
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

  const confirmConvert = async (item: MeetingItem) => {
    if (!convProject || !convResponsible) return alert('Selecciona proyecto y responsable.')
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
    const { error: linkError } = await supabase.from('meeting_items').update({ task_id: task.id }).eq('id', item.id)
    if (linkError) return alert(linkError.message)
    setConvertingItemId(null)
    load()
  }

  const unlinkItem = async (item: MeetingItem) => {
    if (!confirm('¿Desvincular esta tarea del item? La tarea seguirá existiendo en el To Do, pero dejará de estar sincronizada con esta minuta.')) return
    await supabase.from('meeting_items').update({ task_id: null }).eq('id', item.id)
    load()
  }

  const reorderItems = async (updates: { id: string; category_id: string | null; sort_order: number }[]) => {
    await Promise.all(
      updates.map((u) => supabase.from('meeting_items').update({ category_id: u.category_id, sort_order: u.sort_order }).eq('id', u.id))
    )
    load()
  }

  const itemActions: ItemActions = {
    taskById,
    convertingItemId,
    onOpenConvert: openConvert,
    onCancelConvert: () => setConvertingItemId(null),
    onConfirmConvert: confirmConvert,
    onToggleDone: toggleDone,
    onToggleLongTerm: toggleLongTerm,
    onUnlink: unlinkItem,
    onSaveComment: saveItemComment,
    onSaveContent: saveItemContent,
    onDeleteItem: deleteItem,
    projects,
    people,
    statuses,
    priorities,
    convProject,
    setConvProject,
    convResponsible,
    setConvResponsible,
    convStatus,
    setConvStatus,
    convPriority,
    setConvPriority,
  }

  if (loading) return <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>
  if (!meeting) return <p className="text-gray-400 text-sm py-8 text-center">Reunión no encontrada.</p>

  return (
    <div className="px-4 pt-4 space-y-4 pb-8">
      <h2 className="text-lg font-semibold text-gray-900">{meeting.name}</h2>

      {minutes.length === 0 && !creatingFirstMinute && (
        <button onClick={() => setCreatingFirstMinute(true)} className="w-full bg-gray-900 text-white rounded-lg py-3 font-medium">
          + Crear minuta
        </button>
      )}

      {creatingFirstMinute && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500">Fecha</label>
            <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base" />
          </div>
          <input type="text" placeholder="Asistentes (opcional)" value={attendees} onChange={(e) => setAttendees(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base" />
          <RichTextArea value={minutaText} onChange={setMinutaText} placeholder="Minuta / temas tratados" rows={4} />
          <RichTextArea value={acuerdos} onChange={setAcuerdos} placeholder="Acuerdos generales (opcional)" rows={2} />
          <div className="flex gap-2">
            <button onClick={() => setCreatingFirstMinute(false)} className="flex-1 border border-red-900 text-red-900 rounded-lg py-2.5 text-sm">Cancelar</button>
            <button onClick={handleCreateFirstMinute} disabled={saving} className="flex-1 bg-gray-900 text-white rounded-lg py-2.5 text-sm disabled:opacity-50">
              {saving ? 'Guardando...' : 'Crear minuta'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {minutes.map((m) => (
          <MinuteCard
            key={m.id}
            minute={m}
            isEditing={editingMinuteId === m.id}
            editDate={editDate}
            editAttendees={editAttendees}
            editMinuta={editMinuta}
            editAcuerdos={editAcuerdos}
            setEditDate={setEditDate}
            setEditAttendees={setEditAttendees}
            setEditMinuta={setEditMinuta}
            setEditAcuerdos={setEditAcuerdos}
            onStartEdit={() => startEditMinute(m)}
            onCancelEdit={() => setEditingMinuteId(null)}
            onSaveEdit={saveEditMinute}
            onDeleteMinute={handleDeleteMinute}
            onAddCategory={addCategory}
            onAddItem={addItem}
            editingCategoryId={editingCategoryId}
            editingCategoryName={editingCategoryName}
            setEditingCategoryName={setEditingCategoryName}
            onStartRenameCategory={startRenameCategory}
            onSaveRenameCategory={saveRenameCategory}
            onCancelRenameCategory={() => setEditingCategoryId(null)}
            onReorderItems={reorderItems}
            itemActions={itemActions}
          />
        ))}
      </div>
    </div>
  )
}

function MinuteCard(props: {
  minute: MinuteWithData
  isEditing: boolean
  editDate: string
  editAttendees: string
  editMinuta: string
  editAcuerdos: string
  setEditDate: (v: string) => void
  setEditAttendees: (v: string) => void
  setEditMinuta: (v: string) => void
  setEditAcuerdos: (v: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDeleteMinute: (id: string) => void
  onAddCategory: (minuteId: string, parentId: string | null, name: string, siblingCount: number) => void
  onAddItem: (minuteId: string, categoryId: string | null, content: string, itemCount: number) => void
  editingCategoryId: string | null
  editingCategoryName: string
  setEditingCategoryName: (v: string) => void
  onStartRenameCategory: (cat: MeetingCategory) => void
  onSaveRenameCategory: () => void
  onCancelRenameCategory: () => void
  onReorderItems: (updates: { id: string; category_id: string | null; sort_order: number }[]) => void
  itemActions: ItemActions
}) {
  const { minute: m } = props
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [addingSubTo, setAddingSubTo] = useState<{ id: string; siblingCount: number } | null>(null)
  const [newSubName, setNewSubName] = useState('')
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemCategory, setNewItemCategory] = useState('')
  const [newItemContent, setNewItemContent] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 12 } })
  )

  const tree = useMemo(() => buildTree(m.categories), [m.categories])
  const categoryOptions = useMemo(() => flattenCategories(tree), [tree])

  const itemsByCategory = useMemo(() => {
    const map: Record<string, MeetingItem[]> = {}
    for (const item of m.items) {
      const key = item.category_id ?? '__none__'
      map[key] = map[key] ?? []
      map[key].push(item)
    }
    // "En el Radar" items always sink to the bottom of their category,
    // regardless of drag order, since they're long-term/not urgent by definition
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        if (a.is_long_term !== b.is_long_term) return a.is_long_term ? 1 : -1
        return a.sort_order - b.sort_order
      })
    }
    return map
  }, [m.items])
  const uncategorized = itemsByCategory['__none__'] ?? []

  const topLevelCount = m.categories.filter((c) => !c.parent_id).length

  const requestAddSub = (categoryId: string, siblingCount: number) => setAddingSubTo({ id: categoryId, siblingCount })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const catKey = (catId: string | null) => catId ?? '__none__'
    const byCat: Record<string, MeetingItem[]> = {}
    for (const it of m.items) {
      const k = catKey(it.category_id)
      byCat[k] = byCat[k] ?? []
      byCat[k].push(it)
    }
    Object.values(byCat).forEach((arr) => arr.sort((a, b) => a.sort_order - b.sort_order))

    let sourceCatKey: string | null = null
    for (const [k, arr] of Object.entries(byCat)) {
      if (arr.some((it) => it.id === activeId)) { sourceCatKey = k; break }
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
        if (i !== -1) { found = k; idx = i; break }
      }
      if (!found) return
      targetCatKey = found
      targetIndex = idx
    }

    const newCategoryId = targetCatKey === '__none__' ? null : targetCatKey
    const updates: { id: string; category_id: string | null; sort_order: number }[] = []
    if (sourceCatKey === targetCatKey) {
      const oldIndex = sourceArr.findIndex((it) => it.id === activeId)
      arrayMove(sourceArr, oldIndex, targetIndex).forEach((it, i) => updates.push({ id: it.id, category_id: newCategoryId, sort_order: i }))
    } else {
      const newSourceArr = sourceArr.filter((it) => it.id !== activeId)
      const targetArr = [...(byCat[targetCatKey] ?? [])]
      targetArr.splice(targetIndex, 0, activeItem)
      const sourceCategoryId = sourceCatKey === '__none__' ? null : sourceCatKey
      newSourceArr.forEach((it, i) => updates.push({ id: it.id, category_id: sourceCategoryId, sort_order: i }))
      targetArr.forEach((it, i) => updates.push({ id: it.id, category_id: newCategoryId, sort_order: i }))
    }
    props.onReorderItems(updates)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      {props.isEditing ? (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-gray-500">Fecha</label>
            <input type="date" value={props.editDate} onChange={(e) => props.setEditDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <input type="text" placeholder="Asistentes" value={props.editAttendees} onChange={(e) => props.setEditAttendees(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <RichTextArea value={props.editMinuta} onChange={props.setEditMinuta} rows={4} />
          <RichTextArea value={props.editAcuerdos} onChange={props.setEditAcuerdos} placeholder="Acuerdos generales" rows={2} />
          <div className="flex gap-2">
            <button onClick={props.onCancelEdit} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm">Cancelar</button>
            <button onClick={props.onSaveEdit} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm">Guardar</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-900">
              {new Date(m.meeting_date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <div className="flex gap-3">
              <button onClick={props.onStartEdit} className="text-xs text-blue-600">Editar minuta</button>
              <button onClick={() => props.onDeleteMinute(m.id)} className="text-xs text-red-500">Borrar</button>
            </div>
          </div>
          {m.attendees && <p className="text-xs text-gray-500"><span className="font-medium">Asistentes:</span> {m.attendees}</p>}
          <RichText text={m.minuta} className="text-sm text-gray-800" />
          {m.acuerdos && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-2">
              <p className="text-xs font-medium text-amber-800 mb-1">Acuerdos generales</p>
              <RichText text={m.acuerdos} className="text-sm text-amber-900" />
            </div>
          )}
        </>
      )}

      {(tree.length > 0 || uncategorized.length > 0) && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="space-y-4 pt-2 border-t border-gray-100">
            {tree.map((node) => (
              <CategoryBlock
                key={node.id}
                node={node}
                depth={0}
                itemsByCategory={itemsByCategory}
                itemActions={props.itemActions}
                editingCategoryId={props.editingCategoryId}
                editingCategoryName={props.editingCategoryName}
                setEditingCategoryName={props.setEditingCategoryName}
                onStartRenameCategory={props.onStartRenameCategory}
                onSaveRenameCategory={props.onSaveRenameCategory}
                onCancelRenameCategory={props.onCancelRenameCategory}
                onRequestAddSub={requestAddSub}
              />
            ))}
            <UncategorizedZone items={uncategorized} itemActions={props.itemActions} />
          </div>
        </DndContext>
      )}

      <div className="pt-2 border-t border-gray-100 space-y-2">
        {showAddCategory ? (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Nombre de la categoría"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (props.onAddCategory(m.id, null, newCategoryName, topLevelCount), setNewCategoryName(''), setShowAddCategory(false))}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              autoFocus
            />
            <button
              onClick={() => { props.onAddCategory(m.id, null, newCategoryName, topLevelCount); setNewCategoryName(''); setShowAddCategory(false) }}
              className="text-xs text-green-600 px-2"
            >
              Agregar
            </button>
            <button onClick={() => { setShowAddCategory(false); setNewCategoryName('') }} className="text-xs text-gray-400 px-2">Cancelar</button>
          </div>
        ) : addingSubTo ? (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Nombre de la subcategoría"
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              autoFocus
            />
            <button
              onClick={() => { props.onAddCategory(m.id, addingSubTo.id, newSubName, addingSubTo.siblingCount); setNewSubName(''); setAddingSubTo(null) }}
              className="text-xs text-green-600 px-2"
            >
              Agregar
            </button>
            <button onClick={() => { setAddingSubTo(null); setNewSubName('') }} className="text-xs text-gray-400 px-2">Cancelar</button>
          </div>
        ) : (
          <button onClick={() => setShowAddCategory(true)} className="text-xs text-blue-600">+ Agregar categoría</button>
        )}

        {showAddItem ? (
          <div className="flex gap-2">
            <select
              value={newItemCategory}
              onChange={(e) => setNewItemCategory(e.target.value)}
              className="w-28 border border-gray-300 rounded-lg px-1 py-2 text-xs"
            >
              <option value="">Sin categoría</option>
              {categoryOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Nuevo item"
              value={newItemContent}
              onChange={(e) => setNewItemContent(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              autoFocus
            />
            <button
              onClick={() => {
                const catId = newItemCategory || null
                const count = (itemsByCategory[catId ?? '__none__'] ?? []).length
                props.onAddItem(m.id, catId, newItemContent, count)
                setNewItemContent('')
                setNewItemCategory('')
                setShowAddItem(false)
              }}
              className="text-xs text-green-600 px-2"
            >
              Agregar
            </button>
            <button onClick={() => { setShowAddItem(false); setNewItemContent('') }} className="text-xs text-gray-400 px-2">Cancelar</button>
          </div>
        ) : (
          <button onClick={() => setShowAddItem(true)} className="text-xs text-blue-600 block">+ Agregar item</button>
        )}
      </div>
    </div>
  )
}

function CategoryBlock(props: {
  node: CategoryNode
  depth: number
  itemsByCategory: Record<string, MeetingItem[]>
  itemActions: ItemActions
  editingCategoryId: string | null
  editingCategoryName: string
  setEditingCategoryName: (v: string) => void
  onStartRenameCategory: (cat: MeetingCategory) => void
  onSaveRenameCategory: () => void
  onCancelRenameCategory: () => void
  onRequestAddSub: (categoryId: string, siblingCount: number) => void
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
          <p className={props.depth === 0 ? 'text-xs font-semibold text-gray-500 uppercase tracking-wide' : 'text-xs font-medium text-gray-400'}>
            {props.depth > 0 ? '— ' : ''}{props.node.name}
          </p>
          <button onClick={() => props.onStartRenameCategory(props.node)} className="text-xs text-blue-600">Editar</button>
          <button onClick={() => props.onRequestAddSub(props.node.id, props.node.children.length)} className="text-xs text-blue-600">+ Subcategoría</button>
        </div>
      )}

      <div ref={setNodeRef} className={`space-y-1.5 rounded-lg ${isOver ? 'bg-blue-50 ring-2 ring-blue-200' : ''} ${items.length === 0 ? 'min-h-[40px]' : ''}`}>
        {items.length === 0 && <p className="text-xs text-gray-300 italic px-1">Suelta aquí para mover un item</p>}
        <SortableContext items={items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <ItemRowView key={item.id} item={item} actions={props.itemActions} />
          ))}
        </SortableContext>
      </div>

      {props.node.children.map((child) => (
        <CategoryBlock
          key={child.id}
          node={child}
          depth={props.depth + 1}
          itemsByCategory={props.itemsByCategory}
          itemActions={props.itemActions}
          editingCategoryId={props.editingCategoryId}
          editingCategoryName={props.editingCategoryName}
          setEditingCategoryName={props.setEditingCategoryName}
          onStartRenameCategory={props.onStartRenameCategory}
          onSaveRenameCategory={props.onSaveRenameCategory}
          onCancelRenameCategory={props.onCancelRenameCategory}
          onRequestAddSub={props.onRequestAddSub}
        />
      ))}
    </div>
  )
}

function UncategorizedZone(props: { items: MeetingItem[]; itemActions: ItemActions }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'cat:__none__' })
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sin categoría</p>
      <div ref={setNodeRef} className={`space-y-1.5 rounded-lg ${isOver ? 'bg-blue-50 ring-2 ring-blue-200' : ''} ${props.items.length === 0 ? 'min-h-[40px]' : ''}`}>
        {props.items.length === 0 && <p className="text-xs text-gray-300 italic px-1">Suelta aquí para quitar la categoría</p>}
        <SortableContext items={props.items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
          {props.items.map((item) => (
            <ItemRowView key={item.id} item={item} actions={props.itemActions} />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}

function ItemRowView({ item, actions }: { item: MeetingItem; actions: ItemActions }) {
  const task = item.task_id ? actions.taskById[item.task_id] : null

  const [editingComment, setEditingComment] = useState(false)
  const [commentDraft, setCommentDraft] = useState(item.comment ?? task?.comment ?? '')
  useEffect(() => setCommentDraft(item.comment ?? task?.comment ?? ''), [item.comment, task?.comment])
  const displayedComment = item.comment ?? task?.comment ?? null

  const [editingText, setEditingText] = useState(false)
  const [textDraft, setTextDraft] = useState(item.content)
  useEffect(() => setTextDraft(item.content), [item.content])

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const dragStyle = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, position: 'relative' as const }

  const grip = (
    <button {...attributes} {...listeners} className="text-gray-300 shrink-0 px-1 touch-none cursor-grab active:cursor-grabbing" aria-label="Arrastrar">
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
            <button onClick={() => { actions.onSaveComment(item, commentDraft); setEditingComment(false) }} className="text-xs text-green-600">Guardar</button>
            <button onClick={() => { setCommentDraft(displayedComment ?? ''); setEditingComment(false) }} className="text-xs text-gray-400">Cancelar</button>
          </div>
        </div>
      ) : displayedComment ? (
        <button
          type="button"
          onClick={() => setEditingComment(true)}
          className="text-left text-xs text-purple-700 hover:text-purple-900"
          title="Editar comentario"
          dangerouslySetInnerHTML={{ __html: formatRichText(displayedComment) }}
        />
      ) : (
        <button type="button" onClick={() => setEditingComment(true)} className="text-xs text-purple-500 hover:text-purple-700">+ Agregar comentario</button>
      )}
    </div>
  )

  const contentView = editingText ? (
    <div className="flex-1 min-w-0 flex gap-1">
      <input
        type="text"
        value={textDraft}
        onChange={(e) => setTextDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (actions.onSaveContent(item, textDraft), setEditingText(false))}
        className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1 text-sm"
        autoFocus
      />
      <button onClick={() => { actions.onSaveContent(item, textDraft); setEditingText(false) }} className="text-xs text-green-600">Guardar</button>
      <button onClick={() => { setTextDraft(item.content); setEditingText(false) }} className="text-xs text-gray-400">Cancelar</button>
    </div>
  ) : (
    <span
      onClick={() => setEditingText(true)}
      className={`text-sm min-w-0 flex-1 whitespace-normal break-words cursor-text ${item.is_done ? 'text-gray-400 line-through' : 'text-gray-800'}`}
      title="Toca para editar el texto"
    >
      {item.content}
    </span>
  )

  if (task) {
    return (
      <div ref={setNodeRef} style={dragStyle} className={isDragging ? 'opacity-60' : ''}>
        <div className="flex items-start gap-1">
          {grip}
          <input type="checkbox" checked={item.is_done} onChange={() => actions.onToggleDone(item)} className="w-4 h-4 shrink-0 mt-1" />
          <Link to={`/task/${task.id}`} className="min-w-0 flex-1 bg-gray-50 rounded-lg px-3 py-2">
            <div className="flex items-start gap-2">
              <span className={`text-sm min-w-0 flex-1 whitespace-normal break-words ${item.is_done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                {item.content}
              </span>
              <span className="text-xs bg-gray-800 text-white rounded-full px-2 py-0.5 shrink-0">{task.status_label}</span>
            </div>
          </Link>
        </div>
        {commentEditor}
        <button onClick={() => actions.onUnlink(item)} className="text-xs text-gray-400 mt-1 ml-7">Desvincular</button>
      </div>
    )
  }

  if (actions.convertingItemId === item.id) {
    return (
      <div ref={setNodeRef} style={dragStyle} className="border border-gray-200 rounded-lg p-2 space-y-2">
        <p className="text-sm text-gray-800 whitespace-normal break-words">{item.content}</p>
        {commentEditor}
        <select value={actions.convProject} onChange={(e) => actions.setConvProject(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
          <option value="">Proyecto *</option>
          {actions.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={actions.convResponsible} onChange={(e) => actions.setConvResponsible(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
          <option value="">Responsable *</option>
          {actions.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select value={actions.convPriority} onChange={(e) => actions.setConvPriority(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
            {actions.priorities.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select value={actions.convStatus} onChange={(e) => actions.setConvStatus(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
            {actions.statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={actions.onCancelConvert} className="flex-1 border border-gray-300 rounded-lg py-1.5 text-xs">Cancelar</button>
          <button onClick={() => actions.onConfirmConvert(item)} className="flex-1 bg-gray-900 text-white rounded-lg py-1.5 text-xs">Sincronizar con To Do</button>
        </div>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={dragStyle} className={`space-y-1 ${isDragging ? 'opacity-60' : ''} ${item.is_long_term ? 'opacity-80' : ''}`}>
      <div className="flex items-start gap-2">
        {grip}
        <input type="checkbox" checked={item.is_done} onChange={() => actions.onToggleDone(item)} className="w-4 h-4 shrink-0 mt-1" />
        {item.is_long_term && !editingText ? (
          <span
            onClick={() => setEditingText(true)}
            className={`text-sm min-w-0 flex-1 whitespace-normal break-words cursor-text text-gray-600 ${item.is_done ? 'line-through' : ''}`}
            title="Toca para editar el texto"
          >
            {item.content}
          </span>
        ) : (
          contentView
        )}
        <div className="flex gap-1 shrink-0 flex-wrap justify-end">
          {!item.is_long_term && (
            <>
              <button onClick={() => actions.onOpenConvert(item, 2)} className="text-xs bg-green-50 text-green-800 rounded-full px-2 py-0.5">To Do</button>
              <button onClick={() => actions.onOpenConvert(item, 4)} className="text-xs bg-blue-50 text-blue-800 rounded-full px-2 py-0.5">Revisar</button>
              <button onClick={() => actions.onOpenConvert(item, 3)} className="text-xs bg-[#e8ddd3] text-red-900 rounded-full px-2 py-0.5">Me deben</button>
            </>
          )}
          <button
            onClick={() => actions.onToggleLongTerm(item)}
            className={`text-xs rounded-full px-2 py-0.5 ${item.is_long_term ? 'bg-gray-300 text-gray-700' : 'bg-gray-100 text-gray-500'}`}
            title={item.is_long_term ? 'Quitar de En el Radar' : 'Marcar como En el Radar'}
          >
            {item.is_long_term ? '✓ En el Radar' : 'En el Radar'}
          </button>
          <button onClick={() => actions.onDeleteItem(item)} className="text-xs text-red-400 px-1">✕</button>
        </div>
      </div>
      {commentEditor}
    </div>
  )
}
