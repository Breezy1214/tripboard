/**
 * Place search for the co-planner: SerpApi Google Maps results (owner-billed,
 * 3.25 credits a call), cached per trip and query in `place_searches`, and
 * reserved against the caller's daily cap before any uncached call.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { mocksExternalApis, reservePaidCall } from './trip-services.js'
import { isOutOfCredits } from '../ai/errors.js'

export interface Place {
  name: string
  address?: string
  rating?: number
  reviews?: number
  type?: string
  lat?: number
  lon?: number
}

const MAX_PLACES = 6

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120)
}

interface SerpPlace {
  title?: string
  address?: string
  rating?: number
  reviews?: number
  type?: string
  gps_coordinates?: { latitude?: number; longitude?: number }
}

/** SerpApi answers `local_results` for a list and `place_results` for one exact match. */
export function placesFromSerpApi(data: unknown): Place[] {
  const body = (data ?? {}) as { local_results?: SerpPlace[]; place_results?: SerpPlace }
  const raw = Array.isArray(body.local_results) ? body.local_results : body.place_results ? [body.place_results] : []
  return raw
    .filter((p) => typeof p.title === 'string' && p.title.trim())
    .slice(0, MAX_PLACES)
    .map((p) => ({
      name: p.title!.trim(),
      ...(p.address ? { address: p.address } : {}),
      ...(typeof p.rating === 'number' ? { rating: p.rating } : {}),
      ...(typeof p.reviews === 'number' ? { reviews: p.reviews } : {}),
      ...(p.type ? { type: p.type } : {}),
      ...(typeof p.gps_coordinates?.latitude === 'number' && typeof p.gps_coordinates.longitude === 'number'
        ? { lat: p.gps_coordinates.latitude, lon: p.gps_coordinates.longitude }
        : {}),
    }))
}

function mockPlaces(query: string): Place[] {
  return [1, 2, 3].map((i) => ({
    name: `${query} spot ${i} (test)`,
    address: `${i} Test Street`,
    rating: 4 + i / 10,
    reviews: 100 * i,
    lat: 38.7 + i / 100,
    lon: -9.13,
  }))
}

export type PlaceSearchResult =
  | { ok: true; places: Place[]; cached: boolean }
  | { ok: false; reason: 'user_cap' | 'app_cap' | 'out_of_credits' | 'unavailable' }

interface SearchInput {
  tripId: string
  query: string
  destination: string
  lat?: number | null
  lon?: number | null
}

/** Callers check trip membership first; this only handles cache, caps and the paid call. */
export async function searchPlaces(env: Env, tools: ActionTools, userId: string, input: SearchInput): Promise<PlaceSearchResult> {
  const query = normalizeQuery(input.query)
  const cached = await tools.query<{ places?: Place[] }>('place_searches', { where: { tripId: input.tripId, query }, limit: 1 })
  const hit = cached.success ? cached.data.records[0] : undefined
  if (hit) return { ok: true, places: hit.data.places ?? [], cached: true }

  const reservation = await reservePaidCall(env, tools, userId, 'places')
  if (!reservation.ok) return { ok: false, reason: reservation.reason }

  let places: Place[]
  if (mocksExternalApis(env)) {
    places = mockPlaces(input.query.trim())
  } else {
    const located = typeof input.lat === 'number' && typeof input.lon === 'number'
    const res = await tools.integration<unknown>('serpapi/places-search', {
      q: located ? input.query : `${input.query} in ${input.destination}`,
      ...(located ? { ll: `@${input.lat!.toFixed(4)},${input.lon!.toFixed(4)},14z` } : {}),
      hl: 'en',
    })
    if (!res.success) {
      console.warn(`[places] failed: ${res.error}`)
      return { ok: false, reason: isOutOfCredits(res) ? 'out_of_credits' : 'unavailable' }
    }
    places = placesFromSerpApi(res.data)
  }

  const saved = await tools.create('place_searches', { tripId: input.tripId, query, places })
  if (!saved.success && !/Duplicate/i.test(saved.error)) console.warn(`[places] cache write failed: ${saved.error}`)
  return { ok: true, places, cached: false }
}
