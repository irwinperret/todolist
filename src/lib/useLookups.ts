import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Project, Person, Status, PriorityLevel } from './types'

export function useLookups() {
  const [projects, setProjects] = useState<Project[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [statuses, setStatuses] = useState<Status[]>([])
  const [priorities, setPriorities] = useState<PriorityLevel[]>([])
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    const [p1, p2, p3, p4] = await Promise.all([
      supabase.from('projects').select('*').eq('archived', false).order('name'),
      supabase.from('people').select('*').eq('archived', false).order('name'),
      supabase.from('statuses').select('*').order('sort_order'),
      supabase.from('priority_levels').select('*').order('id'),
    ])
    setProjects((p1.data as Project[]) ?? [])
    setPeople((p2.data as Person[]) ?? [])
    setStatuses((p3.data as Status[]) ?? [])
    setPriorities((p4.data as PriorityLevel[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [])

  return { projects, people, statuses, priorities, loading, reload }
}
