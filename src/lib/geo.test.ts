import { describe, expect, it } from 'vitest'
import { distanceKm, formatDistance, hasCoords } from './geo'

describe('geo', () => {
  it('measures Lisbon Baixa to Time Out Market at about 0.8 km', () => {
    const km = distanceKm({ lat: 38.7106, lon: -9.1377 }, { lat: 38.7069, lon: -9.1459 })
    expect(km).toBeGreaterThan(0.7)
    expect(km).toBeLessThan(0.9)
  })

  it('formats metres under a kilometre and one decimal under ten', () => {
    expect(formatDistance(0.012)).toBe('50 m')
    expect(formatDistance(0.83)).toBe('850 m')
    expect(formatDistance(2.345)).toBe('2.3 km')
    expect(formatDistance(23.6)).toBe('24 km')
  })

  it('needs both coordinates as numbers', () => {
    expect(hasCoords({ lat: 1, lon: 2 })).toBe(true)
    expect(hasCoords({ lat: 1, lon: null })).toBe(false)
    expect(hasCoords({})).toBe(false)
  })
})
