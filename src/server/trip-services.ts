/**
 * Worker-side trip helpers shared by server actions and realtime routes:
 * membership checks, spend caps, geocoding (paid, owner-billed) and the
 * Open-Meteo forecast (free, no key).
 *
 * `tools` here are the RBAC-off action tools, so every caller-supplied id is
 * checked against team_members before it is used.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Trip, TripForecast, DayWeather } from '../types.js'
import { todayIso } from '../lib/trip-dates.js'
import type { Env } from '../../worker.js'

/**
 * Credits reserved per call. Geocoding and SerpApi are flat prices. A chat turn
 * reserves its bounded worst case and is settled to its measured token cost when
 * it ends (settlePaidCall), so the ceiling counts real spend, not the estimate.
 */
export const PAID_COSTS = {
  geocode: 0.2,
  chat: 1.5,
  places: 3.25,
} as const

export type PaidKind = keyof typeof PAID_COSTS

export const DAILY_CAPS = {
  /** Per-user geocoding calls per UTC day. */
  geocode: 10,
  /** Per-user AI chat turns per UTC day. */
  chat: 15,
  /** Per-user uncached place searches per UTC day (SerpApi or the free OpenStreetMap fallback). */
  places: 3,
  /** Per-user trips created per UTC day (free, but keeps the room tidy). */
  trip: 20,
  /** Per-user free OpenStreetMap lookups that put hand-added stops on the map. */
  locate: 60,
  /** App-wide credits per UTC day for place searches, inside appCredits. */
  placesCredits: 20,
  /** App-wide owner-billed credits per UTC day, across every paid kind. */
  appCredits: 40,
} as const

/**
 * claude-haiku-5-5 token prices in credits per 1k tokens (1 credit = $0.01).
 * Set above what was billed on 11-22 (4 model steps of about 5k input tokens
 * each cost $0.00226 in all), so a settled turn errs high.
 */
export const CHAT_CREDITS_PER_1K = { input: 0.025, output: 0.125 } as const

export function chatTurnCredits(usage: { inputTokens?: number; outputTokens?: number }): number {
  const credits =
    ((usage.inputTokens ?? 0) * CHAT_CREDITS_PER_1K.input + (usage.outputTokens ?? 0) * CHAT_CREDITS_PER_1K.output) / 1000
  return Math.round(credits * 10_000) / 10_000
}

export function mocksExternalApis(env: Env): boolean {
  return env.MOCK_EXTERNAL_APIS === 'true'
}

/** Mocked runs spend nothing and share one local room per run, so caps stretch. */
export function capFor(env: Env, cap: number): number {
  return mocksExternalApis(env) ? cap * 10 : cap
}

/** Mocked runs count under a key per test run, so tests never use up a local dev server's real caps or an earlier run's. */
function usageDay(env: Env): string {
  return mocksExternalApis(env) ? `test-${env.MOCK_RUN_ID ?? ''}-${todayIso()}` : todayIso()
}

export async function isTripMember(tools: ActionTools, tripId: string, userId: string): Promise<boolean> {
  if (!tripId) return false
  const res = await tools.query('team_members', { where: { teamId: tripId, userId }, limit: 1 })
  return res.success && res.data.records.some((r) => r.data.status !== 'removed')
}

export async function getTrip(tools: ActionTools, tripId: string) {
  const res = await tools.get<Record<string, unknown>>('trips', tripId)
  if (!res.success) return null
  return res.data.record as unknown as { recordId: string; createdBy: string; data: Trip }
}

type UsageRow = {
  userId: string
  day: string
  kind: string
  count: number
  credits: number
}

async function usageRows(tools: ActionTools, where: Partial<UsageRow>, limit: number) {
  const res = await tools.query<UsageRow>('usage', { where, limit })
  return res.success ? res.data.records : null
}

