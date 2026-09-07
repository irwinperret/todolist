import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useFab } from '../lib/FabContext'
import OfflineBadge from './OfflineBadge'

const navItems = [
  { to: '/', label: 'To Do', icon: '📋' },
  { to: '/meetings', label: 'Reuniones', icon: '🗓️' },
  { to: '/periodicas', label: 'Periódicas', icon: '🔁' },
  { to: '/archive', label: 'Archivo', icon: '🗄️' },
  { to: '/lists', label: 'Listas', icon: '⚙️' },
  { to: '/recordatorios', label: 'Recordatorios', icon: '🔔' },
]

export default function Layout() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { fab } = useFab()

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <Link to="/" className="font-bold text-blue-900 text-lg">TO DO LIST</Link>
        <button
          onClick={async () => {
            await signOut()
          }}
          className="text-sm text-gray-500"
        >
          Salir
        </button>
      </header>

      <OfflineBadge />

      <main className="flex-1 pb-24">
        <Outlet />
      </main>

      <button
        onClick={fab ? fab.onClick : () => navigate('/new')}
        className={`fixed bottom-20 right-4 w-14 h-14 rounded-full text-white text-2xl shadow-lg flex items-center justify-center ${
          fab ? fab.color : 'bg-gray-900'
        }`}
        aria-label={fab ? fab.label : 'Nueva tarea'}
      >
        +
      </button>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs ${
                isActive ? 'text-gray-900 font-medium' : 'text-gray-400'
              }`
            }
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
