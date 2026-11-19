import { supabase } from './supabase'

export type FreedTask = { id: string; title: string }

// Any task postponed (status Prelada with a postponed_until date) whose date
// has arrived gets returned to Ejecutar automatically. Called once whenever
// a list screen loads, before the fetched tasks are shown.
export async function reconcilePostponedTasks(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('tasks')
    .select('id, postponed_until')
    .eq('status_id', 6)
    .lte('postponed_until', today)
  const byDate = new Map<string, string[]>()
  for (const r of (data as { id: string; postponed_until: string }[]) ?? []) {
    byDate.set(r.postponed_until, [...(byDate.get(r.postponed_until) ?? []), r.id])
  }
  // returned_from_postponed remembers the date it came back, so the To Do can
  // flag it until the task is opened or its status/date is changed.
  for (const [date, ids] of byDate) {
    await supabase
      .from('tasks')
      .update({ status_id: 2, postponed_until: null, returned_from_postponed: date })
      .in('id', ids)
  }
}

// Call this right after marking a task's outgoing dependencies as resolved.
// Returns the tasks that were waiting on it and now have zero remaining
// unresolved prelaciones, i.e. they're fully freed up.
export async function getFreedTasks(completedTaskId: string): Promise<FreedTask[]> {
  const { data: blockedRows } = await supabase
    .from('task_dependencies')
    .select('task_id')
    .eq('depends_on_task_id', completedTaskId)

  const blockedIds = Array.from(new Set(((blockedRows as { task_id: string }[]) ?? []).map((r) => r.task_id)))
  if (blockedIds.length === 0) return []

  const { data: stillBlockedRows } = await supabase
    .from('task_dependencies')
    .select('task_id')
    .in('task_id', blockedIds)
    .is('resolved_at', null)

  const stillBlockedIds = new Set(((stillBlockedRows as { task_id: string }[]) ?? []).map((r) => r.task_id))
  const freedIds = blockedIds.filter((tid) => !stillBlockedIds.has(tid))
  if (freedIds.length === 0) return []

  const { data: tasks } = await supabase.from('tasks').select('id, title').in('id', freedIds)
  return (tasks as FreedTask[]) ?? []
}
