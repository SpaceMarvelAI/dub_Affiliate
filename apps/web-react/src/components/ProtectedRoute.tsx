import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

export function RequireAdmin() {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!user.isSuperAdmin) return <Navigate to="/links" replace />
  return <Outlet />
}
