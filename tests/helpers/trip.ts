import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
 * Calls an app tool (a read-only record tool or a co-planner tool) through the
 * browser agent route, as the caller. The same tools serve the in-app chat and
 * local agents.
 */
export function agentTool(page: Page, name: string, input: Record<string, unknown>): Promise<Json> {
  return post(page, `/_deepspace/agent/browser/tools/${name}`, { input })
}

/** Tool names the browser agent route lists for the signed-in user. */
export function agentToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const tokenRes = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
    const { token } = (await tokenRes.json()) as { token?: string }
    const res = await fetch('/_deepspace/agent/browser/tools', { headers: { Authorization: `Bearer ${token}` } })
    const body = (await res.json()) as { tools?: { name: string }[] }
    return (body.tools ?? []).map((t) => t.name)
  })
}

const APP_ID = /DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/.exec(
  readFileSync(fileURLToPath(new URL('../../wrangler.toml', import.meta.url)), 'utf8'),
)?.[1]

export type RecordWrite =
  | { op: 'put'; collection: string; recordId?: string; data: Record<string, unknown> }
  | { op: 'delete'; collection: string; recordId: string }

/**
 * Sends one write over the records WebSocket as the page's user, exactly as
 * useMutations does, and returns the room's ack. RBAC runs in the RecordRoom.
 */
export function recordSocketWrite(page: Page, write: RecordWrite): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(
    async ({ write, appId }) => {
      const tokenRes = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
      const { token } = (await tokenRes.json()) as { token?: string }
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws/app:${appId}?token=${token}`)
      const requestId = `test-${crypto.randomUUID()}`
      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        const done = (result: { success: boolean; error?: string }) => {
          clearTimeout(timer)
          ws.close()
          resolve(result)
        }
        const timer = setTimeout(() => done({ success: false, error: 'timeout' }), 10_000)
        ws.onopen = () => {
          const payload =
            write.op === 'put'
              ? { collection: write.collection, recordId: write.recordId ?? `rec_${crypto.randomUUID()}`, data: write.data, requestId }
              : { collection: write.collection, recordId: write.recordId, requestId }
          ws.send(JSON.stringify({ type: write.op === 'put' ? 'core.put' : 'core.delete', payload }))
        }
        ws.onmessage = (event) => {
          const msg = JSON.parse(String(event.data)) as { type: string; payload?: { requestId?: string; success?: boolean; error?: string } }
          if (msg.type === 'records.ack' && msg.payload?.requestId === requestId) {
            done({ success: !!msg.payload.success, error: msg.payload.error })
          } else if (msg.type === 'core.error' && !msg.payload?.requestId) {
            done({ success: false, error: msg.payload?.error })
          }
        }
        ws.onerror = () => done({ success: false, error: 'socket error' })
      })
    },
    { write, appId: APP_ID },
  )
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
