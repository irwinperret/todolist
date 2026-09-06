import { PRIORITY_COLORS } from '../lib/types'

export default function PriorityBadge({ id, label }: { id: number; label: string }) {
  const color = PRIORITY_COLORS[id] ?? 'bg-gray-400'
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-white rounded-full px-2 py-0.5 ${color}`}>
      {label}
    </span>
  )
}
