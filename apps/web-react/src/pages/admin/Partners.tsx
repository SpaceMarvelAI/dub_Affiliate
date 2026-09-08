import { useApi } from '../../lib/useApi'
import type { Partner } from '../../lib/api'

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function Partners() {
  const { data: partners, loading, error } = useApi<Partner[]>('/api/admin/partners')

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-lg font-semibold text-gray-900 mb-6">Partners</h1>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {partners && (
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Links</th>
                <th className="px-4 py-2 font-medium">Total commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {partners.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-gray-900">{p.name}</td>
                  <td className="px-4 py-2 text-gray-500">{p.email}</td>
                  <td className="px-4 py-2 text-gray-500">{p.linkCount}</td>
                  <td className="px-4 py-2 text-gray-900">{formatCents(p.totalCommissionCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {partners.length === 0 && <p className="text-sm text-gray-500 px-4 py-6">No partners yet.</p>}
        </div>
      )}
    </div>
  )
}
