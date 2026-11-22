/**
 * Membership-checked board writes shared by the server actions and the AI
 * tools, so the co-planner can never do more than the user it acts for.
 *
 * `tools` are the RBAC-off action tools: every caller-supplied trip id is
 * checked against team_members first, and every stop id is checked to belong
 * to that trip, before anything is read back or written.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import type { Stop, TripForecast } from '../types.js'
import { isIsoDate, todayIso, tripDays, tripOverlapsForecast } from '../lib/trip-dates.js'
import { fetchForecast, getTrip, isTripMember } from './trip-services.js'

export const MAX_STOPS_PER_TRIP = 300
const FORECAST_TTL_MS = 60 * 60 * 1000

export type ServiceCode = 'invalid' | 'not_member' | 'not_found' | 'limit' | 'failed'
export type ServiceResult<T> = { success: true; data: T } | { success: false; error: string; code: ServiceCode }

const NOT_MEMBER = 'You are not a member of this trip'

function fail(code: ServiceCode, error: string) {
  return { success: false as const, code, error }
}

export function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

type StopRow = { recordId: string; data: Stop }

async function stopsOnDay(tools: ActionTools, tripId: string, day: string): Promise<StopRow[]> {
  const res = await tools.query<Record<string, unknown>>('stops', { where: { tripId, day }, orderBy: 'position', orderDir: 'asc', limit: MAX_STOPS_PER_TRIP })
  return res.success ? (res.data.records as unknown as StopRow[]) : []
}

export async function memberTrip(tools: ActionTools, tripId: string, userId: string) {
  if (!(await isTripMember(tools, tripId, userId))) return fail('not_member', NOT_MEMBER)
  const trip = await getTrip(tools, tripId)
  if (!trip) return fail('not_found', 'Trip not found')
  return { success: true as const, data: trip }
}

async function memberStop(tools: ActionTools, tripId: string, stopId: string, userId: string) {
  const trip = await memberTrip(tools, tripId, userId)
  if (!trip.success) return trip
  const res = await tools.get<Record<string, unknown>>('stops', stopId)
  const stop = res.success ? (res.data.record as unknown as StopRow | null) : null
  if (!stop || stop.data.tripId !== tripId) return fail('not_found', 'Stop not found on this trip')
  return { success: true as const, data: { trip: trip.data, stop } }
}

export interface StopInput {
  tripId: unknown
  day: unknown
  title: unknown
  notes?: unknown
  time?: unknown
  placeName?: unknown
  address?: unknown
  lat?: unknown
  lon?: unknown
  rating?: unknown
  source: 'user' | 'ai'
}

export async function addStopFor(tools: ActionTools, userId: string, input: StopInput): Promise<ServiceResult<{ stopId: string; day: string }>> {
  const tripId = text(input.tripId, 100)
  const title = text(input.title, 120)
  const { day } = input
  if (!title) return fail('invalid', 'Add a title')
  if (!isIsoDate(day)) return fail('invalid', 'Pick a day (YYYY-MM-DD)')
  const trip = await memberTrip(tools, tripId, userId)
  if (!trip.success) return trip
  if (!tripDays(trip.data.data.startDate, trip.data.data.endDate).includes(day)) return fail('invalid', 'That day is outside the trip')

  const existing = await tools.query('stops', { where: { tripId }, limit: MAX_STOPS_PER_TRIP })
  if (existing.success && existing.data.records.length >= MAX_STOPS_PER_TRIP) return fail('limit', 'This trip has too many stops')

  const onDay = await stopsOnDay(tools, tripId, day)
  const time = text(input.time, 5)
  const created = await tools.create('stops', {
    tripId,
    day,
    position: Math.max(0, ...onDay.map((s) => Number(s.data.position ?? 0))) + 1,
    title,
    notes: text(input.notes, 1000),
    time: /^\d{2}:\d{2}$/.test(time) ? time : '',
    source: input.source,
    ...(text(input.placeName, 160) ? { placeName: text(input.placeName, 160) } : {}),
    ...(text(input.address, 240) ? { address: text(input.address, 240) } : {}),
    ...(finite(input.lat) !== undefined && finite(input.lon) !== undefined ? { lat: finite(input.lat), lon: finite(input.lon) } : {}),
    ...(finite(input.rating) !== undefined ? { rating: finite(input.rating) } : {}),
  })
  if (!created.success) return fail('failed', created.error)
  return { success: true, data: { stopId: created.data.recordId, day } }
}

/** Moves a stop to `day` (any day of the trip) at 1-based `position`, or to the end of that day. */
export async function moveStopFor(
  tools: ActionTools,
  userId: string,
  input: { tripId: unknown; stopId: unknown; day: unknown; position?: unknown },
): Promise<ServiceResult<{ stopId: string; day: string; position: number }>> {
  const tripId = text(input.tripId, 100)
  const stopId = text(input.stopId, 100)
  const { day } = input
  if (!isIsoDate(day)) return fail('invalid', 'Pick a day (YYYY-MM-DD)')
  const found = await memberStop(tools, tripId, stopId, userId)
  if (!found.success) return found
  const { trip, stop } = found.data
  if (!tripDays(trip.data.startDate, trip.data.endDate).includes(day)) return fail('invalid', 'That day is outside the trip')

  const order = (await stopsOnDay(tools, tripId, day)).filter((s) => s.recordId !== stopId)
  const wanted = finite(input.position)
  const index = wanted === undefined ? order.length : Math.min(Math.max(Math.round(wanted) - 1, 0), order.length)
  order.splice(index, 0, stop)
  for (const [i, s] of order.entries()) {
    const patch: Partial<Stop> = s.recordId === stopId ? { day, position: i + 1 } : { position: i + 1 }
    if (s.recordId !== stopId && s.data.position === i + 1) continue
    const updated = await tools.update('stops', s.recordId, patch)
    if (!updated.success) return fail('failed', updated.error)
  }
  return { success: true, data: { stopId, day, position: index + 1 } }
}

