import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { addDays, isIsoDate, todayIso, tripDays, tripOverlapsForecast, validateTripDates } from '../lib/trip-dates'
import {
  fetchForecast,
  geocode,
  getTrip,
  isTripMember,
  reservePaidCall,
  takeFreeQuota,
} from '../server/trip-services'

const MAX_STOPS_PER_TRIP = 300
const FORECAST_TTL_MS = 60 * 60 * 1000
const INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const INVITE_CODE = /^[a-z0-9]{10}$/

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function fail(error: string) {
  return { success: false as const, error }
}

function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('')
}

async function nextPosition(tools: ActionTools, tripId: string, day: string): Promise<number> {
  const res = await tools.query<{ position?: number }>('stops', { where: { tripId, day }, orderBy: 'position', orderDir: 'desc', limit: 1 })
  const top = res.success ? Number(res.data.records[0]?.data.position ?? 0) : 0
  return top + 1
}

async function insertTrip(
  tools: ActionTools,
  userId: string,
  trip: { name: string; destination: string; startDate: string; endDate: string; placeLabel?: string; lat?: number; lon?: number },
) {
  const tripId = `trip_${crypto.randomUUID()}`
  const created = await tools.create('trips', { ...trip, teamId: tripId }, tripId)
  if (!created.success) return created
  const member = await tools.create('team_members', { teamId: tripId, userId, status: 'active', role: 'owner' })
  if (!member.success) {
    await tools.remove('trips', tripId)
    return member
  }
  return { success: true as const, data: { tripId } }
}

const createTrip: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const name = text(params.name, 80)
  const destination = text(params.destination, 120)
  const { startDate, endDate } = params
  if (!name) return fail('Give the trip a name')
  if (!destination) return fail('Add a destination')
  const dateError = validateTripDates(startDate, endDate)
  if (dateError) return fail(dateError)
  if (!(await takeFreeQuota(env, tools, userId, 'trip'))) return fail('Daily trip limit reached. Try again tomorrow.')

  let place: Awaited<ReturnType<typeof geocode>> = null
  let geocodeSkipped: 'user_cap' | 'app_cap' | null = null
  const reservation = await reservePaidCall(env, tools, userId, 'geocode')
  if (reservation.ok) place = await geocode(env, tools, destination)
  else geocodeSkipped = reservation.reason

  const result = await insertTrip(tools, userId, {
    name,
    destination,
    startDate: startDate as string,
    endDate: endDate as string,
    ...(place ? { placeLabel: place.label, lat: place.lat, lon: place.lon } : {}),
  })
  if (!result.success) return result
  return { success: true, data: { tripId: result.data.tripId, located: !!place, geocodeSkipped } }
}

const SAMPLE_STOPS: Array<{ offset: number; title: string; time?: string; notes?: string }> = [
  { offset: 0, title: 'Check in near Baixa', time: '15:00' },
  { offset: 0, title: 'Sunset at Miradouro da Senhora do Monte', time: '19:30' },
  { offset: 1, title: 'Tram 28 to Alfama', time: '09:30', notes: 'Board early at Martim Moniz to get a seat.' },
  { offset: 1, title: 'Lunch at Time Out Market', time: '13:00' },
  { offset: 2, title: 'Day trip to Sintra', time: '08:45', notes: 'Train from Rossio, about 40 minutes.' },
]

const createSampleTrip: ActionHandler<Env> = async ({ userId, tools, env }) => {
  if (!(await takeFreeQuota(env, tools, userId, 'trip'))) return fail('Daily trip limit reached. Try again tomorrow.')
  const startDate = addDays(todayIso(), 3)
  const result = await insertTrip(tools, userId, {
    name: 'Lisbon long weekend (sample)',
    destination: 'Lisbon, Portugal',
    placeLabel: 'Lisbon, PT',
    lat: 38.7078,
    lon: -9.1366,
    startDate,
    endDate: addDays(startDate, 2),
  })
  if (!result.success) return result
  const { tripId } = result.data
  for (const [i, stop] of SAMPLE_STOPS.entries()) {
    await tools.create('stops', {
      tripId,
      day: addDays(startDate, stop.offset),
      position: i + 1,
      title: stop.title,
      time: stop.time ?? '',
      notes: stop.notes ?? '',
      source: 'user',
    })
  }
  return { success: true, data: { tripId } }
}

