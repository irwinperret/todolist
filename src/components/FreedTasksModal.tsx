import { Link } from 'react-router-dom'
import type { FreedTask } from '../lib/dependencies'

export default function FreedTasksModal({ tasks, onClose }: { tasks: FreedTask[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-30" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl p-4 w-full sm:max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium text-gray-900">
          {tasks.length === 1 ? 'Se liberó una actividad' : `Se liberaron ${tasks.length} actividades`}
        </p>
        <div className="space-y-1">
          {tasks.map((t) => (
            <Link
              key={t.id}
              to={`/task/${t.id}`}
              onClick={onClose}
              className="block text-sm text-blue-700 border-l-2 border-green-300 pl-2 py-1 hover:text-blue-900"
            >
              {t.title}
            </Link>
          ))}
        </div>
        <button onClick={onClose} className="w-full bg-gray-900 text-white rounded-lg py-2.5 text-sm">
          Entendido
        </button>
      </div>
    </div>
  )
}