/**
 * Each call inserts its own usage row first and only then counts. Separate
 * requests to the room can interleave, but the last row in always sees every
 * earlier one, so a burst can over-refuse and never over-grant. A refused call
 * removes its row; if that fails it stays counted, which is the safe side.
 */
async function claimUsage<R extends string>(
  tools: ActionTools,
  row: UsageRow,
  check: () => Promise<R | null>,
): Promise<{ refusal: R | 'error' | null; usageId?: string }> {
  const created = await tools.create('usage', row)
  if (!created.success) return { refusal: 'error' }
  const refusal = await check()
  if (refusal) await tools.remove('usage', created.data.recordId)
  return { refusal, usageId: created.data.recordId }
}

async function overUserCap(tools: ActionTools, userId: string, day: string, kind: string, cap: number) {
  const rows = await usageRows(tools, { userId, day, kind }, cap + 1)
  return !rows || rows.length > cap
}

/** Settled rows can hold any amount, so a ceiling reads every row of the day. A day with this many rows refuses (fail closed). */
const CEILING_ROW_LIMIT = 2000

async function overCeiling(tools: ActionTools, day: string, cap: number, kinds: readonly PaidKind[]) {
  const perKind = await Promise.all(kinds.map((kind) => usageRows(tools, { day, kind }, CEILING_ROW_LIMIT)))
  if (perKind.some((rows) => !rows || rows.length >= CEILING_ROW_LIMIT)) return true
  const credits = perKind.flatMap((rows) => rows ?? []).reduce((sum, r) => sum + Number(r.data.credits ?? 0), 0)
  return Math.round(credits * 100) > Math.round(cap * 100)
}

/** Counts one free, capped action (like creating a trip). False when the cap is reached. */
export async function takeFreeQuota(env: Env, tools: ActionTools, userId: string, kind: 'trip' | 'locate'): Promise<boolean> {
  const day = usageDay(env)
  const cap = capFor(env, DAILY_CAPS[kind])
  const { refusal } = await claimUsage(tools, { userId, day, kind, count: 1, credits: 0 }, async () =>
    (await overUserCap(tools, userId, day, kind, cap)) ? 'cap' : null,
  )
  return refusal === null
}

export type Reservation = { ok: true; usageId: string } | { ok: false; reason: 'user_cap' | 'app_cap' }

const ALL_KINDS = Object.keys(PAID_COSTS) as PaidKind[]

/**
 * Reserve one owner-billed call against the caller's daily cap, the app-wide
 * place-search ceiling (places only) and the app-wide credit ceiling. Usage is
 * written before the call, so a failed call still counts (it may have been
 * billed) until settlePaidCall corrects it.
 */
export async function reservePaidCall(env: Env, tools: ActionTools, userId: string, kind: PaidKind): Promise<Reservation> {
  const day = usageDay(env)
  const { refusal, usageId } = await claimUsage(
    tools,
    { userId, day, kind, count: 1, credits: PAID_COSTS[kind] },
    async () => {
      const [userOver, placesOver, appOver] = await Promise.all([
        overUserCap(tools, userId, day, kind, capFor(env, DAILY_CAPS[kind])),
        kind === 'places' && overCeiling(tools, day, capFor(env, DAILY_CAPS.placesCredits), ['places']),
        overCeiling(tools, day, capFor(env, DAILY_CAPS.appCredits), ALL_KINDS),
      ])
      return userOver ? 'user_cap' : placesOver || appOver ? 'app_cap' : null
    },
  )
  if (refusal === null && usageId) return { ok: true, usageId }
  return { ok: false, reason: refusal === 'user_cap' ? 'user_cap' : 'app_cap' }
}

/** Replace a reservation's estimate with what the call really cost (0 for a free fallback or a failed upstream call). */
export async function settlePaidCall(tools: ActionTools, usageId: string, credits: number): Promise<void> {
  const res = await tools.update('usage', usageId, { credits })
  if (!res.success) console.warn(`[usage] settle failed, the reserved estimate stays counted: ${res.error}`)
}

