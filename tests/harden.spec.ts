/**
 * Harden phase e2e: disconnected and error states with retry in place, the
 * real server-side spend caps, the OpenStreetMap place fallback, the sample
 * trip, trip delete rules and cascade, failed invites and the scoped roster.
 *
 * Paid calls are mocked inside the worker (TRIPBOARD_MOCK_EXTERNAL=1). Cap
 * tests run as Drew, an account no other spec uses, because filling a cap
 * locks that account out for the rest of the run. Tests in this file run in
 * order, so Drew's state is predictable.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page, WebSocketRoute } from '@playwright/test'
import { APP_ID, action, agentTool, createTrip, deleteTrip, isoInDays, testName } from './helpers/trip'

const accounts = loadAllTestAccounts()
test.skip(accounts.length < 4, `Needs 4 usable test accounts (Alex, Blair, Casey, Drew), found ${accounts.length}.`)
test.describe.configure({ timeout: 120_000 })

async function authed<T>(page: Page, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ path, init }) => {
      const { token } = (await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()) as { token: string }
      const res = await fetch(path, {
        method: init.method ?? 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
      return { status: res.status, body: (await res.json().catch(() => ({}))) as T }
    },
    { path, init },
  )
}

async function rows(page: Page, collection: string, where: Record<string, unknown>) {
  const res = await agentTool(page, 'records_query', { collection, where })
  return ((res.body.result as { data?: { records?: { recordId: string; data: Record<string, unknown> }[] } })?.data?.records ?? [])
}

async function ask(page: Page, text: string) {
  const chat = page.getByTestId('trip-chat')
  const box = chat.getByLabel('Message the co-planner')
  await expect(box).toBeEnabled({ timeout: 20_000 })
  await box.fill(text)
  await box.press('Enter')
  return chat
}

test('the sample trip button builds a board with days, stops and weather', async ({ users }) => {
  const [drew] = await users(['Drew'])
  await drew.page.goto('/home')
  for (const trip of await rows(drew.page, 'trips', {})) await deleteTrip(drew.page, trip.recordId)
  await drew.page.reload()
  await drew.page.getByTestId('sample-trip-button').click()
  await drew.page.waitForURL(/\/trips\/trip_/, { timeout: 20_000 })
  const tripId = drew.page.url().split('/trips/')[1]
  try {
    await expect(drew.page.getByTestId('day-column')).toHaveCount(3)
    await expect(drew.page.getByTestId('stop-card')).toHaveCount(5)
    await expect(drew.page.getByTestId('day-weather').first()).toContainText('°', { timeout: 20_000 })
  } finally {
    await deleteTrip(drew.page, tripId)
  }
})

test('a dropped socket keeps the board and an open editor, then editing resumes', async ({ users }) => {
  const [alex] = await users(1)
  const sockets: WebSocketRoute[] = []
  await alex.page.routeWebSocket(/\/ws\/app:/, (ws) => {
    sockets.push(ws)
    ws.connectToServer()
  })
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'Socket drop')
    await alex.page.goto(`/trips/${tripId}`)
    const day1 = alex.page.getByTestId('day-column').first()
    await expect(day1.getByTestId('add-stop-button')).toBeEnabled({ timeout: 20_000 })
    await day1.getByTestId('add-stop-button').click()
    await day1.getByLabel('Title').fill('Half typed stop')

    await Promise.all(sockets.map((ws) => ws.close()))
    await expect(alex.page.getByTestId('board-offline')).toBeVisible({ timeout: 10_000 })
    await expect(alex.page.getByTestId('trip-board')).toBeVisible()
    await expect(day1.getByLabel('Title')).toHaveValue('Half typed stop')
    await expect(alex.page.locator('[aria-busy="true"]')).toHaveCount(0)

    await expect(alex.page.getByTestId('board-offline')).toBeHidden({ timeout: 30_000 })
    await day1.getByRole('button', { name: 'Add stop' }).click()
    await expect(day1.getByTestId('stop-title')).toHaveText(['Half typed stop'], { timeout: 15_000 })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('a dropped socket on the trip list keeps the list and says it is reconnecting', async ({ users }) => {
  const [alex] = await users(1)
  const sockets: WebSocketRoute[] = []
  await alex.page.routeWebSocket(/\/ws\/app:/, (ws) => {
    sockets.push(ws)
    ws.connectToServer()
  })
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'List drop')
    const card = alex.page.getByTestId('trip-card').filter({ hasText: 'List drop' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await Promise.all(sockets.map((ws) => ws.close()))
    await expect(alex.page.getByTestId('trips-offline')).toBeVisible({ timeout: 10_000 })
    await expect(card).toBeVisible()
    await expect(alex.page.getByTestId('trips-offline')).toBeHidden({ timeout: 30_000 })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('a failed forecast offers Retry in place', async ({ users }) => {
  const [alex] = await users(1)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'Forecast retry')
    await alex.page.route('**/api/actions/refreshForecast', (route) => route.fulfill({ status: 500, body: '{}' }))
    await alex.page.goto(`/trips/${tripId}`)
    const weather = alex.page.getByTestId('day-weather').first()
    await expect(weather).toContainText('Weather unavailable', { timeout: 20_000 })
    await alex.page.unroute('**/api/actions/refreshForecast')
    await weather.getByRole('button', { name: 'Retry' }).first().click()
    await expect(weather).toContainText('°', { timeout: 20_000 })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('a trip whose destination cannot be found is still created, without weather', async ({ users }) => {
  const [alex] = await users(1)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    const res = await action(alex.page, 'createTrip', {
      name: testName('Nowhere trip'),
      destination: 'Nowhere at all',
      startDate: isoInDays(2),
      endDate: isoInDays(3),
    })
    expect(res.body).toMatchObject({ success: true, data: { located: false, geocodeSkipped: null } })
    tripId = (res.body.data as { tripId: string }).tripId
    await alex.page.goto(`/trips/${tripId}`)
    await expect(alex.page.getByTestId('day-weather').first()).toHaveText('No location for weather', { timeout: 20_000 })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('the server refuses a turn past the daily chat cap and saves nothing for it', async ({ users }) => {
  const [drew] = await users(['Drew'])
  let tripId: string | undefined
  try {
    await drew.page.goto('/home')
    tripId = await createTrip(drew.page, 'Chat cap')
    const chat = await authed<{ chat: { recordId: string } }>(drew.page, '/api/ai/chats', { body: { tripId } })
    const chatId = chat.body.chat.recordId

    const tooLong = await authed<{ code: string }>(drew.page, '/api/ai/chat', {
      body: { chatId, userMessageId: `usr-${Date.now()}`, content: 'x'.repeat(2001) },
    })
    expect(tooLong).toMatchObject({ status: 413, body: { code: 'too_long' } })

    expect((await action(drew.page, 'fillTestUsage', { kind: 'chat' })).body.success).toBe(true)
    await drew.page.goto(`/trips/${tripId}`)
    await expect(drew.page.getByTestId('trip-chat').getByLabel('Message the co-planner')).toHaveAttribute('maxlength', '2000')
    const panel = await ask(drew.page, 'add Late dinner on day 1')
    await expect(panel.getByTestId('chat-error')).toContainText('You have used your AI turns for today', { timeout: 20_000 })
    await expect(panel.getByTestId('chat-error').getByRole('button', { name: 'Retry' })).toHaveCount(0)

    const direct = await authed<{ code: string }>(drew.page, '/api/ai/chat', {
      body: { chatId, userMessageId: `usr-${Date.now()}`, content: 'hello' },
    })
    expect(direct).toMatchObject({ status: 429, body: { code: 'user_cap' } })
    expect(await rows(drew.page, 'ai-messages', { chatId })).toHaveLength(0)
    expect(await rows(drew.page, 'stops', { tripId })).toHaveLength(0)
  } finally {
    await deleteTrip(drew.page, tripId)
  }
})

test('place searches past the daily cap are refused before any call; cached ones still answer', async ({ users }) => {
  const [drew] = await users(['Drew'])
  let tripId: string | undefined
  try {
    await drew.page.goto('/home')
    tripId = await createTrip(drew.page, 'Places cap')
    const first = await agentTool(drew.page, 'search_places', { tripId, query: 'bakery' })
    expect(first.body).toMatchObject({ ok: true, result: { cached: false, source: 'serpapi' } })

    expect((await action(drew.page, 'fillTestUsage', { kind: 'places' })).body.success).toBe(true)
    const refused = await agentTool(drew.page, 'search_places', { tripId, query: 'museum' })
    expect(refused).toMatchObject({ status: 429, body: { ok: false, code: 'places_user_cap' } })
    const cached = await agentTool(drew.page, 'search_places', { tripId, query: 'Bakery' })
    expect(cached.body).toMatchObject({ ok: true, result: { cached: true } })
  } finally {
    await deleteTrip(drew.page, tripId)
  }
})

test('when SerpApi fails, OpenStreetMap answers and the chat credits it', async ({ users }) => {
  const [alex] = await users(1)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'OSM fallback')
    await alex.page.goto(`/trips/${tripId}`)
    const chat = await ask(alex.page, 'search osm bakery')
    await expect(chat.getByText('Done: search_places finished.')).toBeVisible({ timeout: 20_000 })
    await expect(chat.getByTestId('osm-attribution')).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')

    const again = await agentTool(alex.page, 'search_places', { tripId, query: 'osm bakery' })
    expect(again.body).toMatchObject({
      ok: true,
      result: { cached: true, source: 'openstreetmap', attribution: 'Place data © OpenStreetMap contributors (ODbL)' },
    })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('only the creator can delete a trip, and delete removes everything for every member', async ({ users }) => {
  const [alex, blair, casey] = await users(3)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    await casey.page.goto('/home')
    tripId = await createTrip(alex.page, 'Delete rules')
    await action(alex.page, 'addStop', { tripId, day: isoInDays(2), title: 'Doomed stop' })
    const invite = await action(alex.page, 'createInvite', { tripId })
    await blair.page.goto(`/join/${(invite.body.data as { code: string }).code}`)
    await blair.page.waitForURL(`**/trips/${tripId}`, { timeout: 20_000 })
    await expect(blair.page.getByTestId('stop-title')).toHaveText(['Doomed stop'], { timeout: 20_000 })
    expect((await authed(blair.page, '/api/ai/chats', { body: { tripId } })).status).toBe(200)

    for (const page of [blair.page, casey.page]) {
      const refused = await action(page, 'deleteTrip', { tripId })
      expect(refused.body).toMatchObject({ success: false, error: 'Only the person who created the trip can delete it' })
    }
    expect(await rows(blair.page, 'stops', { tripId })).toHaveLength(1)

    expect((await action(alex.page, 'deleteTrip', { tripId })).body.success).toBe(true)
    await expect(blair.page.getByTestId('trip-not-found')).toBeVisible({ timeout: 20_000 })
    for (const [collection, where] of [
      ['stops', { tripId }],
      ['trips', { teamId: tripId }],
      ['team_members', { teamId: tripId }],
      ['ai-chats', { tripId }],
    ] as const) {
      expect(await rows(blair.page, collection, where), collection).toHaveLength(0)
    }
    tripId = undefined
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('a bad invite link shows a clear error', async ({ users }) => {
  const [casey] = await users(['Casey'])
  await casey.page.goto('/join/zzzzzzzzzz')
  await expect(casey.page.getByRole('heading', { name: 'Could not join' })).toBeVisible({ timeout: 20_000 })
  await expect(casey.page.getByRole('alert')).toHaveText('That invite link is not valid or was removed')
  await casey.page.goto('/join/not-a-code')
  await expect(casey.page.getByRole('alert')).toHaveText('That invite link is not valid', { timeout: 20_000 })
})

test('the user roster holds only yourself; co-members get names from the trip', async ({ users }) => {
  const [alex, blair, casey] = await users(3)
  let tripId: string | undefined
  try {
    await casey.page.goto('/home')
    const roster = await casey.page.evaluate(async (appId) => {
      const { token } = (await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()) as { token: string }
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/app:${appId}?token=${token}`)
      return new Promise<string[] | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 10_000)
        ws.onopen = () => ws.send(JSON.stringify({ type: 'user.list', payload: {} }))
        ws.onmessage = (event) => {
          const msg = JSON.parse(String(event.data)) as { type: string; payload?: { users?: { id: string }[] } }
          if (msg.type !== 'user.list') return
          clearTimeout(timer)
          ws.close()
          resolve((msg.payload?.users ?? []).map((u) => u.id))
        }
      })
    }, APP_ID)
    expect(roster).toEqual([casey.userId])

    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'Roster names')
    const invite = await action(alex.page, 'createInvite', { tripId })
    // Blair joins without opening the board, so no presence carries her name.
    await blair.page.goto('/home')
    const blairName = (await blair.page.getByTestId('nav-user-name').textContent())?.trim()
    expect(blairName).toBeTruthy()
    expect((await action(blair.page, 'joinTrip', { code: (invite.body.data as { code: string }).code })).body.success).toBe(true)
    const members = await rows(alex.page, 'team_members', { teamId: tripId })
    expect(members.find((m) => m.data.userId === blair.userId)?.data.name).toBe(blairName)
    await alex.page.goto(`/trips/${tripId}`)
    await expect(alex.page.getByTestId('trip-members').getByTitle(`${blairName} (away)`)).toBeVisible({ timeout: 20_000 })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})
