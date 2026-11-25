import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentToolError } from 'deepspace/worker'
import type { ActionTools, AgentToolContext } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { addDays, todayIso } from '../lib/trip-dates'
import { fakeTools } from '../server/fake-tools'
import { DAILY_CAPS } from '../server/trip-services'

const state = vi.hoisted(() => ({ asUser: null as unknown as (userId: string) => ActionTools }))
vi.mock('../server/action-routes.js', () => ({ createActionTools: (_env: unknown, userId: string) => state.asUser(userId) }))

const { ALLOWED_TOOL_NAMES, CUSTOM_TOOL_NAMES, buildTools } = await import('./tools')

const START = addDays(todayIso(), 2)
const TRIP = 'trip_1'

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

  it('puts a timed stop in time order and an untimed one last', async () => {
    const run = toolsFor('alex')
    const add = async (title: string, time?: string) =>
      ((await run('add_stop')({ tripId: TRIP, day: START, title, ...(time ? { time } : {}) })) as { stopId: string }).stopId
    const lunch = await add('Lunch', '13:00')
    const free = await add('Wander')
    const breakfast = await add('Breakfast', '09:00')
    const pos = (id: string) => fake.table('stops').get(id)!.data.position
    expect([pos(breakfast), pos(lunch), pos(free)]).toEqual([1, 2, 3])
  })

  it('renumbers a day with gaps in its positions', async () => {
    const day = addDays(START, 2)
    const a = await fake.tools.create('stops', { tripId: TRIP, day, title: 'Tram', time: '09:30', position: 3 })
    const b = await fake.tools.create('stops', { tripId: TRIP, day, title: 'Lunch', time: '13:00', position: 4 })
    const added = (await toolsFor('alex')('add_stop')({ tripId: TRIP, day, title: 'Bakery' })) as { stopId: string }
    const pos = (id: string) => fake.table('stops').get(id)!.data.position
    if (!a.success || !b.success) throw new Error('seed failed')
    expect([pos(a.data.recordId), pos(b.data.recordId), pos(added.stopId)]).toEqual([1, 2, 3])
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
    const first = (await run('search_places')({ tripId: TRIP, query: 'Pastel de nata' })) as { cached: boolean; source: string; places: unknown[] }
    const again = (await toolsFor('alex')('search_places')({ tripId: TRIP, query: '  pastel DE nata ' })) as { cached: boolean }
    expect(first).toMatchObject({ cached: false, source: 'serpapi' })
    expect(first.places.length).toBeGreaterThan(0)
    expect(again.cached).toBe(true)
    expect([...fake.table('usage').values()].filter((r) => r.data.kind === 'places')).toHaveLength(1)
  })

  it('allows one new place search per request; cached repeats still answer', async () => {
    const run = toolsFor('alex')
    await run('search_places')({ tripId: TRIP, query: 'bakery' })
    const second = await refusal(run('search_places')({ tripId: TRIP, query: 'museum' }))
    expect([second.code, second.status]).toEqual(['places_turn_limit', 429])
    expect(await run('search_places')({ tripId: TRIP, query: 'Bakery' })).toMatchObject({ cached: true })
    // Parallel tool calls in one step share the same budget.
    const next = toolsFor('alex')
    const results = await Promise.allSettled([next('search_places')({ tripId: TRIP, query: 'bars' }), next('search_places')({ tripId: TRIP, query: 'parks' })])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect([...fake.table('usage').values()].filter((r) => r.data.kind === 'places')).toHaveLength(2)
  })

  it('refuses place searches past the daily cap before any call', async () => {
    const run = toolsFor('alex', {})
    for (let i = 0; i < DAILY_CAPS.places; i++) {
      await fake.tools.create('usage', { userId: 'alex', day: todayIso(), kind: 'places', count: 1, credits: 3.25 })
    }
    const capped = await refusal(run('search_places')({ tripId: TRIP, query: 'museums' }))
    expect([capped.code, capped.status]).toEqual(['places_user_cap', 429])
    expect(fake.integrationCalls).toHaveLength(0)
  })

  it('reads the cached forecast for each trip day', async () => {
    const run = toolsFor('alex')
    const result = (await run('get_forecast')({ tripId: TRIP })) as { status: string; days: { day: string }[] }
    expect(result.status).toBe('no_location')
    expect(result.days.map((d) => d.day)).toEqual([START, addDays(START, 1), addDays(START, 2)])
  })
})

