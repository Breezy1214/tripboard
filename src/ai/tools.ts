/**
 * Co-planner tools, shared by the in-app chat and local agents
 * (`npx deepspace agent tools tripboard-app`).
 *
 * Built-in record tools are read-only here. Every board write goes through a
 * validated tool that runs the same membership-checked services as the
 * board's server actions (src/server/board-services.ts), so the assistant can
 * never do more than the user it acts for. Paid calls (place search) are
 * reserved against the caller's daily cap and the app-wide ceiling first.
 */

import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod/v4'
import { AgentToolError, BUILT_IN_TOOLS, applyAiToolDefaults } from 'deepspace/worker'
import type { ActionTools, AgentToolContext, ToolSchema } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import type { Stop, Trip } from '../types.js'
import { tripDays } from '../lib/trip-dates.js'
import { weatherLabel } from '../lib/weather-codes.js'
import { createActionTools } from '../server/action-routes.js'
import {
  addStopFor,
  MAX_STOPS_PER_TRIP,
  memberTrip,
  moveStopFor,
  refreshTripForecast,
  removeStopFor,
  type ServiceCode,
  type ServiceResult,
} from '../server/board-services.js'
import { OSM_ATTRIBUTION, searchPlaces } from '../server/places.js'
import { CHAT_MESSAGES } from './errors.js'

type ToolExecutor = (toolName: string, params: Record<string, unknown>) => Promise<unknown>

/** Reads only. Writes go through add_stop, move_stop and remove_stop below. */
export const ALLOWED_TOOL_NAMES = ['schema.list', 'schema.describe', 'records.query', 'records.get', 'user.current']

export const CUSTOM_TOOL_NAMES = ['get_trip', 'search_places', 'get_forecast', 'add_stop', 'move_stop', 'remove_stop'] as const

/** New (uncached) place searches allowed per chat turn or agent request; repeats come from the cache. */
export const UNCACHED_SEARCHES_PER_REQUEST = 1

const STATUS: Record<ServiceCode, number> = { invalid: 400, not_member: 403, not_found: 404, limit: 409, failed: 502 }

function unwrap<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new AgentToolError(result.code, result.error, STATUS[result.code])
  return result.data
}

type StopRow = { recordId: string; data: Stop }

export async function loadTripContext(tools: ActionTools, userId: string, tripId: string) {
  const trip = unwrap(await memberTrip(tools, tripId, userId))
  const res = await tools.query<Record<string, unknown>>('stops', { where: { tripId }, limit: MAX_STOPS_PER_TRIP })
  const stops = (res.success ? (res.data.records as unknown as StopRow[]) : []).sort(
    (a, b) => a.data.day.localeCompare(b.data.day) || (a.data.position ?? 0) - (b.data.position ?? 0),
  )
  return { tripId, trip: trip.data as Trip, stops }
}

function summarizeStop(stop: StopRow) {
  const { day, position, title, time, notes, placeName, address, rating, source } = stop.data
  return { stopId: stop.recordId, day, position, title, time: time || undefined, notes: notes || undefined, placeName, address, rating, source }
}

const tripIdField = z.string().min(1).max(100).describe('Trip id, like trip_... (from the trip page URL /trips/<id>)')
const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Day of the trip, YYYY-MM-DD, inside the trip dates')
const stopIdField = z.string().min(1).max(100).describe('Stop id from get_trip')

