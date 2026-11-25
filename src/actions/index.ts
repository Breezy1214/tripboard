import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { addDays, todayIso, validateTripDates } from '../lib/trip-dates'
import { addStopFor, locateStopFor, moveStopFor, refreshTripForecast, text } from '../server/board-services'
import { fillUsageForTests, geocode, getTrip, isTripMember, reservePaidCall, takeFreeQuota } from '../server/trip-services'

const INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const INVITE_CODE = /^[a-z0-9]{10}$/

function fail(error: string) {
  return { success: false as const, error }
}

function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('')
}

/** Name and avatar from the member's own users row, so co-members can show them without the app-wide roster. */
async function memberProfile(tools: ActionTools, userId: string) {
  const res = await tools.get<{ name?: string; imageUrl?: string }>('users', userId)
  const user = res.success ? res.data.record?.data : undefined
  return {
    name: text(user?.name, 120),
    ...(user?.imageUrl && user.imageUrl.length <= 2048 ? { imageUrl: user.imageUrl } : {}),
  }
}

async function insertTrip(
  tools: ActionTools,
  userId: string,
  trip: { name: string; destination: string; startDate: string; endDate: string; placeLabel?: string; lat?: number; lon?: number },
) {
  const tripId = `trip_${crypto.randomUUID()}`
  const created = await tools.create('trips', { ...trip, teamId: tripId }, tripId)
  if (!created.success) return created
  const member = await tools.create('team_members', {
    teamId: tripId,
    userId,
    status: 'active',
    role: 'owner',
    ...(await memberProfile(tools, userId)),
  })
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

const SAMPLE_STOPS: Array<{ offset: number; title: string; time?: string; notes?: string; lat: number; lon: number }> = [
  { offset: 0, title: 'Check in near Baixa', time: '15:00', lat: 38.7106, lon: -9.1377 },
  { offset: 0, title: 'Sunset at Miradouro da Senhora do Monte', time: '17:00', lat: 38.7193, lon: -9.1325 },
  { offset: 1, title: 'Tram 28 to Alfama', time: '09:30', notes: 'Board early at Martim Moniz to get a seat.', lat: 38.7163, lon: -9.1361 },
  { offset: 1, title: 'Lunch at Time Out Market', time: '13:00', lat: 38.7069, lon: -9.1459 },
  { offset: 2, title: 'Day trip to Sintra', time: '08:45', notes: 'Train from Rossio, about 40 minutes.', lat: 38.7976, lon: -9.3904 },
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
      lat: stop.lat,
      lon: stop.lon,
      source: 'user',
    })
  }
  return { success: true, data: { tripId } }
}

const addStop: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const { tripId, day, title, notes, time } = params
  const result = await addStopFor(tools, userId, { tripId, day, title, notes, time, source: 'user' })
  return result.success ? { success: true, data: { stopId: result.data.stopId } } : fail(result.error)
}

const moveStop: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const { tripId, stopId, day, position } = params
  const result = await moveStopFor(tools, userId, { tripId, stopId, day, position })
  return result.success ? { success: true, data: result.data } : fail(result.error)
}

const locateStop: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const result = await locateStopFor(env, tools, userId, { tripId: params.tripId, stopId: params.stopId })
  return result.success ? { success: true, data: result.data } : fail(result.error)
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
  const profile = await memberProfile(tools, userId)
  const existing = await tools.query('team_members', { where: { teamId: tripId, userId }, limit: 1 })
  const row = existing.success ? existing.data.records[0] : undefined
  if (row?.data.status === 'removed') return fail('You were removed from this trip')
  if (row) {
    await tools.update('team_members', row.recordId, profile)
  } else {
    const created = await tools.create('team_members', { teamId: tripId, userId, status: 'active', role: 'member', ...profile })
    if (!created.success && !/Duplicate/i.test(created.error)) return created
  }
  return { success: true, data: { tripId, name: trip.data.name } }
}

const refreshForecast: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const result = await refreshTripForecast(env, tools, userId, params.tripId)
  return result.success ? { success: true, data: { status: result.data.status } } : fail(result.error)
}

const deleteTrip: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = text(params.tripId, 100)
  const trip = await getTrip(tools, tripId)
  if (!trip) return fail('Trip not found')
  if (trip.createdBy !== userId) return fail('Only the person who created the trip can delete it')
  const chats = await tools.query('ai-chats', { where: { tripId }, limit: 500 })
  const drain = async (collection: string, where: Record<string, string>) => {
    for (;;) {
      const res = await tools.deleteWhere(collection, where, 500)
      if (!res.success || res.data.deleted < 500) return res
    }
  }
  const targets: [string, Record<string, string>][] = [
    ...(chats.success ? chats.data.records : []).map((chat): [string, Record<string, string>] => ['ai-messages', { chatId: chat.recordId }]),
    ['ai-chats', { tripId }],
    ['place_searches', { tripId }],
    ['stops', { tripId }],
    ['trip_invites', { tripId }],
  ]
  for (const [collection, where] of targets) {
    const res = await drain(collection, where)
    if (!res.success) return res
  }
  // Members last: the room only sends a delete to sockets that can still read
  // the row, so open boards hear about the trip going away while still members.
  const removed = await tools.remove('trips', tripId)
  if (!removed.success) return removed
  const members = await drain('team_members', { teamId: tripId })
  if (!members.success) return members
  return { success: true, data: { tripId } }
}

/** Mocked test runs only (refused otherwise): fill the caller's daily cap for chat or places, so e2e tests reach the real refusal. */
const fillTestUsage: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const kind = params.kind === 'chat' || params.kind === 'places' ? params.kind : null
  if (!kind || !(await fillUsageForTests(env, tools, userId, kind))) return fail('Not available')
  return { success: true, data: { kind } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  createTrip,
  createSampleTrip,
  addStop,
  moveStop,
  locateStop,
  createInvite,
  joinTrip,
  refreshForecast,
  deleteTrip,
  fillTestUsage,
}
