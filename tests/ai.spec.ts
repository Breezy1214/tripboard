/**
 * AI co-planner e2e. The Playwright webServer sets TRIPBOARD_MOCK_EXTERNAL=1,
 * so the chat route swaps the model for the scripted test model
 * (src/ai/test-model.ts) and place search returns canned results. The route,
 * the tools, the caps and the records are the real ones; nothing is billed.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { action, agentTool, agentToolNames, createTrip, deleteTrip, isoInDays } from './helpers/trip'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(usableTestAccounts < 3, `Needs 3 usable test accounts, found ${usableTestAccounts}.`)
test.describe.configure({ timeout: 120_000 })

async function tripWithMember(owner: Page, member: Page, label: string) {
  await owner.goto('/home')
  const tripId = await createTrip(owner, label)
  const invite = await action(owner, 'createInvite', { tripId })
  await member.goto(`/join/${(invite.body.data as { code: string }).code}`)
  await member.waitForURL(`**/trips/${tripId}`, { timeout: 20_000 })
  return tripId
}

async function ask(page: Page, text: string) {
  const chat = page.getByTestId('trip-chat')
  const box = chat.getByLabel('Message the co-planner')
  await expect(box).toBeEnabled({ timeout: 20_000 })
  // Enter is ignored while a reply is still streaming; wait for the previous turn to finish.
  await expect(chat.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 20_000 })
  await box.fill(text)
  await box.press('Enter')
  return chat
}

test('tool list has the co-planner tools and no record writes', async ({ users }) => {
  const [alex] = await users(1)
  await alex.page.goto('/home')
  const names = await agentToolNames(alex.page)
  for (const name of ['get_trip', 'search_places', 'get_forecast', 'add_stop', 'move_stop', 'remove_stop', 'records_query']) {
    expect(names).toContain(name)
  }
  for (const name of ['records_create', 'records_update', 'records_delete']) expect(names).not.toContain(name)
})

test('a stop the AI adds for one member shows up live, marked, for the other', async ({ users }) => {
  const [alex, blair] = await users(2)
  let tripId: string | undefined
  try {
    tripId = await tripWithMember(alex.page, blair.page, 'AI live add')
    await alex.page.goto(`/trips/${tripId}`)
    await expect(alex.page.getByTestId('day-column')).toHaveCount(3)

    const chat = await ask(blair.page, 'add Sunset at the castle on day 2')
    await expect(chat.getByText('Done: add_stop finished.')).toBeVisible({ timeout: 20_000 })

    const alexDay2 = alex.page.getByTestId('day-column').nth(1)
    await expect(alexDay2.getByTestId('stop-title')).toHaveText(['Sunset at the castle'], { timeout: 15_000 })
    const blairName = (await blair.page.getByTestId('nav-user-name').textContent())?.trim()
    expect(blairName).toBeTruthy()
    await expect(alexDay2.getByTestId('stop-ai-badge')).toHaveText(`Added by AI for ${blairName}`)

    // The chat is the same one on reload: one chat per user per trip.
    await blair.page.reload()
    await expect(blair.page.getByTestId('trip-chat').getByText('add Sunset at the castle on day 2')).toBeVisible({
      timeout: 20_000,
    })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('the co-planner moves and removes stops through the chat, live for the other member', async ({ users }) => {
  const [alex, blair] = await users(2)
  let tripId: string | undefined
  try {
    tripId = await tripWithMember(alex.page, blair.page, 'AI move and remove')
    await action(alex.page, 'addStop', { tripId, day: isoInDays(2), title: 'Castle' })
    await action(alex.page, 'addStop', { tripId, day: isoInDays(2), title: 'Market' })
    await alex.page.goto(`/trips/${tripId}`)
    const alexDays = alex.page.getByTestId('day-column')
    await expect(alexDays.nth(0).getByTestId('stop-title')).toHaveText(['Castle', 'Market'], { timeout: 20_000 })

    const chat = await ask(blair.page, 'move Castle to day 3')
    await expect(chat.getByText('Done: move_stop finished.')).toBeVisible({ timeout: 20_000 })
    await expect(alexDays.nth(2).getByTestId('stop-title')).toHaveText(['Castle'], { timeout: 15_000 })
    await expect(alexDays.nth(0).getByTestId('stop-title')).toHaveText(['Market'])

    await ask(blair.page, 'remove Market')
    await expect(chat.getByText('Done: remove_stop finished.')).toBeVisible({ timeout: 20_000 })
    await expect(alexDays.nth(0).getByTestId('stop-card')).toHaveCount(0, { timeout: 15_000 })
    await expect(alexDays.nth(2).getByTestId('stop-title')).toHaveText(['Castle'])
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('a non-member cannot use the co-planner tools or chat on a trip', async ({ users }) => {
  const [alex, , casey] = await users(3)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    await casey.page.goto('/home')
    tripId = await createTrip(alex.page, 'AI non-member')
    const added = await agentTool(alex.page, 'add_stop', { tripId, day: isoInDays(2), title: 'Keep me' })
    expect(added).toMatchObject({ status: 200, body: { ok: true } })
    const stopId = (added.body.result as { stopId: string }).stopId

    for (const [name, input] of [
      ['add_stop', { tripId, day: isoInDays(2), title: 'Injected' }],
      ['move_stop', { tripId, stopId, day: isoInDays(3) }],
      ['remove_stop', { tripId, stopId }],
      ['search_places', { tripId, query: 'cafes' }],
      ['get_trip', { tripId }],
    ] as const) {
      const res = await agentTool(casey.page, name, input)
      expect(res, name).toMatchObject({ status: 403, body: { ok: false, error: 'You are not a member of this trip' } })
    }

    const chat = await casey.page.evaluate(async (tripId) => {
      const { token } = (await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()) as { token: string }
      const res = await fetch('/api/ai/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tripId }),
      })
      return { status: res.status, body: await res.json() }
    }, tripId)
    expect(chat.status).toBe(403)

    const trip = await agentTool(alex.page, 'get_trip', { tripId })
    expect((trip.body.result as { stops: { title: string }[] }).stops.map((s) => s.title)).toEqual(['Keep me'])
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('the server picks the model; a client modelId is ignored', async ({ users }) => {
  const [alex] = await users(1)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'AI model')
    const model = await alex.page.evaluate(async (tripId) => {
      const { token } = (await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()) as { token: string }
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      const created = await fetch('/api/ai/chats', { method: 'POST', headers, body: JSON.stringify({ tripId }) })
      const chatId = ((await created.json()) as { chat: { recordId: string } }).chat.recordId
      const turn = await fetch('/api/ai/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ chatId, userMessageId: `usr-${Date.now()}`, content: 'hello', modelId: 'claude-opus-5-5' }),
      })
      await turn.text()
      for (let i = 0; i < 20; i++) {
        const res = await fetch('/_deepspace/agent/browser/tools/records_get', {
          method: 'POST',
          headers,
          body: JSON.stringify({ input: { collection: 'ai-chats', recordId: chatId } }),
        })
        const body = (await res.json()) as { result?: { data?: { record?: { data?: { model?: string } } } } }
        const model = body.result?.data?.record?.data?.model
        if (model) return model
        await new Promise((r) => setTimeout(r, 250))
      }
      return null
    }, tripId)
    expect(model).toBe('claude-haiku-5-5')
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('an out-of-credits turn shows a clear message and the board keeps working', async ({ users }) => {
  const [alex] = await users(1)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'AI no credits')
    await alex.page.goto(`/trips/${tripId}`)

    const chat = await ask(alex.page, 'out of credits')
    await expect(chat.getByTestId('chat-error')).toContainText('The AI co-planner is out of credits for now', {
      timeout: 20_000,
    })

    // The over-cap refusal is a real server 429 in harden.spec.ts.

    const day1 = alex.page.getByTestId('day-column').first()
    await day1.getByTestId('add-stop-button').click()
    await day1.getByLabel('Title').fill('Added by hand')
    await day1.getByRole('button', { name: 'Add stop' }).click()
    await expect(day1.getByTestId('stop-title')).toHaveText(['Added by hand'])
    await expect(day1.getByTestId('stop-ai-badge')).toHaveCount(0)
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('on a phone the co-planner opens as a drawer', async ({ users }) => {
  const [alex] = await users(1)
  let tripId: string | undefined
  try {
    await alex.page.setViewportSize({ width: 390, height: 844 })
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'AI phone')
    await alex.page.goto(`/trips/${tripId}`)
    await expect(alex.page.getByTestId('trip-chat')).toBeHidden()
    await alex.page.getByTestId('open-chat-fab').click()
    const chat = alex.page.getByTestId('trip-chat')
    await expect(chat).toBeVisible()
    await ask(alex.page, 'search pastel de nata')
    await expect(chat.getByText('Done: search_places finished.')).toBeVisible({ timeout: 20_000 })
    await chat.getByRole('button', { name: 'Close co-planner' }).click()
    await expect(chat).toBeHidden()
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})