describe('place search fallback to OpenStreetMap', () => {
  const nominatim = [
    { name: 'Pastelaria Batalha', display_name: 'Pastelaria Batalha, Rua da Prata, Baixa, Lisbon, Portugal', type: 'bakery', lat: '38.7105', lon: '-9.1369' },
  ]
  let fetchCalls: { url: string; headers: Headers }[]

  function stubFetch(response: () => Response) {
    fetchCalls = []
    vi.stubGlobal('fetch', async (url: URL | string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), headers: new Headers(init?.headers) })
      return response()
    })
  }

  async function located(serp: (endpoint: string) => unknown) {
    fake = fakeTools('alex', serp)
    state.asUser = fake.asUser
    await fake.tools.create('trips', { name: 'Lisbon', destination: 'Lisbon', startDate: START, endDate: START, teamId: TRIP, lat: 38.7078, lon: -9.1366 }, TRIP)
    await fake.tools.create('team_members', { teamId: TRIP, userId: 'alex', status: 'active' })
  }

  afterEach(() => vi.unstubAllGlobals())

  it('answers from Nominatim when SerpApi is out of searches, costs nothing, and says so', async () => {
    await located(() => ({ success: false, error: 'SerpAPI error 429: Your account has run out of searches' }))
    stubFetch(() => Response.json(nominatim))
    const result = await toolsFor('alex', {})('search_places')({ tripId: TRIP, query: 'bakery' })
    expect(result).toMatchObject({
      source: 'openstreetmap',
      attribution: 'Place data © OpenStreetMap contributors (ODbL)',
      places: [{ name: 'Pastelaria Batalha', address: 'Rua da Prata, Baixa, Lisbon, Portugal', type: 'bakery', lat: 38.7105, lon: -9.1369 }],
    })
    expect(fake.integrationCalls.map((c) => c.endpoint)).toEqual(['serpapi/places-search'])

    const [call] = fetchCalls
    const url = new URL(call.url)
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect(url.searchParams.get('bounded')).toBe('1')
    expect(url.searchParams.get('viewbox')).toBe('-9.2866,38.8578,-8.9866,38.5578')
    expect(call.headers.get('User-Agent')).toBe('tripboard-app/1.0 (+https://tripboard-app.app.space)')
    expect([...url.searchParams.keys()].sort()).toEqual(['accept-language', 'bounded', 'format', 'limit', 'q', 'viewbox'])

    const usage = [...fake.table('usage').values()].filter((r) => r.data.kind === 'places')
    expect(usage.map((r) => r.data.credits)).toEqual([0])
    expect(fake.table('osm_slots').size).toBe(1)
    const again = await toolsFor('alex', {})('search_places')({ tripId: TRIP, query: 'Bakery' })
    expect(again).toMatchObject({ cached: true, source: 'openstreetmap' })
    expect(fetchCalls).toHaveLength(1)
  })

  it('falls back when the owner is out of credits too, and refuses when both sources fail', async () => {
    await located(() => ({ success: false, code: 'insufficient_credits', error: 'Insufficient credits' }))
    stubFetch(() => new Response('busy', { status: 429 }))
    const err = await refusal(toolsFor('alex', {})('search_places')({ tripId: TRIP, query: 'bars' }))
    expect([err.code, err.status]).toEqual(['places_unavailable', 503])
    expect(fetchCalls).toHaveLength(1)
    expect([...fake.table('usage').values()].map((r) => r.data.credits)).toEqual([0])
    expect(fake.table('place_searches').size).toBe(0)
  })

  it('keeps SerpApi results and their price when SerpApi answers', async () => {
    await located(() => ({ success: true, data: { local_results: [{ title: 'Manteigaria', rating: 4.7 }] } }))
    stubFetch(() => Response.json([]))
    const result = await toolsFor('alex', {})('search_places')({ tripId: TRIP, query: 'pastel de nata' })
    expect(result).toMatchObject({ source: 'serpapi', places: [{ name: 'Manteigaria', rating: 4.7 }] })
    expect(result).not.toHaveProperty('attribution')
    expect(fetchCalls).toHaveLength(0)
    expect([...fake.table('usage').values()].map((r) => r.data.credits)).toEqual([3.25])
  })
})
