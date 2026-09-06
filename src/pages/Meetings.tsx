import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Meeting } from '../lib/types'

export default function Meetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [newMeeting, setNewMeeting] = useState('')
  const [lastDates, setLastDates] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('meetings')
      .select('*')
      .eq('archived', false)
      .order('created_at')
    setMeetings((data as Meeting[]) ?? [])

    const ids = ((data as Meeting[]) ?? []).map((m) => m.id)
    if (ids.length > 0) {
      const { data: minutes } = await supabase
        .from('meeting_minutes')
        .select('meeting_id, meeting_date')
        .in('meeting_id', ids)
        .order('meeting_date', { ascending: false })
      const map: Record<string, string> = {}
      for (const row of (minutes as { meeting_id: string; meeting_date: string }[]) ?? []) {
        if (!map[row.meeting_id]) map[row.meeting_id] = row.meeting_date
      }
      setLastDates(map)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const addMeeting = async () => {
    if (!newMeeting.trim()) return
    const { error } = await supabase.from('meetings').insert({ name: newMeeting.trim() })
    if (!error) {
      setNewMeeting('')
      load()
    } else {
      alert(error.message)
    }
  }

  return (
    <div className="px-4 pt-4 space-y-3 pb-8">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Nueva reunión recurrente"
          value={newMeeting}
          onChange={(e) => setNewMeeting(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addMeeting()}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-base bg-white"
        />
        <button onClick={addMeeting} className="bg-gray-900 text-white rounded-lg px-4 text-sm">
          Agregar
        </button>
      </div>

      {loading && <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>}
      {!loading && meetings.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">No hay reuniones todavía.</p>
      )}

      <div className="space-y-2">
        {meetings.map((m) => (
          <Link
            key={m.id}
            to={`/meetings/${m.id}`}
            className="block bg-white border border-gray-200 rounded-xl p-4 active:bg-gray-50"
          >
            <p className="font-medium text-gray-900">{m.name}</p>
            <p className="text-xs text-gray-400 mt-1">
              {lastDates[m.id]
                ? `Última minuta: ${new Date(lastDates[m.id] + 'T00:00:00').toLocaleDateString()}`
                : 'Sin minutas todavía'}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
