import type { TaskScore } from './types'
import { isOverdue } from './calendar'

// Shared "what color is this task card" logic. Dashboard and Periodicas used
// to each carry an identical copy of this; Recordatorios had a slightly
// simpler 3-state version (no orange follow-up highlight, since every task
// there already has a due date shown in the row). Kept as an option instead
// of unifying the visuals outright, so this refactor changes no behavior.
export function getTaskCardStyle(t: TaskScore, options?: { includeFollowUp?: boolean }): string {
  const includeFollowUp = options?.includeFollowUp ?? true

  const overdue = isOverdue(t.due_date, t.status_id)
  if (overdue) return 'bg-red-50 border-red-300'

  const isPrelada = t.pending_dependency_count > 0 || t.status_id === 6
  if (isPrelada) return 'bg-gray-200 border-gray-400'

  if (includeFollowUp) {
    const today = new Date().toISOString().slice(0, 10)
    const hasFollowUp = Boolean(t.due_date) && t.due_date! > today && t.status_id !== 8
    if (hasFollowUp) return 'bg-orange-50 border-orange-300'
  }

  return 'bg-white border-gray-200'
}
