import type { Page } from '@playwright/test'

export interface Json {
  status: number
  body: Record<string, unknown> & { success?: boolean; ok?: boolean; error?: unknown; data?: Record<string, unknown> }
}

export function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

export function testName(label: string): string {
  return `__test-${Date.now()}__ ${label}`
}

/** POST as the page's signed-in user, with the same bearer token the app uses. */
async function post(page: Page, path: string, payload: unknown): Promise<Json> {
  return page.evaluate(
    async ({ path, payload }) => {
      const tokenRes = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const { token } = (await tokenRes.json()) as { token?: string }
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
    { path, payload },
  )
}

export function action(page: Page, name: string, params: Record<string, unknown>): Promise<Json> {
  return post(page, `/api/actions/${name}`, params)
}

/**
 * Calls a built-in record tool through the app's browser agent route. It runs
 * as the caller with RBAC on, the same checks the RecordRoom applies to
 * WebSocket writes.
 */
export function recordTool(page: Page, name: string, input: Record<string, unknown>): Promise<Json> {
  return post(page, `/_deepspace/agent/browser/tools/${name}`, { input })
}

export async function createTrip(
  page: Page,
  label: string,
  { startInDays = 2, length = 3 }: { startInDays?: number; length?: number } = {},
): Promise<string> {
  const res = await action(page, 'createTrip', {
    name: testName(label),
    destination: 'Lisbon',
    startDate: isoInDays(startInDays),
    endDate: isoInDays(startInDays + length - 1),
  })
  if (!res.body.success) throw new Error(`createTrip failed: ${JSON.stringify(res.body)}`)
  return (res.body.data as { tripId: string }).tripId
}

export async function deleteTrip(page: Page, tripId: string | undefined) {
  if (!tripId) return
  try {
    await action(page, 'deleteTrip', { tripId })
  } catch {
    // Best-effort cleanup.
  }
}

/** Whether a WebSocket to the trip's presence room is accepted for this user. */
export function presenceAccepted(page: Page, tripId: string): Promise<boolean> {
  return page.evaluate(async (tripId) => {
    const tokenRes = await fetch('/api/auth/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    const { token } = (await tokenRes.json()) as { token?: string }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`${proto}://${location.host}/ws/presence/trip:${tripId}?token=${token}`)
      const timer = setTimeout(() => resolve(false), 8000)
      ws.onopen = () => {
        clearTimeout(timer)
        ws.close()
        resolve(true)
      }
      ws.onerror = () => {
        clearTimeout(timer)
        resolve(false)
      }
    })
  }, tripId)
}
