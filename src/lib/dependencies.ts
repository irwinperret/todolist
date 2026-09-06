import { supabase } from './supabase'

export type FreedTask = { id: string; title: string }

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
