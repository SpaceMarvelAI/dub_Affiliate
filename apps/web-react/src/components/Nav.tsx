import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { API_URL } from '../lib/api'

export default function Nav() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-gray-900">Affiliate</span>
          {user.isSuperAdmin ? (
            <>
              <Link to="/admin/partners" className="text-sm text-gray-600 hover:text-gray-900">
                Partners
              </Link>
              <Link to="/admin/commissions" className="text-sm text-gray-600 hover:text-gray-900">
                Commissions
              </Link>
            </>
          ) : (
            <Link to="/links" className="text-sm text-gray-600 hover:text-gray-900">
              Links
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          {/* Full page navigation, not fetch — clearing an httpOnly cookie needs a
              real HTTP response (Set-Cookie), same reasoning as the login button. */}
          <a href={`${API_URL}/api/auth/logout`} className="text-sm text-gray-600 hover:text-gray-900">
            Log out
          </a>
        </div>
      </div>
    </nav>
  )
}
