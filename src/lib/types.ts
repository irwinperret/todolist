export type Project = {
  id: string
  name: string
  archived: boolean
}

export type Person = {
  id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  archived: boolean
}

export type Status = {
  id: number
  label: string
  urgency_weight: number
  sort_order: number
}

export type PriorityLevel = {
  id: number
  label: string
  weight: number
}

export type TaskScore = {
  id: string
  owner_id: string
  title: string
  subactivity: string | null
  project_id: string | null
  discipline: string | null
  responsible_id: string | null
  indirect_id: string | null
  type: string | null
  status_id: number
  priority_id: number
  location: string | null
  comment: string | null
  due_date: string | null
  follow_up_date: string | null
  resolution_notes: string | null
  resolved_at: string | null
  archived: boolean
  created_at: string
  updated_at: string
  priority_label: string
  priority_weight: number
  status_label: string
  status_weight: number
  due_weight: number
  blocking_count: number
  dependency_weight: number
  age_weight: number
  priority_score: number
}

export type TaskFollowup = {
  id: string
  task_id: string
  note: string
  created_at: string
}

export type TaskPhoto = {
  id: string
  task_id: string
  storage_path: string
  uploaded_at: string
}

export type TaskVoiceNote = {
  id: string
  task_id: string
  storage_path: string
  duration_seconds: number | null
  created_at: string
}

export type TaskDependency = {
  task_id: string
  depends_on_task_id: string
}

export type TaskLite = {
  id: string
  title: string
  status_id: number
}

export type Meeting = {
  id: string
  name: string
  archived: boolean
  created_at: string
}

export type MeetingMinute = {
  id: string
  meeting_id: string
  meeting_date: string
  attendees: string | null
  minuta: string
  acuerdos: string | null
  created_at: string
}

export type MeetingItem = {
  id: string
  meeting_minute_id: string
  content: string
  task_id: string | null
  group_label: string | null
  is_done: boolean
  sort_order: number
  created_at: string
}

export const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-orange-500',
  3: 'bg-yellow-500',
  4: 'bg-blue-400',
  5: 'bg-gray-400',
}
