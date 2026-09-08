export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export class UnauthorizedError extends Error {}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
}

export interface Me {
  id: string
  email: string
  name: string
  isSuperAdmin: boolean
}

export interface LinkItem {
  id: string
  key: string
  url: string
  clicksCount: number
  createdAt: string
}

export interface Partner {
  id: string
  name: string
  email: string
  linkCount: number
  totalCommissionCents: number
}

export interface Commission {
  id: string
  amount: number
  currency: string
  status: string
  createdAt: string
  partner: { name: string; email: string }
  customer: { email: string }
}