/** Mocked runs only: fill the caller's cap for one kind with zero-credit rows, so a test reaches the real refusal path. */
export async function fillUsageForTests(env: Env, tools: ActionTools, userId: string, kind: PaidKind): Promise<boolean> {
  if (!mocksExternalApis(env)) return false
  const day = usageDay(env)
  const cap = capFor(env, DAILY_CAPS[kind])
  const have = (await usageRows(tools, { userId, day, kind }, cap + 1)) ?? []
  for (let i = have.length; i < cap; i++) {
    const created = await tools.create('usage', { userId, day, kind, count: 1, credits: 0 })
    if (!created.success) return false
  }
  return true
}

export interface GeocodeResult {
  lat: number
  lon: number
  label: string
}

interface OwmPlace {
  name?: string
  state?: string
  country?: string
  lat?: number
  lon?: number
}

export function placeFromGeocoding(data: unknown): GeocodeResult | null {
  const first = Array.isArray(data) ? (data[0] as OwmPlace | undefined) : undefined
  if (!first || typeof first.lat !== 'number' || typeof first.lon !== 'number') return null
  const label = [first.name, first.state, first.country].filter(Boolean).join(', ')
  return { lat: first.lat, lon: first.lon, label: label || 'Unknown place' }
}

/** Test runs set MOCK_EXTERNAL_APIS so no owner-billed call leaves the worker. */
function mockGeocode(query: string): GeocodeResult | null {
  if (/nowhere/i.test(query)) return null
  return { lat: 38.7078, lon: -9.1366, label: `${query.trim()} (test)` }
}

export async function geocode(env: Env, tools: ActionTools, query: string): Promise<GeocodeResult | null> {
  if (mocksExternalApis(env)) return mockGeocode(query)
  const res = await tools.integration<unknown>('openweathermap/geocoding', { q: query, limit: 1 })
  if (!res.success) {
    console.warn(`[geocode] failed: ${res.error}`)
    return null
  }
  return placeFromGeocoding(res.data)
}

interface OpenMeteoDaily {
  time?: string[]
  weather_code?: number[]
  temperature_2m_max?: number[]
  temperature_2m_min?: number[]
  precipitation_probability_max?: (number | null)[]
}

export function forecastFromOpenMeteo(body: unknown): TripForecast | null {
  const daily = (body as { daily?: OpenMeteoDaily } | null)?.daily
  if (!daily?.time?.length) return null
  const days: Record<string, DayWeather> = {}
  daily.time.forEach((date, i) => {
    const code = daily.weather_code?.[i]
    const max = daily.temperature_2m_max?.[i]
    const min = daily.temperature_2m_min?.[i]
    if (typeof code !== 'number' || typeof max !== 'number' || typeof min !== 'number') return
    days[date] = { code, max: Math.round(max), min: Math.round(min), precip: daily.precipitation_probability_max?.[i] ?? null }
  })
  return { days }
}

function mockForecast(today: string): TripForecast {
  const days: Record<string, DayWeather> = {}
  for (let i = 0; i < 16; i++) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
    days[date] = { code: i % 2 === 0 ? 1 : 61, max: 22, min: 14, precip: i % 2 === 0 ? 5 : 70 }
  }
  return { days }
}

export async function fetchForecast(env: Env, lat: number, lon: number): Promise<TripForecast | null> {
  if (mocksExternalApis(env)) return mockForecast(todayIso())
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', lat.toFixed(3))
  url.searchParams.set('longitude', lon.toFixed(3))
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '16')
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'tripboard-app' } })
    if (!res.ok) {
      console.warn(`[forecast] open-meteo ${res.status}`)
      return null
    }
    return forecastFromOpenMeteo(await res.json())
  } catch (err) {
    console.warn(`[forecast] open-meteo request failed: ${String(err)}`)
    return null
  }
}
