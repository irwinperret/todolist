export type Project = {
  id: string
  name: string
  archived: boolean
  color: string | null
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
  rutina_frequency: string | null
  postponed_until: string | null
  archived: boolean
  created_at: string
  updated_at: string
  priority_label: string
  priority_weight: number
  status_label: string
  status_weight: number
  due_weight: number
  blocking_count: number
  pending_dependency_count: number
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

export type MeetingCategory = {
  id: string
  meeting_minute_id: string
  parent_id: string | null
  name: string
  sort_order: number
}

export type MeetingItem = {
  id: string
  meeting_minute_id: string
  content: string
  comment: string | null
  task_id: string | null
  group_label: string | null
  category_id: string | null
  is_done: boolean
  is_long_term: boolean
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

export const LLAMAR_STATUS_ID = 1
export const EJECUTAR_STATUS_ID = 2

// The status pill on task cards is amber for everything, except Llamar
// (status 1) and Ejecutar (status 2), which get a fluorescent yellow so
// they jump out from the list.
export function statusPillClass(statusId: number): string {
  return statusId === LLAMAR_STATUS_ID || statusId === EJECUTAR_STATUS_ID
    ? 'bg-[#FFFF00] text-black'
    : 'bg-amber-100 text-amber-800'
}

// Project chip colors. A project with no saved color automatically gets one
// of the soft pastels (stable per project), so everything is colored from the
// start; the vivid ones are only ever used when you pick them yourself.
export const PASTEL_PROJECT_COLORS = [
  '#FBCFE8', '#FECACA', '#FED7AA', '#FDE68A', '#D9F99D', '#BBF7D0',
  '#99F6E4', '#A5F3FC', '#BFDBFE', '#C7D2FE', '#DDD6FE', '#E5E7EB',
]

export const VIVID_PROJECT_COLORS = [
  '#F43F5E', '#EF4444', '#F97316', '#FACC15', '#84CC16', '#22C55E',
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#D946EF',
]

export function projectColor(project: Pick<Project, 'id' | 'color'>): string {
  if (project.color) return project.color
  let h = 0
  for (const ch of project.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PASTEL_PROJECT_COLORS[h % PASTEL_PROJECT_COLORS.length]
}

// Dark text on light colors, white text on dark ones.
export function readableTextColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1f2937' : '#ffffff'
}
