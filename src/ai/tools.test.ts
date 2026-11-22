import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentToolError } from 'deepspace/worker'
import type { ActionTools, AgentToolContext } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { addDays, todayIso } from '../lib/trip-dates'
import { fakeTools } from '../server/fake-tools'

const state = vi.hoisted(() => ({ asUser: null as unknown as (userId: string) => ActionTools }))
vi.mock('../server/action-routes.js', () => ({ createActionTools: (_env: unknown, userId: string) => state.asUser(userId) }))

const { ALLOWED_TOOL_NAMES, CUSTOM_TOOL_NAMES, buildTools } = await import('./tools')

const START = addDays(todayIso(), 2)
const TRIP = 'trip_1'

type Exec = (input: Record<string, unknown>) => Promise<unknown>

let fake: ReturnType<typeof fakeTools>

function toolsFor(userId: string, env: Partial<Env> = { MOCK_EXTERNAL_APIS: 'true' }) {
  const set = buildTools(async () => ({}), { env: env as Env, userId, request: new Request('https://x') } as AgentToolContext<Env>)
  return (name: string) => (input: Record<string, unknown>) =>
    (set[name].execute as unknown as (i: unknown, o: unknown) => Promise<unknown>)(input, { toolCallId: 't', messages: [] })
}

async function refusal(run: Promise<unknown>) {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(AgentToolError)
  return err as AgentToolError
}

beforeEach(async () => {
  fake = fakeTools('alex')
  state.asUser = fake.asUser
  await fake.tools.create('trips', { name: 'Lisbon', destination: 'Lisbon', startDate: START, endDate: addDays(START, 2), teamId: TRIP }, TRIP)
  await fake.tools.create('team_members', { teamId: TRIP, userId: 'alex', status: 'active' })
  await fake.tools.create('team_members', { teamId: TRIP, userId: 'blair', status: 'active' })
})

describe('co-planner tools', () => {
  it('exposes the custom tools and no built-in record writes', () => {
    const names = Object.keys(buildTools(async () => ({}), { env: {} as Env, userId: 'alex', request: new Request('https://x') }))
    for (const name of CUSTOM_TOOL_NAMES) expect(names).toContain(name)
    for (const write of ['records_create', 'records_update', 'records_delete']) expect(names).not.toContain(write)
    expect(ALLOWED_TOOL_NAMES.filter((n) => /create|update|delete/.test(n))).toEqual([])
  })

  it('adds a stop marked as AI for the calling member', async () => {
    const run = toolsFor('blair')
    const added = (await run('add_stop')({ tripId: TRIP, day: addDays(START, 1), title: 'Castle at sunset' })) as { stopId: string }
    const row = fake.table('stops').get(added.stopId)!
    expect(row.data).toMatchObject({ tripId: TRIP, title: 'Castle at sunset', source: 'ai', addedBy: 'blair', position: 1 })
  })

  it('refuses every write from a non-member and writes nothing', async () => {
    await toolsFor('alex')('add_stop')({ tripId: TRIP, day: START, title: 'Coffee' })
    const stopId = [...fake.table('stops').keys()][0]
    const run = toolsFor('casey')
    for (const [name, input] of [
      ['add_stop', { tripId: TRIP, day: START, title: 'Injected' }],
      ['move_stop', { tripId: TRIP, stopId, day: addDays(START, 1) }],
      ['remove_stop', { tripId: TRIP, stopId }],
      ['search_places', { tripId: TRIP, query: 'cafes' }],
      ['get_forecast', { tripId: TRIP }],
      ['get_trip', { tripId: TRIP }],
    ] as const) {
      const err = await refusal(run(name)(input))
      expect(err.status).toBe(403)
      expect(err.message).toBe('You are not a member of this trip')
    }
    expect([...fake.table('stops').values()].map((r) => r.data.title)).toEqual(['Coffee'])
    expect(fake.table('usage').size).toBe(0)
  })

  it('refuses days outside the trip and stops from another trip', async () => {
    const run = toolsFor('alex')
    expect((await refusal(run('add_stop')({ tripId: TRIP, day: addDays(START, 9), title: 'Late' }))).message).toBe('That day is outside the trip')
    const other = await fake.tools.create('stops', { tripId: 'trip_other', day: START, title: 'Elsewhere', position: 1 })
    const err = await refusal(run('remove_stop')({ tripId: TRIP, stopId: other.success ? other.data.recordId : '' }))
    expect(err.status).toBe(404)
    expect(fake.table('stops').size).toBe(1)
  })

  it('moves a stop to another day and reorders within a day', async () => {
    const run = toolsFor('alex')
    const add = (title: string, day: string) => run('add_stop')({ tripId: TRIP, day, title }) as Promise<{ stopId: string }>
    const a = await add('A', START)
    const b = await add('B', START)
    const c = await add('C', addDays(START, 1))
    await run('move_stop')({ tripId: TRIP, stopId: b.stopId, day: START, position: 1 })
    const pos = (id: string) => fake.table('stops').get(id)!.data
    expect([pos(b.stopId).position, pos(a.stopId).position]).toEqual([1, 2])
    await run('move_stop')({ tripId: TRIP, stopId: a.stopId, day: addDays(START, 1) })
    expect(pos(a.stopId)).toMatchObject({ day: addDays(START, 1), position: 2 })
    expect(pos(c.stopId).position).toBe(1)
  })

  it('caches place searches per trip and query, reserving only uncached calls', async () => {
    const run = toolsFor('alex')
    const first = (await run('search_places')({ tripId: TRIP, query: 'Pastel de nata' })) as { cached: boolean; places: unknown[] }
    const again = (await run('search_places')({ tripId: TRIP, query: '  pastel DE nata ' })) as { cached: boolean }
    expect(first.cached).toBe(false)
    expect(first.places.length).toBeGreaterThan(0)
    expect(again.cached).toBe(true)
    expect([...fake.table('usage').values()].filter((r) => r.data.kind === 'places')).toHaveLength(1)
  })

  it('reports place search caps and out-of-credits as refusals', async () => {
    const run = toolsFor('alex', {})
    for (let i = 0; i < 8; i++) {
      await fake.tools.create('usage', { userId: 'alex', day: todayIso(), kind: 'places', count: 1, credits: 3.25 })
    }
    const capped = await refusal(run('search_places')({ tripId: TRIP, query: 'museums' }))
    expect([capped.code, capped.status]).toEqual(['places_user_cap', 429])
    expect(fake.integrationCalls).toHaveLength(0)

    fake = fakeTools('blair', () => ({ success: false, code: 'insufficient_credits', error: 'Insufficient credits' }))
    state.asUser = fake.asUser
    await fake.tools.create('trips', { name: 'Lisbon', destination: 'Lisbon', startDate: START, endDate: START, teamId: TRIP }, TRIP)
    await fake.tools.create('team_members', { teamId: TRIP, userId: 'blair', status: 'active' })
    const broke = await refusal(toolsFor('blair', {})('search_places')({ tripId: TRIP, query: 'bars' }))
    expect([broke.code, broke.status]).toEqual(['insufficient_credits', 402])
    expect(fake.integrationCalls[0].endpoint).toBe('serpapi/places-search')
  })

  it('reads the cached forecast for each trip day', async () => {
    const run = toolsFor('alex')
    const result = (await run('get_forecast')({ tripId: TRIP })) as { status: string; days: { day: string }[] }
    expect(result.status).toBe('no_location')
    expect(result.days.map((d) => d.day)).toEqual([START, addDays(START, 1), addDays(START, 2)])
  })
})
