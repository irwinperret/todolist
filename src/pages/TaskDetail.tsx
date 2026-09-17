import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { TaskFollowup, TaskPhoto, TaskScore, TaskLite, TaskVoiceNote } from '../lib/types'
import { useFormatShortcuts, formatRichText } from '../components/RichText'
import { getFreedTasks, type FreedTask } from '../lib/dependencies'
import FreedTasksModal from '../components/FreedTasksModal'

type DependencyLite = TaskLite & { resolved_at: string | null }

export default function TaskDetail() {
  const { id } = useParams()
  const isNew = id === 'new' || !id
  const navigate = useNavigate()
  const location = useLocation()
  const fromMeetingId = (location.state as { fromMeetingId?: string } | null)?.fromMeetingId
  const returnTo = fromMeetingId ? `/meetings/${fromMeetingId}` : '/'
  const { projects, people, statuses, priorities, reload: reloadLookups } = useLookups()

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
  })
  const [showMore, setShowMore] = useState(!isNew)
  const [followups, setFollowups] = useState<TaskFollowup[]>([])
  const [photos, setPhotos] = useState<TaskPhoto[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [resolutionPrompt, setResolutionPrompt] = useState(false)
  const [resolutionText, setResolutionText] = useState('')
  const commentShortcuts = useFormatShortcuts<HTMLTextAreaElement>(task.comment ?? '', (v) => setTask({ ...task, comment: v }))
  const newNoteShortcuts = useFormatShortcuts<HTMLInputElement>(newNote, setNewNote)
  const resolutionShortcuts = useFormatShortcuts<HTMLTextAreaElement>(resolutionText, setResolutionText)
  const [freedTasks, setFreedTasks] = useState<FreedTask[] | null>(null)
  const [postponePrompt, setPostponePrompt] = useState(false)
  const [postponeDate, setPostponeDate] = useState('')

  const [dependsOn, setDependsOn] = useState<DependencyLite[]>([])
  const [blocks, setBlocks] = useState<DependencyLite[]>([])
  const [depSearch, setDepSearch] = useState('')
  const [depResults, setDepResults] = useState<TaskLite[]>([])
  const [depSearching, setDepSearching] = useState(false)

  const [creatingPerson, setCreatingPerson] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')

  const [voiceNotes, setVoiceNotes] = useState<TaskVoiceNote[]>([])
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({})
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [uploadingVoice, setUploadingVoice] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const draftIdRef = useRef<string | null>(null)
  const recordingTaskIdRef = useRef<string | null>(null)

  const load = async (overrideId?: string) => {
    const taskId = overrideId ?? id
    if (!taskId || taskId === 'new') return
    const { data } = await supabase.from('task_scores').select('*').eq('id', taskId).single()
    if (data) setTask(data as TaskScore)

    const { data: fu } = await supabase
      .from('task_followups')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    setFollowups((fu as TaskFollowup[]) ?? [])

    const { data: ph } = await supabase
      .from('task_photos')
      .select('*')
      .eq('task_id', taskId)
      .order('uploaded_at', { ascending: false })
    setPhotos((ph as TaskPhoto[]) ?? [])

    const { data: dependsOnRows } = await supabase
      .from('task_dependencies')
      .select('depends_on_task_id, resolved_at, tasks:depends_on_task_id(id, title, status_id)')
      .eq('task_id', taskId)
    setDependsOn(
      ((dependsOnRows as any[]) ?? [])
        .filter((r) => r.tasks)
        .map((r) => ({ ...r.tasks, resolved_at: r.resolved_at })) as DependencyLite[]
    )

    const { data: blocksRows } = await supabase
      .from('task_dependencies')
      .select('task_id, resolved_at, tasks:task_id(id, title, status_id)')
      .eq('depends_on_task_id', taskId)
    setBlocks(
      ((blocksRows as any[]) ?? [])
        .filter((r) => r.tasks)
        .map((r) => ({ ...r.tasks, resolved_at: r.resolved_at })) as DependencyLite[]
    )

    const { data: vn } = await supabase
      .from('task_voice_notes')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    setVoiceNotes((vn as TaskVoiceNote[]) ?? [])
  }

  const ensureTaskId = async (): Promise<string | null> => {
    if (!isNew) return id ?? null
    if (draftIdRef.current) return draftIdRef.current
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: task.title?.trim() || 'Nueva actividad',
        project_id: task.project_id || null,
        responsible_id: task.responsible_id || null,
        status_id: task.status_id ?? 2,
        priority_id: task.priority_id ?? 4,
      })
      .select()
      .single()
    if (error) {
      alert(error.message)
      return null
    }
    draftIdRef.current = data.id
    navigate(`/task/${data.id}`, { replace: true })
    return data.id
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    photos.forEach(async (p) => {
      if (photoUrls[p.id]) return
      const { data } = await supabase.storage.from('task-photos').createSignedUrl(p.storage_path, 60 * 60)
      if (data?.signedUrl) setPhotoUrls((prev) => ({ ...prev, [p.id]: data.signedUrl }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos])

  useEffect(() => {
    voiceNotes.forEach(async (v) => {
      if (voiceUrls[v.id]) return
      const { data } = await supabase.storage.from('task-voice-notes').createSignedUrl(v.storage_path, 60 * 60)
      if (data?.signedUrl) setVoiceUrls((prev)
