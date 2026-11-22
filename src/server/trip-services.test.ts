import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import {
  DAILY_CAPS,
  PAID_COSTS,
  chatTurnCredits,
  fillUsageForTests,
  forecastFromOpenMeteo,
  placeFromGeocoding,
  reservePaidCall,
  settlePaidCall,
  takeFreeQuota,
} from './trip-services'

const env = {} as Env

/** Each request yields before touching storage, so parallel callers interleave like separate room requests. */
function fakeUsageRoom({ jitter = true } = {}) {
  const rows = new Map<string, Record<string, unknown>>()
  let nextId = 0
  const hop = () => (jitter ? new Promise((resolve) => setTimeout(resolve, Math.random() * 3)) : Promise.resolve())
  const tools = {
    async create(_collection: string, data: Record<string, unknown>) {
      await hop()
      const recordId = `row_${nextId++}`
      rows.set(recordId, { ...data })
      return { success: true, data: { recordId } }
    },
    async update(_collection: string, recordId: string, data: Record<string, unknown>) {
      await hop()
      const row = rows.get(recordId)
      if (!row) return { success: false, error: 'Record not found' }
      rows.set(recordId, { ...row, ...data })
      return { success: true, data: { recordId } }
    },
    async remove(_collection: string, recordId: string) {
      await hop()
      rows.delete(recordId)
      return { success: true, data: { recordId } }
    },
    async query(_collection: string, options: { where?: Record<string, unknown>; limit?: number }) {
      await hop()
      const matches = [...rows.entries()]
        .filter(([, data]) => Object.entries(options.where ?? {}).every(([k, v]) => data[k] === v))
        .slice(0, options.limit)
        .map(([recordId, data]) => ({ recordId, data }))
      return { success: true, data: { records: matches, count: matches.length } }
    },
  } as unknown as ActionTools
  return { tools, rows }
}

const burst = <T>(n: number, call: (i: number) => Promise<T>) => Promise.all(Array.from({ length: n }, (_, i) => call(i)))

describe('spend caps', () => {
  it('never grants more than the per-user cap under a parallel burst', async () => {
    for (let trial = 0; trial < 5; trial++) {
      const { tools, rows } = fakeUsageRoom()
      const granted = (await burst(50, () => reservePaidCall(env, tools, 'u1', 'geocode'))).filter((r) => r.ok).length
      expect(granted).toBeLessThanOrEqual(DAILY_CAPS.geocode)
      expect(rows.size).toBe(granted)
    }
  })

  it('never grants past the app-wide credit ceiling across many users', async () => {
    const { tools, rows } = fakeUsageRoom()
    const granted = (await burst(400, (i) => reservePaidCall(env, tools, `u${i}`, 'geocode'))).filter((r) => r.ok).length
    expect(granted * 0.2).toBeLessThanOrEqual(DAILY_CAPS.appCredits)
    expect(rows.size).toBe(granted)
  })

  it('never grants more trips than the daily quota under a parallel burst', async () => {
    const { tools, rows } = fakeUsageRoom()
    const granted = (await burst(50, () => takeFreeQuota(env, tools, 'u1', 'trip'))).filter(Boolean).length
    expect(granted).toBeLessThanOrEqual(DAILY_CAPS.trip)
    expect(rows.size).toBe(granted)
  })

  it('grants exactly up to each cap when calls arrive one at a time', async () => {
    const { tools } = fakeUsageRoom({ jitter: false })
    const results = []
    for (let i = 0; i < DAILY_CAPS.geocode + 2; i++) results.push(await reservePaidCall(env, tools, 'u1', 'geocode'))
    expect(results.filter((r) => r.ok)).toHaveLength(DAILY_CAPS.geocode)
    expect(results.at(-1)).toEqual({ ok: false, reason: 'user_cap' })

    const ceiling = DAILY_CAPS.appCredits / 0.2
    let ok = 0
    for (let i = 0; i < ceiling + 1; i++) if ((await reservePaidCall(env, tools, `other${i}`, 'geocode')).ok) ok++
    expect(ok).toBe(ceiling - DAILY_CAPS.geocode)
    expect(await reservePaidCall(env, tools, 'fresh', 'geocode')).toEqual({ ok: false, reason: 'app_cap' })
  })

  it('frees refused rows, so a burst does not lock the user out', async () => {
    const { tools, rows } = fakeUsageRoom()
    const first = (await burst(50, () => takeFreeQuota(env, tools, 'u1', 'trip'))).filter(Boolean).length
    let granted = first
    while (await takeFreeQuota(env, tools, 'u1', 'trip')) granted++
    expect(granted).toBe(DAILY_CAPS.trip)
    expect(rows.size).toBe(DAILY_CAPS.trip)
  })

  it('caps AI chat turns and place searches per user, under bursts too', async () => {
    for (const kind of ['chat', 'places'] as const) {
      const { tools, rows } = fakeUsageRoom()
      const granted = (await burst(40, () => reservePaidCall(env, tools, 'u1', kind))).filter((r) => r.ok).length
      expect(granted).toBeLessThanOrEqual(DAILY_CAPS[kind])
      expect(rows.size).toBe(granted)

      const sequential = fakeUsageRoom({ jitter: false })
      const results = []
      for (let i = 0; i < DAILY_CAPS[kind] + 1; i++) results.push(await reservePaidCall(env, sequential.tools, 'u1', kind))
      expect(results.filter((r) => r.ok)).toHaveLength(DAILY_CAPS[kind])
      expect(results.at(-1)).toEqual({ ok: false, reason: 'user_cap' })
    }
  })

  it('counts every paid kind against one app-wide ceiling, and place searches against their own', async () => {
    const { tools } = fakeUsageRoom({ jitter: false })
    let places = 0
    let i = 0
    while ((await reservePaidCall(env, tools, `p${i++}`, 'places')).ok) places += PAID_COSTS.places
    expect(places).toBeLessThanOrEqual(DAILY_CAPS.placesCredits)
    expect(places).toBeGreaterThan(DAILY_CAPS.placesCredits - PAID_COSTS.places)
    let credits = places
    while ((await reservePaidCall(env, tools, `c${i++}`, 'chat')).ok) credits += PAID_COSTS.chat
    while ((await reservePaidCall(env, tools, `g${i++}`, 'geocode')).ok) credits += PAID_COSTS.geocode
    expect(Math.round(credits * 100)).toBeLessThanOrEqual(DAILY_CAPS.appCredits * 100)
    expect(credits).toBeGreaterThan(DAILY_CAPS.appCredits - PAID_COSTS.geocode)
    expect(await reservePaidCall(env, tools, 'late', 'chat')).toEqual({ ok: false, reason: 'app_cap' })

    const burstRoom = fakeUsageRoom()
    const mixed = await burst(200, (i) => reservePaidCall(env, burstRoom.tools, `m${i}`, i % 2 ? 'chat' : 'places'))
    const spent = [...burstRoom.rows.values()].reduce((sum, r) => sum + Number(r.credits), 0)
    expect(spent).toBeLessThanOrEqual(DAILY_CAPS.appCredits)
    expect(mixed.filter((r) => r.ok)).toHaveLength(burstRoom.rows.size)
  })
})

