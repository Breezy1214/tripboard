export interface LatLon {
  lat: number
  lon: number
}

export function hasCoords<T extends { lat?: number | null; lon?: number | null }>(p: T): p is T & LatLon {
  return typeof p.lat === 'number' && typeof p.lon === 'number'
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}
