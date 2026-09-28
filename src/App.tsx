import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { FabProvider } from './lib/FabContext'
import { FeedbackProvider } from './lib/FeedbackContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

// Everything past the landing page loads on demand instead of going into the
// initial bundle. Meetings/MeetingDetail in particular pull in @dnd-kit,
// which is only needed once someone actually opens a meeting.
const TaskDetail = lazy(() => import('./pages/TaskDetail'))
const Archive = lazy(() => import('./pages/Archive'))
const Periodicas = lazy(() => import('./pages/Periodicas'))
const Recordatorios = lazy(() => import('./pages/Recordatorios'))
const ManageLists = lazy(() => import('./pages/ManageLists'))
const Meetings = lazy(() => import('./pages/Meetings'))
const MeetingDetail = lazy(() => import('./pages/MeetingDetail'))

const PageLoading = () => <div className="min-h-screen flex items-center justify-center text-gray-400">Cargando...</div>

function Gate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Cargando...</div>
  if (!session) return <Login />
  return <>{children}</>
}

export default function App() {
  return (
    <FeedbackProvider>
      <AuthProvider>
        <FabProvider>
          <BrowserRouter>
            <Gate>
              <Suspense fallback={<PageLoading />}>
                <Routes>
                  <Route element={<Layout />}>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/new" element={<TaskDetail />} />
                    <Route path="/task/:id" element={<TaskDetail />} />
                    <Route path="/archive" element={<Archive />} />
                    <Route path="/periodicas" element={<Periodicas />} />
                    <Route path="/recordatorios" element={<Recordatorios />} />
                    <Route path="/meetings" element={<Meetings />} />
                    <Route path="/meetings/:id" element={<MeetingDetail />} />
                    <Route path="/lists" element={<ManageLists />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </Gate>
          </BrowserRouter>
        </FabProvider>
      </AuthProvider>
    </FeedbackProvider>
  )
}
