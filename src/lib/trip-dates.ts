export const MAX_TRIP_DAYS = 21
export const FORECAST_WINDOW_DAYS = 16

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function toUtcMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtcMs(iso) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS)
}

export function tripDays(startDate: string, endDate: string): string[] {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return []
  const count = daysBetween(startDate, endDate) + 1
  if (count < 1) return []
  return Array.from({ length: Math.min(count, MAX_TRIP_DAYS) }, (_, i) => addDays(startDate, i))
}

export function validateTripDates(startDate: unknown, endDate: unknown): string | null {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return 'Dates must be YYYY-MM-DD'
  const length = daysBetween(startDate, endDate) + 1
  if (length < 1) return 'End date must be on or after the start date'
  if (length > MAX_TRIP_DAYS) return `Trips can be at most ${MAX_TRIP_DAYS} days`
  return null
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Last date Open-Meteo forecasts, counting today as day 1. */
export function forecastHorizon(today: string): string {
  return addDays(today, FORECAST_WINDOW_DAYS - 1)
}

export type DayForecastStatus =
  | { kind: 'in_window' }
  | { kind: 'past' }
  | { kind: 'too_far'; opensInDays: number }

export function forecastStatus(day: string, today: string): DayForecastStatus {
  if (day < today) return { kind: 'past' }
  const horizon = forecastHorizon(today)
  if (day <= horizon) return { kind: 'in_window' }
  return { kind: 'too_far', opensInDays: daysBetween(horizon, day) }
}

export function tripOverlapsForecast(startDate: string, endDate: string, today: string): boolean {
  return endDate >= today && startDate <= forecastHorizon(today)
}

export function formatDay(iso: string): { weekday: string; label: string } {
  const date = new Date(`${iso}T00:00:00Z`)
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  }
}

export function formatRange(startDate: string, endDate: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  const start = new Date(`${startDate}T00:00:00Z`).toLocaleDateString('en-US', opts)
  const end = new Date(`${endDate}T00:00:00Z`).toLocaleDateString('en-US', {
    ...opts,
    year: 'numeric',
  })
  return startDate === endDate ? end : `${start} to ${end}`
}