export function buildTools(executor: ToolExecutor, context: AgentToolContext<Env>): ToolSet {
  const tools: ToolSet = {}

  for (const def of BUILT_IN_TOOLS) {
    if (!ALLOWED_TOOL_NAMES.includes(def.name)) continue
    tools[def.name.replace('.', '_')] = tool({
      description: def.description,
      inputSchema: buildInputSchema(def),
      execute: async (params: Record<string, unknown>) => executor(def.name, applyAiToolDefaults(def.name, params)),
    })
  }

  const { env, userId } = context
  const actionTools = createActionTools(env, userId, '')

  tools.get_trip = tool({
    description: 'Read one trip you are a member of: name, destination, dates, its days and every stop with its id.',
    inputSchema: z.object({ tripId: tripIdField }),
    execute: async ({ tripId }) => {
      const { trip, stops } = await loadTripContext(actionTools, userId, tripId)
      return {
        tripId,
        name: trip.name,
        destination: trip.placeLabel || trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        days: tripDays(trip.startDate, trip.endDate),
        stops: stops.map(summarizeStop),
      }
    },
  })

  // buildTools runs once per chat turn and per agent request, so this budget is per request.
  let uncachedSearchesLeft = UNCACHED_SEARCHES_PER_REQUEST
  const takeUncachedSearch = () => uncachedSearchesLeft-- > 0

  tools.search_places = tool({
    description:
      'Search real places near the trip destination: restaurants, sights, cafes. Google Maps (SerpApi) first, ' +
      'OpenStreetMap when that is unavailable; `source` says which answered. Returns name, address, rating (Google only) ' +
      'and coordinates. One new search per message, so make it count: a short category or name works best ' +
      '(e.g. "bakery", "museum"). Repeated queries are cached.',
    inputSchema: z.object({ tripId: tripIdField, query: z.string().min(2).max(120).describe('What to look for, e.g. "bakery" or "Belem Tower"') }),
    execute: async ({ tripId, query }) => {
      const trip = unwrap(await memberTrip(actionTools, tripId, userId)).data
      const result = await searchPlaces(
        env,
        actionTools,
        userId,
        { tripId, query, destination: trip.placeLabel || trip.destination, lat: trip.lat, lon: trip.lon },
        takeUncachedSearch,
      )
      if (result.ok) {
        return {
          query,
          cached: result.cached,
          source: result.source,
          ...(result.source === 'openstreetmap' ? { attribution: OSM_ATTRIBUTION } : {}),
          places: result.places,
        }
      }
      const refusals = {
        user_cap: ['places_user_cap', 'You have used your place searches for today. They reset at midnight UTC.', 429],
        app_cap: ['places_app_cap', CHAT_MESSAGES.appCap, 429],
        turn_limit: ['places_turn_limit', 'Only one new place search per message. Use the results you have, or ask the user to send another message.', 429],
        unavailable: ['places_unavailable', 'Place search is unavailable right now. Suggest places from general knowledge and say so.', 503],
      } as const
      const [code, message, status] = refusals[result.reason]
      throw new AgentToolError(code, message, status)
    },
  })

  tools.get_forecast = tool({
    description: 'Daily weather for each day of the trip (Open-Meteo, about 16 days ahead). Days outside the window have no forecast.',
    inputSchema: z.object({ tripId: tripIdField }),
    execute: async ({ tripId }) => {
      const trip = unwrap(await memberTrip(actionTools, tripId, userId)).data
      const { status, forecast } = unwrap(await refreshTripForecast(env, actionTools, userId, tripId))
      const known = forecast ?? trip.forecast
      return {
        status,
        days: tripDays(trip.startDate, trip.endDate).map((day) => {
          const w = known?.days?.[day]
          return w
            ? { day, summary: weatherLabel(w.code), maxC: w.max, minC: w.min, rainChance: w.precip }
            : { day, summary: 'No forecast yet' }
        }),
      }
    },
  })

  tools.add_stop = tool({
    description: 'Add a stop to one day of the trip. Everyone on the trip sees it live, marked as added by AI.',
    inputSchema: z.object({
      tripId: tripIdField,
      day: dayField,
      title: z.string().min(1).max(120),
      time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('24h time, HH:MM'),
      notes: z.string().max(1000).optional(),
      placeName: z.string().max(160).optional(),
      address: z.string().max(240).optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      rating: z.number().optional(),
    }),
    execute: async (input) => unwrap(await addStopFor(actionTools, userId, { ...input, source: 'ai' })),
  })

  tools.move_stop = tool({
    description: 'Move a stop to another day of the trip, or reorder it within its day. Position is 1-based; omit it to put the stop last.',
    inputSchema: z.object({ tripId: tripIdField, stopId: stopIdField, day: dayField, position: z.number().int().min(1).optional() }),
    execute: async (input) => unwrap(await moveStopFor(actionTools, userId, input)),
  })

  tools.remove_stop = tool({
    description: 'Remove one stop from the trip for everyone. Confirm with the user before removing more than one.',
    inputSchema: z.object({ tripId: tripIdField, stopId: stopIdField }),
    execute: async (input) => unwrap(await removeStopFor(actionTools, userId, input)),
  })

  return tools
}

/**
 * Built-in tools describe params as a flat ToolSchema. The Zod validator is
 * the single source; the provider-facing JSON Schema is derived with Zod's
 * own conversion, which keeps z.record() objects open (`where` filters).
 */
function buildInputSchema(def: ToolSchema) {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [name, param] of Object.entries(def.params)) {
    let s: z.ZodTypeAny
    switch (param.type) {
      case 'string':
        s = z.string()
        break
      case 'number':
        s = z.number()
        break
      case 'boolean':
        s = z.boolean()
        break
      case 'object':
        s = z.record(z.string(), z.unknown())
        break
      case 'array':
        s = z.array(z.unknown())
        break
    }
    if (param.description) s = s.describe(param.description)
    if (!param.required) s = s.optional()
    shape[name] = s
  }

  const validator = z.object(shape)
  return jsonSchema<Record<string, unknown>>(z.toJSONSchema(validator) as Parameters<typeof jsonSchema>[0], {
    validate: async (value) => {
      const result = await validator.safeParseAsync(value)
      return result.success ? { success: true, value: result.data } : { success: false, error: result.error }
    },
  })
}
