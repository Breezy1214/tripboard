import { describe, expect, it } from 'vitest'
import { addDays, forecastStatus, isIsoDate, tripDays, tripOverlapsForecast, validateTripDates } from './trip-dates'

describe('trip dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-11-25')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('11/25/2026')).toBe(false)
  })

  it('lists every day of the trip, inclusive', () => {
    expect(tripDays('2026-12-30', '2027-01-01')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01'])
    expect(tripDays('2026-12-02', '2026-12-01')).toEqual([])
  })

  it('rejects reversed and overlong trips', () => {
    expect(validateTripDates('2026-12-01', '2026-12-01')).toBeNull()
    expect(validateTripDates('2026-12-02', '2026-12-01')).toMatch(/after/)
    expect(validateTripDates('2026-12-01', addDays('2026-12-01', 21))).toMatch(/at most/)
  })

  it('places days relative to the 16-day forecast window', () => {
    const today = '2026-11-21'
    expect(forecastStatus('2026-11-20', today)).toEqual({ kind: 'past' })
    expect(forecastStatus('2026-11-21', today)).toEqual({ kind: 'in_window' })
    expect(forecastStatus('2026-12-06', today)).toEqual({ kind: 'in_window' })
    expect(forecastStatus('2026-12-07', today)).toEqual({ kind: 'too_far', opensInDays: 1 })
    expect(tripOverlapsForecast('2026-12-20', '2026-12-24', today)).toBe(false)
    expect(tripOverlapsForecast('2026-12-05', '2026-12-10', today)).toBe(true)
  })
})
