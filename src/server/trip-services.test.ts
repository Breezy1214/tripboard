import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { DAILY_CAPS, forecastFromOpenMeteo, placeFromGeocoding, reservePaidCall, takeFreeQuota } from './trip-services'

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
