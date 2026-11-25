/**
 * Place search for the co-planner. SerpApi Google Maps answers first
 * (owner-billed, 3.25 credits). When it fails (out of searches, upstream
 * error, out of credits) the free OpenStreetMap Nominatim search answers
 * instead. Results are cached per trip and query in `place_searches`, and every
 * uncached search, free or not, is reserved against the caller's daily cap.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { mocksExternalApis, reservePaidCall, settlePaidCall } from './trip-services.js'

export interface Place {
  name: string
  address?: string
  rating?: number
  reviews?: number
  type?: string
  lat?: number
  lon?: number
}

export type PlaceSource = 'serpapi' | 'openstreetmap'

export const OSM_ATTRIBUTION = 'Place data © OpenStreetMap contributors (ODbL)'

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

interface NominatimPlace {
  name?: string
  display_name?: string
  type?: string
  lat?: string
  lon?: string
}

/**
 * Nominatim `format=jsonv2`: coordinates are strings, the address is one
 * display line that starts with the name. Unnamed places (a bakery with no
 * name tag reads as its street) are dropped.
 */
export function placesFromNominatim(data: unknown): Place[] {
  const raw = Array.isArray(data) ? (data as NominatimPlace[]) : []
  return raw
    .map((p) => {
      const parts = (p.display_name ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const name = p.name?.trim()
      if (!name) return null
      const lat = Number(p.lat)
      const lon = Number(p.lon)
      const address = (parts[0] === name ? parts.slice(1) : parts).slice(0, 4).join(', ')
      return {
        name,
        ...(address ? { address } : {}),
        ...(p.type && p.type !== 'yes' ? { type: p.type.replace(/_/g, ' ') } : {}),
        ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}),
      }
    })
    .filter((p): p is Place => p !== null)
    .slice(0, MAX_PLACES)
}

function mockPlaces(query: string, source: PlaceSource): Place[] {
  return [1, 2, 3].map((i) => ({
    name: `${query} ${source === 'serpapi' ? 'spot' : 'osm place'} ${i} (test)`,
    address: `${i} Test Street`,
    ...(source === 'serpapi' ? { rating: 4 + i / 10, reviews: 100 * i } : {}),
    lat: 38.7 + i / 100,
    lon: -9.13,
  }))
}

interface SearchInput {
  tripId: string
  query: string
  destination: string
  lat?: number | null
  lon?: number | null
}

function located(input: SearchInput): input is SearchInput & { lat: number; lon: number } {
  return typeof input.lat === 'number' && typeof input.lon === 'number'
}

/** Null when SerpApi did not answer; its call is then not billed. Mocked runs fail on purpose for queries with "osm" in them. */
async function serpApiPlaces(env: Env, tools: ActionTools, input: SearchInput): Promise<Place[] | null> {
  if (mocksExternalApis(env)) return /\bosm\b/i.test(input.query) ? null : mockPlaces(input.query.trim(), 'serpapi')
  const res = await tools.integration<unknown>('serpapi/places-search', {
    q: located(input) ? input.query : `${input.query} in ${input.destination}`,
    ...(located(input) ? { ll: `@${input.lat.toFixed(4)},${input.lon.toFixed(4)},14z` } : {}),
    hl: 'en',
  })
  if (!res.success) {
    console.warn(`[places] serpapi failed, trying OpenStreetMap: ${res.error}`)
    return null
  }
  return placesFromSerpApi(res.data)
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
/** Nominatim's usage policy asks for an app-identifying User-Agent: the app name and URL only, nothing about the user. */
const NOMINATIM_USER_AGENT = 'tripboard-app/1.0 (+https://tripboard-app.app.space)'
/** About 15 km around the destination. */
const VIEWBOX_DEGREES = 0.15

export function nominatimUrl(input: SearchInput): URL {
  const url = new URL(NOMINATIM_URL)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', String(MAX_PLACES))
  url.searchParams.set('accept-language', 'en')
  if (located(input)) {
    const d = VIEWBOX_DEGREES
    url.searchParams.set('q', input.query)
    url.searchParams.set('viewbox', [input.lon - d, input.lat + d, input.lon + d, input.lat - d].map((n) => n.toFixed(4)).join(','))
    url.searchParams.set('bounded', '1')
  } else {
    url.searchParams.set('q', `${input.query}, ${input.destination}`)
  }
  return url
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Nominatim allows at most one request per second from the whole app. Each
 * call claims the current second as a unique `osm_slots` row in the app's one
 * record room, so two workers can never send in the same second; a taken
 * second waits for the next. Rows stay (one per OSM search, bounded by caps).
 */
async function takeNominatimSlot(tools: ActionTools): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const created = await tools.create('osm_slots', { second: String(Math.floor(Date.now() / 1000)) })
    if (created.success) return true
    if (!/Duplicate/i.test(created.error)) return false
    await sleep(1000 - (Date.now() % 1000) + 20)
  }
  return false
}

