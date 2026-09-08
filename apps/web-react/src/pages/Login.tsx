import { API_URL } from '../lib/api'

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white shadow-sm border border-gray-200 rounded-xl p-8 w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Welcome</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to manage your affiliate links.</p>
        {/* Full-page navigation, not a fetch call — this is a redirect flow. */}
        <a
          href={`${API_URL}/api/auth/login`}
          className="block w-full rounded-lg bg-gray-900 text-white py-2.5 text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          Continue with SpaceMarvel
        </a>
      </div>
    </div>
  )
}
