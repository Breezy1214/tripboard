import { describe, expect, it } from 'vitest'
import { CHAT_MESSAGES, chatErrorText, isOutOfCredits } from './errors'
import { buildTripPrompt } from './prompt'
import { planReply, readTripFacts } from './test-model'
import { placesFromSerpApi } from '../server/places'
import type { Stop, Trip } from '../types'

const trip: Trip = {
  name: 'Lisbon weekend',
  destination: 'Lisbon',
  placeLabel: 'Lisbon, PT',
  startDate: '2026-12-01',
  endDate: '2026-12-03',
  teamId: 'trip_1',
}
const stops = [
  { recordId: 'stop_a', data: { tripId: 'trip_1', day: '2026-12-02', position: 1, title: 'Tram 28', time: '09:30' } as Stop },
  { recordId: 'stop_b', data: { tripId: 'trip_1', day: '2026-12-03', position: 1, title: 'Sintra', source: 'ai' } as Stop },
]

describe('out-of-credits detection', () => {
  it('spots a 402, an insufficient_credits code, or one nested in a cause', () => {
    expect(isOutOfCredits({ statusCode: 402 })).toBe(true)
    expect(isOutOfCredits({ success: false, code: 'insufficient_credits', error: 'x' })).toBe(true)
    expect(isOutOfCredits(new Error('wrapped', { cause: { responseBody: '{"error":"insufficient_credits"}' } }))).toBe(true)
    expect(isOutOfCredits(new Error('Rate limited'))).toBe(false)
    expect(isOutOfCredits({ statusCode: 500, message: 'boom' })).toBe(false)
  })

  it('gives a friendly message for credits and keeps other errors as they are', () => {
    expect(chatErrorText({ statusCode: 402 })).toBe(CHAT_MESSAGES.outOfCredits)
    expect(chatErrorText(new Error('You are not a member of this trip'))).toBe('You are not a member of this trip')
  })
})

describe('trip prompt', () => {
  const prompt = buildTripPrompt({ tripId: 'trip_1', trip, stops, userName: 'Blair' })

  it('scopes the assistant to this trip: id, destination, dates, days and stops', () => {
    expect(prompt).toContain('Trip id: trip_1')
    expect(prompt).toContain('Destination: Lisbon, PT')
    expect(prompt).toContain('Dates: 2026-12-01 to 2026-12-03 (3 days)')
    expect(prompt).toContain('- Day 3: 2026-12-03')
    expect(prompt).toContain('- [stop_a] Day 2 2026-12-02 09:30: Tram 28')
    expect(prompt).toContain('- [stop_b] Day 3 2026-12-03: Sintra (added by AI)')
    expect(prompt).toContain('helping Blair')
  })

  it('is what the test model reads to pick tool calls', () => {
    const facts = readTripFacts(prompt)
    expect(facts).toEqual({
      tripId: 'trip_1',
      days: ['2026-12-01', '2026-12-02', '2026-12-03'],
      stops: [
        { id: 'stop_a', title: 'Tram 28' },
        { id: 'stop_b', title: 'Sintra' },
      ],
    })
    expect(planReply('add Castle on day 2', facts)).toEqual({
      tool: 'add_stop',
      input: { tripId: 'trip_1', day: '2026-12-02', title: 'Castle' },
    })
    expect(planReply('remove Sintra', facts)).toEqual({ tool: 'remove_stop', input: { tripId: 'trip_1', stopId: 'stop_b' } })
    expect(planReply('out of credits please', facts)).toEqual({ fail: 'credits' })
  })
})

describe('SerpApi places', () => {
  it('reads local_results and a single place_results', () => {
    const list = placesFromSerpApi({
      local_results: [
        { title: 'Manteigaria', address: 'R. do Loreto 2', rating: 4.7, reviews: 9000, type: 'Bakery', gps_coordinates: { latitude: 38.71, longitude: -9.14 } },
        { address: 'no title, skipped' },
      ],
    })
    expect(list).toEqual([
      { name: 'Manteigaria', address: 'R. do Loreto 2', rating: 4.7, reviews: 9000, type: 'Bakery', lat: 38.71, lon: -9.14 },
    ])
    expect(placesFromSerpApi({ place_results: { title: 'Belem Tower' } })).toEqual([{ name: 'Belem Tower' }])
    expect(placesFromSerpApi(null)).toEqual([])
  })
})