async function openStreetMapPlaces(env: Env, tools: ActionTools, input: SearchInput): Promise<Place[] | null> {
  if (!(await takeNominatimSlot(tools))) return null
  if (mocksExternalApis(env)) return mockPlaces(input.query.trim(), 'openstreetmap')
  try {
    const res = await fetch(nominatimUrl(input), {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn(`[places] nominatim ${res.status}`)
      return null
    }
    return placesFromNominatim(await res.json())
  } catch (err) {
    console.warn(`[places] nominatim request failed: ${String(err)}`)
    return null
  }
}

export type PlaceSearchResult =
  | { ok: true; places: Place[]; cached: boolean; source: PlaceSource }
  | { ok: false; reason: 'user_cap' | 'app_cap' | 'turn_limit' | 'unavailable' }

/**
 * Callers check trip membership first; this handles the cache, the caps and
 * the calls. `takeUncached` is asked once per cache miss so a caller can limit
 * new searches per request.
 */
export async function searchPlaces(
  env: Env,
  tools: ActionTools,
  userId: string,
  input: SearchInput,
  takeUncached: () => boolean = () => true,
): Promise<PlaceSearchResult> {
  const query = normalizeQuery(input.query)
  const cached = await tools.query<{ places?: Place[]; source?: PlaceSource }>('place_searches', {
    where: { tripId: input.tripId, query },
    limit: 1,
  })
  const hit = cached.success ? cached.data.records[0] : undefined
  if (hit) return { ok: true, places: hit.data.places ?? [], cached: true, source: hit.data.source ?? 'serpapi' }

  if (!takeUncached()) return { ok: false, reason: 'turn_limit' }
  const reservation = await reservePaidCall(env, tools, userId, 'places')
  if (!reservation.ok) return { ok: false, reason: reservation.reason }

  let source: PlaceSource = 'serpapi'
  let places = await serpApiPlaces(env, tools, input)
  if (!places) {
    source = 'openstreetmap'
    await settlePaidCall(tools, reservation.usageId, 0)
    places = await openStreetMapPlaces(env, tools, input)
  }
  if (!places) return { ok: false, reason: 'unavailable' }

  const saved = await tools.create('place_searches', { tripId: input.tripId, query, places, source })
  if (!saved.success && !/Duplicate/i.test(saved.error)) console.warn(`[places] cache write failed: ${saved.error}`)
  return { ok: true, places, cached: false, source }
}

/** Activity words that say what you do at a place, not which place it is. */
const LOCATE_STOPWORDS = new Set(
  'the and for with near from into onto visit visiting check lunch dinner breakfast brunch drinks coffee walk tour trip day night morning evening afternoon sunset sunrise stop see explore'.split(' '),
)

function placeTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !LOCATE_STOPWORDS.has(t))
}

/**
 * What to look up for a stop title: the title itself, then the part after
 * "at", "to", "near" or "in" ("Lunch at Time Out Market" -> "Time Out Market").
 * Titles with no place-like words ("Dinner") give nothing.
 */
export function locateQueries(title: string): string[] {
  const clean = title.trim().replace(/\s+/g, ' ').slice(0, 120)
  if (placeTokens(clean).length === 0) return []
  const tail = /\b(?:at|to|near|in|@)\s+(.+)$/i.exec(clean)?.[1]?.trim()
  return tail && tail !== clean && placeTokens(tail).length > 0 ? [clean, tail] : [clean]
}

/** A result counts only if it shares a real word with what was asked, so "Lunch" never pins a random café. */
export function placeMatches(name: string, query: string): boolean {
  const asked = new Set(placeTokens(query))
  const shared = placeTokens(name).filter((t) => asked.has(t)).length
  return shared >= (asked.size >= 3 ? 2 : 1)
}

/**
 * Finds a stop title on the map with the free Nominatim search, bounded to
 * about 15 km around the trip and sharing the app-wide 1 request per second.
 * Callers check membership and the caller's daily quota first. Mocked runs
 * place any title with a real word in it just off the trip centre.
 */
export async function locatePlace(
  env: Env,
  tools: ActionTools,
  input: { title: string; destination: string; lat: number; lon: number },
): Promise<Place | null> {
  for (const query of locateQueries(input.title)) {
    if (mocksExternalApis(env)) {
      if (/\bnowhere\b/i.test(query)) return null
      return { name: query, address: 'Test Street', lat: input.lat + 0.004, lon: input.lon + 0.006 }
    }
    const places = await openStreetMapPlaces(env, tools, { tripId: '', query, destination: input.destination, lat: input.lat, lon: input.lon })
    const hit = places?.find((p) => typeof p.lat === 'number' && typeof p.lon === 'number' && placeMatches(p.name, query))
    if (hit) return hit
  }
  return null
}