const addStop: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = text(params.tripId, 100)
  const title = text(params.title, 120)
  const day = params.day
  if (!title) return fail('Add a title')
  if (!isIsoDate(day)) return fail('Pick a day')
  if (!(await isTripMember(tools, tripId, userId))) return fail('You are not a member of this trip')
  const trip = await getTrip(tools, tripId)
  if (!trip) return fail('Trip not found')
  if (!tripDays(trip.data.startDate, trip.data.endDate).includes(day)) return fail('That day is outside the trip')

  const existing = await tools.query('stops', { where: { tripId }, limit: MAX_STOPS_PER_TRIP })
  if (existing.success && existing.data.records.length >= MAX_STOPS_PER_TRIP) return fail('This trip has too many stops')

  const time = text(params.time, 5)
  const created = await tools.create('stops', {
    tripId,
    day,
    position: await nextPosition(tools, tripId, day),
    title,
    notes: text(params.notes, 1000),
    time: /^\d{2}:\d{2}$/.test(time) ? time : '',
    source: 'user',
  })
  if (!created.success) return created
  return { success: true, data: { stopId: created.data.recordId } }
}

const createInvite: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = text(params.tripId, 100)
  if (!(await isTripMember(tools, tripId, userId))) return fail('You are not a member of this trip')
  const existing = await tools.query<{ code: string }>('trip_invites', { where: { tripId }, limit: 1 })
  if (existing.success && existing.data.records[0]) {
    return { success: true, data: { code: existing.data.records[0].data.code } }
  }
  const code = newInviteCode()
  const created = await tools.create('trip_invites', { tripId, code })
  if (!created.success) return created
  return { success: true, data: { code } }
}

const joinTrip: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const code = text(params.code, 20).toLowerCase()
  if (!INVITE_CODE.test(code)) return fail('That invite link is not valid')
  const invite = await tools.query<{ tripId: string }>('trip_invites', { where: { code }, limit: 1 })
  const tripId = invite.success ? invite.data.records[0]?.data.tripId : undefined
  if (!tripId) return fail('That invite link is not valid or was removed')
  const trip = await getTrip(tools, tripId)
  if (!trip) return fail('This trip no longer exists')
  if (!(await isTripMember(tools, tripId, userId))) {
    const created = await tools.create('team_members', { teamId: tripId, userId, status: 'active', role: 'member' })
    if (!created.success && !/Duplicate/i.test(created.error)) return created
  }
  return { success: true, data: { tripId, name: trip.data.name } }
}

const refreshForecast: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const tripId = text(params.tripId, 100)
  if (!(await isTripMember(tools, tripId, userId))) return fail('You are not a member of this trip')
  const trip = await getTrip(tools, tripId)
  if (!trip) return fail('Trip not found')
  const { lat, lon, startDate, endDate, forecastAt } = trip.data
  if (typeof lat !== 'number' || typeof lon !== 'number') return { success: true, data: { status: 'no_location' } }
  if (!tripOverlapsForecast(startDate, endDate, todayIso())) return { success: true, data: { status: 'outside_window' } }
  if (forecastAt && Date.now() - Date.parse(forecastAt) < FORECAST_TTL_MS) {
    return { success: true, data: { status: 'cached' } }
  }
  const forecast = await fetchForecast(env, lat, lon)
  if (!forecast) return fail('Weather is unavailable right now')
  const updated = await tools.update('trips', tripId, { forecast, forecastAt: new Date().toISOString() })
  if (!updated.success) return updated
  return { success: true, data: { status: 'updated' } }
}

const deleteTrip: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = text(params.tripId, 100)
  const trip = await getTrip(tools, tripId)
  if (!trip) return fail('Trip not found')
  if (trip.createdBy !== userId) return fail('Only the person who created the trip can delete it')
  for (const [collection, where] of [
    ['stops', { tripId }],
    ['trip_invites', { tripId }],
    ['team_members', { teamId: tripId }],
  ] as const) {
    for (;;) {
      const res = await tools.deleteWhere(collection, where, 500)
      if (!res.success) return res
      if (res.data.deleted < 500) break
    }
  }
  const removed = await tools.remove('trips', tripId)
  if (!removed.success) return removed
  return { success: true, data: { tripId } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  createTrip,
  createSampleTrip,
  addStop,
  createInvite,
  joinTrip,
  refreshForecast,
  deleteTrip,
}
