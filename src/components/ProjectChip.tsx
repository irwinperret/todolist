export default function ProjectChip({ name, color }: { name: string; color: string | null }) {
  if (!color) return <span className="text-gray-500 font-medium">{name}</span>
  return (
    <span className="rounded-full px-2 py-0.5 font-medium text-gray-800" style={{ backgroundColor: color }}>
      {name}
    </span>
  )
}
