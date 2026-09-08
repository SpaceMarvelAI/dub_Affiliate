import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function Home() {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.isSuperAdmin ? '/admin/partners' : '/links'} replace />
}
