import { useApi } from '../../lib/useApi'
import type { Commission } from '../../lib/api'

// Assumption: `amount` is in cents (like Partner.totalCommissionCents), consistent
// with the rest of the contract. Confirm with the backend if it's actually a decimal.
function formatAmount(amount: number, currency: string) {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency })
}

export default function Commissions() {
  const { data: commissions, loading, error } = useApi<Commission[]>('/api/admin/commissions')

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-lg font-semibold text-gray-900 mb-6">Commissions</h1>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {commissions && (
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Partner</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {commissions.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-gray-900">{c.partner.name}</td>
                  <td className="px-4 py-2 text-gray-500">{c.customer.email}</td>
                  <td className="px-4 py-2 text-gray-900">{formatAmount(c.amount, c.currency)}</td>
                  <td className="px-4 py-2 text-gray-500 capitalize">{c.status}</td>
                  <td className="px-4 py-2 text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {commissions.length === 0 && <p className="text-sm text-gray-500 px-4 py-6">No commissions yet.</p>}
        </div>
      )}
    </div>
  )
}
