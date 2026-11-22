import { getAuthToken } from 'deepspace'

export async function callAction<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in to continue')
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body.data as T
}

const PENDING_INVITE_KEY = 'tripboard:pending-invite'

export function rememberInvite(code: string) {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, code)
  } catch {
    // Storage can be blocked; the user can reopen the link after signing in.
  }
}

export function takePendingInvite(): string | null {
  try {
    const code = localStorage.getItem(PENDING_INVITE_KEY)
    localStorage.removeItem(PENDING_INVITE_KEY)
    return code
  } catch {
    return null
  }
}