describe('settling a reservation to its real cost', () => {
  it('frees the ceiling when a chat turn costs less than its estimate', async () => {
    const { tools, rows } = fakeUsageRoom({ jitter: false })
    const turns = []
    for (let i = 0; i < 100; i++) {
      const r = await reservePaidCall(env, tools, `u${i}`, 'chat')
      if (!r.ok) break
      turns.push(r)
      await settlePaidCall(tools, r.usageId, chatTurnCredits({ inputTokens: 6000, outputTokens: 300 }))
    }
    // 0.1875 credits a turn instead of the 1.5 reserved: about 8x more turns fit under the same ceiling.
    expect(turns.length).toBe(100)
    const spent = [...rows.values()].reduce((sum, r) => sum + Number(r.credits), 0)
    expect(spent).toBeCloseTo(100 * 0.1875, 4)
  })

  it('counts a turn that costs more than its estimate at the real cost', async () => {
    const { tools } = fakeUsageRoom({ jitter: false })
    const first = await reservePaidCall(env, tools, 'u1', 'chat')
    if (!first.ok) throw new Error('expected a grant')
    await settlePaidCall(tools, first.usageId, DAILY_CAPS.appCredits)
    expect(await reservePaidCall(env, tools, 'u2', 'geocode')).toEqual({ ok: false, reason: 'app_cap' })
  })

  it('prices tokens conservatively and rounds', () => {
    expect(chatTurnCredits({ inputTokens: 1000, outputTokens: 1000 })).toBe(0.15)
    expect(chatTurnCredits({})).toBe(0)
    // Worst case of a bounded turn: about 40k input and 5k output tokens.
    expect(chatTurnCredits({ inputTokens: 40_000, outputTokens: 5_120 })).toBeLessThanOrEqual(PAID_COSTS.chat + 0.2)
  })

  it('fills usage for tests only in mocked runs', async () => {
    const { tools, rows } = fakeUsageRoom({ jitter: false })
    expect(await fillUsageForTests(env, tools, 'u1', 'chat')).toBe(false)
    expect(rows.size).toBe(0)
    const mocked = { MOCK_EXTERNAL_APIS: 'true', MOCK_RUN_ID: 'r1' } as Env
    expect(await fillUsageForTests(mocked, tools, 'u1', 'places')).toBe(true)
    expect(rows.size).toBe(DAILY_CAPS.places * 10)
    expect(await reservePaidCall(mocked, tools, 'u1', 'places')).toEqual({ ok: false, reason: 'user_cap' })
    expect(await reservePaidCall(env, tools, 'u1', 'places')).toMatchObject({ ok: true })
  })
})

describe('integration parsers', () => {
  it('reads the first geocoding match', () => {
    const place = placeFromGeocoding([{ name: 'Lisbon', lat: 38.7, lon: -9.1, country: 'PT', local_names: {} }])
    expect(place).toEqual({ lat: 38.7, lon: -9.1, label: 'Lisbon, PT' })
    expect(placeFromGeocoding([])).toBeNull()
    expect(placeFromGeocoding({ error: 'x' })).toBeNull()
  })

  it('maps Open-Meteo daily arrays by date', () => {
    const forecast = forecastFromOpenMeteo({
      daily: {
        time: ['2026-11-22', '2026-11-23'],
        weather_code: [3, 61],
        temperature_2m_max: [18.6, 15.2],
        temperature_2m_min: [11.4, 9.9],
        precipitation_probability_max: [10, null],
      },
    })
    expect(forecast?.days['2026-11-22']).toEqual({ code: 3, max: 19, min: 11, precip: 10 })
    expect(forecast?.days['2026-11-23']).toEqual({ code: 61, max: 15, min: 10, precip: null })
    expect(forecastFromOpenMeteo({})).toBeNull()
  })
})
