import { describe, expect, it } from 'vitest'
import { CHAT_MESSAGES, chatErrorText, isOutOfCredits } from './errors'
import { boundHistory, chatTools, HISTORY_CHAR_BUDGET, TOOL_RESULT_CAP } from './bounds'
import { buildTripPrompt, PROMPT_STOP_LIMIT } from './prompt'
import { planReply, readTripFacts } from './test-model'
import { nominatimUrl, placesFromNominatim, placesFromSerpApi } from '../server/places'
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

  it('lists at most 40 stops and points to get_trip for the rest', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      recordId: `stop_${i}`,
      data: { tripId: 'trip_1', day: '2026-12-01', position: i, title: 'x'.repeat(120) } as Stop,
    }))
    const big = buildTripPrompt({ tripId: 'trip_1', trip, stops: many, userName: 'Blair' })
    expect(readTripFacts(big).stops).toHaveLength(PROMPT_STOP_LIMIT)
    expect(big).toContain('...and 260 more. Call get_trip to see them.')
    expect(big.length).toBeLessThan(10_000)
  })
})

describe('chat turn bounds', () => {
  const turn = (i: number, role: 'user' | 'assistant', size: number) => ({ id: `m${i}`, role, content: 'y'.repeat(size) })

  it('keeps the history under the budget, starting on a user turn, with the new message always kept', () => {
    const history = Array.from({ length: 40 }, (_, i) => turn(i, i % 2 ? 'assistant' : 'user', 1500))
    const kept = boundHistory([...history, turn(99, 'user', 2000)])
    const size = kept.reduce((sum, t) => sum + t.content.length, 0)
    expect(size).toBeLessThanOrEqual(HISTORY_CHAR_BUDGET)
    expect(kept[0].role).toBe('user')
    expect(kept.at(-1)?.id).toBe('m99')
  })

  it('drops an oversized or system row from history', () => {
    const kept = boundHistory([
      { id: 's', role: 'system', content: 'z'.repeat(50_000) },
      turn(1, 'user', 100),
      turn(2, 'assistant', 90_000),
      turn(3, 'user', 100),
    ])
    expect(kept.map((t) => t.id)).toEqual(['m3'])
  })

  it('gives the chat only the trip tools, with capped results', async () => {
    const tools = chatTools({
      get_trip: { inputSchema: {} as never, execute: async () => ({ stops: Array.from({ length: 500 }, (_, i) => ({ i, title: 'stop title' })) }) },
      records_query: { inputSchema: {} as never, execute: async () => ({}) },
    } as never)
    expect(Object.keys(tools)).toEqual(['get_trip'])
    const out = await (tools.get_trip.execute as (i: unknown, o: unknown) => Promise<unknown>)({}, {})
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(TOOL_RESULT_CAP)
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

describe('OpenStreetMap places', () => {
  it('reads Nominatim jsonv2 rows', () => {
    expect(
      placesFromNominatim([
        { name: 'Museu Nacional do Azulejo', display_name: 'Museu Nacional do Azulejo, Rua da Madre de Deus, Xabregas, Lisboa, 1900-312, Portugal', type: 'museum', lat: '38.7247', lon: '-9.1136' },
        { name: '', display_name: 'Avenida Sacadura Cabral, Areeiro, Lisboa', type: 'bakery', lat: '38.74', lon: '-9.14' },
        { name: 'Arco da Rua Augusta', display_name: 'Arco da Rua Augusta, Baixa, Lisboa', type: 'yes', lat: 'x', lon: '1' },
        { display_name: '' },
      ]),
    ).toEqual([
      { name: 'Museu Nacional do Azulejo', address: 'Rua da Madre de Deus, Xabregas, Lisboa, 1900-312', type: 'museum', lat: 38.7247, lon: -9.1136 },
      { name: 'Arco da Rua Augusta', address: 'Baixa, Lisboa' },
    ])
    expect(placesFromNominatim({ error: 'x' })).toEqual([])
  })

  it('searches by destination name when the trip has no coordinates', () => {
    const url = nominatimUrl({ tripId: 't', query: 'museum', destination: 'Porto, Portugal' })
    expect(url.searchParams.get('q')).toBe('museum, Porto, Portugal')
    expect(url.searchParams.has('viewbox')).toBe(false)
  })
})
