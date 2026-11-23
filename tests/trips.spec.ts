/**
 * Trip board e2e: create, edit and reorder stops, live sync between members,
 * RBAC for an excluded user, and the invite flow.
 *
 * Paid and external calls never leave the worker in these runs: the
 * Playwright webServer sets TRIPBOARD_MOCK_EXTERNAL=1, so geocoding and the
 * Open-Meteo forecast return canned data (see src/server/trip-services.ts).
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { action, agentTool, createTrip, deleteTrip, isoInDays, presenceAccepted, recordSocketWrite, testName } from './helpers/trip'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(usableTestAccounts < 3, `Needs 3 usable test accounts, found ${usableTestAccounts}.`)
test.describe.configure({ timeout: 120_000 })

test('create a trip, then add, edit, reorder and delete stops', async ({ users }) => {
  const [alex] = await users(1)
  const { page } = alex
  const name = testName('Board flow')
  let tripId: string | undefined
  try {
    await page.goto('/home')
    await page.getByTestId('new-trip-button').click()
    await page.getByLabel('Trip name').fill(name)
    await page.getByLabel('Destination').fill('Lisbon')
    await page.getByLabel('Start date').fill(isoInDays(2))
    await page.getByLabel('End date').fill(isoInDays(4))
    await page.getByRole('button', { name: 'Create trip' }).click()
    await page.waitForURL(/\/trips\/trip_/, { timeout: 20_000 })
    tripId = page.url().split('/trips/')[1]

    await expect(page.getByTestId('trip-name')).toHaveText(name)
    await expect(page.getByText('Lisbon (test)')).toBeVisible()
    const columns = page.getByTestId('day-column')
    await expect(columns).toHaveCount(3)
    await expect(columns.first().getByTestId('day-weather')).toContainText('°', { timeout: 20_000 })

    const day1 = columns.nth(0)
    for (const title of ['Coffee', 'Museum']) {
      await expect(day1.getByTestId('add-stop-button')).toBeEnabled({ timeout: 20_000 })
      await day1.getByTestId('add-stop-button').click()
      await day1.getByLabel('Title').fill(title)
      await day1.getByRole('button', { name: 'Add stop' }).click()
      await expect(day1.getByTestId('stop-title').filter({ hasText: title })).toBeVisible()
    }
    await expect(day1.getByTestId('stop-title')).toHaveText(['Coffee', 'Museum'])

    await day1.getByRole('button', { name: 'Move Museum up' }).click()
    await expect(day1.getByTestId('stop-title')).toHaveText(['Museum', 'Coffee'])

    await day1.getByRole('button', { name: 'Edit Coffee' }).click()
    const editor = day1.getByTestId('stop-editor')
    await editor.getByLabel('Title').fill('Coffee at the kiosk')
    await editor.getByLabel('Day').selectOption(isoInDays(3))
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(columns.nth(1).getByTestId('stop-title')).toHaveText(['Coffee at the kiosk'])
    await expect(day1.getByTestId('stop-title')).toHaveText(['Museum'])

    await day1.getByRole('button', { name: 'Delete Museum' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(day1.getByTestId('stop-card')).toHaveCount(0)

    await page.reload()
    await expect(columns.nth(1).getByTestId('stop-title')).toHaveText(['Coffee at the kiosk'], { timeout: 20_000 })
  } finally {
    await deleteTrip(page, tripId)
  }
})

test('days outside the 16-day window say when the forecast opens', async ({ users }) => {
  const [alex] = await users(1)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'Far future', { startInDays: 40, length: 2 })
    await alex.page.goto(`/trips/${tripId}`)
    await expect(alex.page.getByTestId('day-weather').first()).toHaveText('Forecast opens 16 days before', {
      timeout: 20_000,
    })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('two members see each other live, with presence per day', async ({ users }) => {
  const [alex, blair] = await users(2)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'Live sync')
    const invite = await action(alex.page, 'createInvite', { tripId })
    const code = (invite.body.data as { code: string }).code

    await blair.page.goto(`/join/${code}`)
    await blair.page.waitForURL(`**/trips/${tripId}`, { timeout: 20_000 })
    await alex.page.goto(`/trips/${tripId}`)

    const alexDay1 = alex.page.getByTestId('day-column').first()
    const blairDay1 = blair.page.getByTestId('day-column').first()
    await expect(alexDay1.getByTestId('add-stop-button')).toBeEnabled({ timeout: 20_000 })
    await alexDay1.getByTestId('add-stop-button').click()
    await alexDay1.getByLabel('Title').fill('Alex adds dinner')
    await alexDay1.getByRole('button', { name: 'Add stop' }).click()
    await expect(blairDay1.getByTestId('stop-title')).toHaveText(['Alex adds dinner'], { timeout: 15_000 })

    const edit = blairDay1.getByRole('button', { name: 'Edit Alex adds dinner' })
    await expect(edit).toBeEnabled({ timeout: 20_000 })
    await edit.click()
    await blairDay1.getByTestId('stop-editor').getByLabel('Title').fill('Dinner, edited by Blair')
    await blairDay1.getByTestId('stop-editor').getByRole('button', { name: 'Save' }).click()
    await expect(alexDay1.getByTestId('stop-title')).toHaveText(['Dinner, edited by Blair'], { timeout: 15_000 })

    await expect(alex.page.getByTestId('presence-summary')).toContainText('here now', { timeout: 15_000 })
    await expect(alex.page.getByTestId('trip-members').locator(':scope > span')).toHaveCount(2)
    await blair.page.getByTestId('day-column').nth(1).hover()
    await expect(alex.page.getByTestId('day-column').nth(1).getByTestId('day-viewers')).toBeVisible({
      timeout: 15_000,
    })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('an excluded user cannot read, create, update or delete stops', async ({ users }) => {
  const [alex, , casey] = await users(3)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    await casey.page.goto('/home')
    tripId = await createTrip(alex.page, 'Private trip')
    const added = await action(alex.page, 'addStop', { tripId, day: isoInDays(2), title: 'Secret stop' })
    expect(added.body.success).toBe(true)
    const stopId = (added.body.data as { stopId: string }).stopId

    await casey.page.goto(`/trips/${tripId}`)
    await expect(casey.page.getByTestId('trip-not-found')).toBeVisible({ timeout: 20_000 })
    await expect(casey.page.getByText('Secret stop')).toHaveCount(0)

    const read = await agentTool(casey.page, 'records_query', { collection: 'stops', where: { tripId } })
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({ ok: true, result: { success: true, data: { records: [], count: 0 } } })
    const get = await agentTool(casey.page, 'records_get', { collection: 'stops', recordId: stopId })
    expect(get.body.error).toContain('READ DENIED')
    const tripRead = await agentTool(casey.page, 'records_query', { collection: 'trips', where: { teamId: tripId } })
    expect(JSON.stringify(tripRead.body)).not.toContain('Private trip')

    // Direct writes go over the records WebSocket, the same path useMutations uses.
    const update = await recordSocketWrite(casey.page, { op: 'put', collection: 'stops', recordId: stopId, data: { title: 'Hijacked' } })
    expect(update).toMatchObject({ success: false })
    expect(update.error).toContain('UPDATE DENIED')
    const del = await recordSocketWrite(casey.page, { op: 'delete', collection: 'stops', recordId: stopId })
    expect(del).toMatchObject({ success: false })
    expect(del.error).toContain('DELETE DENIED')
    const create = await recordSocketWrite(casey.page, {
      op: 'put',
      collection: 'stops',
      data: { tripId, day: isoInDays(2), title: 'Injected stop', position: 1 },
    })
    expect(create).toMatchObject({ success: false })
    expect(create.error).toContain('CREATE DENIED')
    // The co-planner's write tools refuse a non-member the same way.
    const aiAdd = await agentTool(casey.page, 'add_stop', { tripId, day: isoInDays(2), title: 'Injected by AI' })
    expect(aiAdd).toMatchObject({ status: 403, body: { ok: false, error: 'You are not a member of this trip' } })
    // Built-in record writes are not offered as tools at all.
    expect((await agentTool(casey.page, 'records_create', { collection: 'stops', data: {} })).status).toBe(404)
    const viaAction = await action(casey.page, 'addStop', { tripId, day: isoInDays(2), title: 'Injected stop' })
    expect(viaAction.body).toMatchObject({ success: false, error: 'You are not a member of this trip' })
    const inviteAttempt = await action(casey.page, 'createInvite', { tripId })
    expect(inviteAttempt.body.success).toBe(false)
    expect(await presenceAccepted(casey.page, tripId)).toBe(false)

    const selfAdd = await recordSocketWrite(casey.page, {
      op: 'put',
      collection: 'team_members',
      data: { teamId: tripId, userId: casey.userId ?? 'casey', status: 'active', role: 'member' },
    })
    expect(selfAdd).toMatchObject({ success: false })
    expect(selfAdd.error).toContain('CREATE DENIED')

    // Members go through addStop too: 'team' cannot gate create, so create is closed for everyone.
    const memberCreate = await recordSocketWrite(alex.page, {
      op: 'put',
      collection: 'stops',
      data: { tripId, day: isoInDays(2), title: 'Direct write', position: 9 },
    })
    expect(memberCreate).toMatchObject({ success: false })
    expect(memberCreate.error).toContain('CREATE DENIED')
    const moveTrip = await recordSocketWrite(alex.page, {
      op: 'put',
      collection: 'stops',
      recordId: stopId,
      data: { tripId: 'trip_someone_else' },
    })
    expect(moveTrip).toMatchObject({ success: false })
    expect(moveTrip.error).toContain("Cannot modify immutable field 'tripId'")
    expect((await action(alex.page, 'createInvite', { tripId })).body.success).toBe(true)
    const invites = await agentTool(alex.page, 'records_query', { collection: 'trip_invites', where: { tripId } })
    expect(invites.body).toMatchObject({ result: { data: { records: [], count: 0 } } })
    expect(await presenceAccepted(alex.page, tripId)).toBe(true)

    await alex.page.goto(`/trips/${tripId}`)
    await expect(alex.page.getByTestId('stop-title')).toHaveText(['Secret stop'], { timeout: 20_000 })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('a third user joins through the invite link and sees the trip', async ({ users }) => {
  const [alex, , casey] = await users(3)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'Invite flow')
    await action(alex.page, 'addStop', { tripId, day: isoInDays(2), title: 'Welcome drinks' })

    await alex.page.goto(`/trips/${tripId}`)
    await alex.page.getByTestId('invite-button').click()
    const linkField = alex.page.getByTestId('invite-link')
    await expect(linkField).toHaveValue(/\/join\/[a-z0-9]{10}$/, { timeout: 15_000 })
    const link = await linkField.inputValue()

    await casey.page.goto(new URL(link).pathname)
    await casey.page.waitForURL(`**/trips/${tripId}`, { timeout: 20_000 })
    await expect(casey.page.getByTestId('stop-title')).toHaveText(['Welcome drinks'], { timeout: 20_000 })

    await casey.page.goto('/home')
    await expect(casey.page.getByTestId('trip-card').filter({ hasText: 'Invite flow' })).toBeVisible({
      timeout: 15_000,
    })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

test('a stop can only move to a day inside its trip', async ({ users }) => {
  const [alex] = await users(1)
  let tripId: string | undefined
  try {
    await alex.page.goto('/home')
    tripId = await createTrip(alex.page, 'Day rules', { startInDays: 2, length: 3 })
    const added = await action(alex.page, 'addStop', { tripId, day: isoInDays(2), title: 'Movable stop' })
    const stopId = (added.body.data as { stopId: string }).stopId

    const direct = await recordSocketWrite(alex.page, { op: 'put', collection: 'stops', recordId: stopId, data: { day: isoInDays(30) } })
    expect(direct).toMatchObject({ success: false })

    const outside = await action(alex.page, 'moveStop', { tripId, stopId, day: isoInDays(30) })
    expect(outside.body).toMatchObject({ success: false, error: 'That day is outside the trip' })

    const inside = await action(alex.page, 'moveStop', { tripId, stopId, day: isoInDays(3) })
    expect(inside.body).toMatchObject({ success: true, data: { stopId, day: isoInDays(3), position: 1 } })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})
