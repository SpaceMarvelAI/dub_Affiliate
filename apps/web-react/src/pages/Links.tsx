import { useState, type FormEvent } from 'react'
import { useApi } from '../lib/useApi'
import { api, API_URL, type LinkItem } from '../lib/api'

export default function Links() {
  const { data: links, loading, error, setData } = useApi<LinkItem[]>('/api/links')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      const created = await api.post<LinkItem>('/api/links', { url, key: key || undefined })
      setData((prev) => (prev ? [created, ...prev] : [created]))
      setUrl('')
      setKey('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create link')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyToClipboard(shortUrl: string, id: string) {
    await navigator.clipboard.writeText(shortUrl)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-lg font-semibold text-gray-900 mb-6">Your links</h1>

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-gray-200 rounded-xl p-5 mb-8 flex flex-col sm:flex-row gap-3"
      >
        <input
          type="url"
          required
          placeholder="https://example.com/destination"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <input
          type="text"
          placeholder="custom-key (optional)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="sm:w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create link'}
        </button>
      </form>
      {formError && <p className="text-sm text-red-600 mb-4">{formError}</p>}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {links && links.length === 0 && !loading && (
        <p className="text-sm text-gray-500">No links yet. Create your first one above.</p>
      )}

      {links && links.length > 0 && (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-xl overflow-hidden bg-white">
          {links.map((link) => {
            const shortUrl = `${API_URL}/r/${link.key}`
            return (
              <li key={link.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{shortUrl}</p>
                  <p className="text-xs text-gray-500 truncate">{link.url}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0 ml-4">
                  <span className="text-xs text-gray-500">{link.clicksCount} clicks</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(shortUrl, link.id)}
                    className="text-xs font-medium text-gray-700 border border-gray-300 rounded-md px-2 py-1 hover:bg-gray-50"
                  >
                    {copiedId === link.id ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
