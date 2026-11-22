import { describe, expect, it } from 'vitest'
import { forecastFromOpenMeteo, placeFromGeocoding } from './trip-services'

describe('integration parsers', () => {
  it('reads the first geocoding match', () => {
    const place = placeFromGeocoding([{ name: 'Lisbon', lat: 38.7, lon: -9.1, country: 'PT', local_names: {} }])
    expect(place).toEqual({ lat: 38.7, lon: -9.1, label: 'Lisbon, PT' })
    expect(placeFromGeocoding([])).toBeNull()
    expect(placeFromGeocoding({ error: 'x' })).toBeNull()
  })

  it('maps Open-Meteo daily arrays by date', () => {
    const forecast = forecastFromOpenMeteo({
      daily: {
        time: ['2026-11-22', '2026-11-23'],
        weather_code: [3, 61],
        temperature_2m_max: [18.6, 15.2],
        temperature_2m_min: [11.4, 9.9],
        precipitation_probability_max: [10, null],
      },
    })
    expect(forecast?.days['2026-11-22']).toEqual({ code: 3, max: 19, min: 11, precip: 10 })
    expect(forecast?.days['2026-11-23']).toEqual({ code: 61, max: 15, min: 10, precip: null })
    expect(forecastFromOpenMeteo({})).toBeNull()
  })
})
