import { describe, expect, it } from 'vitest'
import { locateQueries, placeMatches } from './places'

describe('locating a stop from its title', () => {
  it('tries the title, then the place after "at", "to", "near" or "in"', () => {
    expect(locateQueries('Lunch at Time Out Market')).toEqual(['Lunch at Time Out Market', 'Time Out Market'])
    expect(locateQueries('Tram 28 to Alfama')).toEqual(['Tram 28 to Alfama', 'Alfama'])
    expect(locateQueries('Louvre')).toEqual(['Louvre'])
  })

  it('skips titles with no place in them', () => {
    expect(locateQueries('Dinner')).toEqual([])
    expect(locateQueries('Lunch')).toEqual([])
    expect(locateQueries('  ')).toEqual([])
  })

  it('accepts a result only when it shares a real word with the query', () => {
    expect(placeMatches('Musée du Louvre', 'Louvre')).toBe(true)
    expect(placeMatches('Mercado da Ribeira', 'Time Out Market')).toBe(false)
    expect(placeMatches('Time Out Market Lisboa', 'Time Out Market')).toBe(true)
    expect(placeMatches('Miradouro de Santa Luzia', 'Sunset at Miradouro da Senhora do Monte')).toBe(false)
    expect(placeMatches('Miradouro da Senhora do Monte', 'Sunset at Miradouro da Senhora do Monte')).toBe(true)
  })
})