export async function removeStopFor(
  tools: ActionTools,
  userId: string,
  input: { tripId: unknown; stopId: unknown },
): Promise<ServiceResult<{ stopId: string; title: string }>> {
  const found = await memberStop(tools, text(input.tripId, 100), text(input.stopId, 100), userId)
  if (!found.success) return found
  const removed = await tools.remove('stops', found.data.stop.recordId)
  if (!removed.success) return fail('failed', removed.error)
  return { success: true, data: { stopId: found.data.stop.recordId, title: found.data.stop.data.title } }
}

export type ForecastStatus = 'no_location' | 'outside_window' | 'cached' | 'updated'

/** Refreshes the trip's cached Open-Meteo forecast when it is older than an hour. Free, no key. */
export async function refreshTripForecast(
  env: Env,
  tools: ActionTools,
  userId: string,
  tripIdInput: unknown,
): Promise<ServiceResult<{ status: ForecastStatus; forecast?: TripForecast | null }>> {
  const trip = await memberTrip(tools, text(tripIdInput, 100), userId)
  if (!trip.success) return trip
  const tripId = trip.data.recordId
  const { lat, lon, startDate, endDate, forecastAt, forecast } = trip.data.data
  if (typeof lat !== 'number' || typeof lon !== 'number') return { success: true, data: { status: 'no_location' } }
  if (!tripOverlapsForecast(startDate, endDate, todayIso())) return { success: true, data: { status: 'outside_window' } }
  if (forecastAt && Date.now() - Date.parse(forecastAt) < FORECAST_TTL_MS) {
    return { success: true, data: { status: 'cached', forecast } }
  }
  const fresh = await fetchForecast(env, lat, lon)
  if (!fresh) return fail('failed', 'Weather is unavailable right now')
  const updated = await tools.update('trips', tripId, { forecast: fresh, forecastAt: new Date().toISOString() })
  if (!updated.success) return fail('failed', updated.error)
  return { success: true, data: { status: 'updated', forecast: fresh } }
}
