import { describe, it, expect } from 'vitest'
import { AIRPORTS, searchAirports, resolveAirport, airportLabel } from './airports'
describe('airport directory', () => {
  it('maps ICAO to the ticketing IATA code worldwide', () => {
    for (const [icao, iata] of [['KJFK', 'JFK'], ['EGLL', 'LHR'], ['LFPG', 'CDG'], ['HKJK', 'NBO'], ['OMDB', 'DXB'], ['RJTT', 'HND']]) {
      const airport = searchAirports(icao)[0]
      expect(airport.icao).toBe(icao); expect(airport.iata).toBe(iata)
      expect(resolveAirport(airportLabel(airport))?.iata).toBe(iata)
    }
    expect(AIRPORTS.length).toBeGreaterThan(5000)
    expect(new Set(AIRPORTS.map(a => a.iata)).size).toBe(AIRPORTS.length)
  })
  it('finds airport names and cities, supports partial codes, and limits results', () => {
    expect(searchAirports('heathrow')[0].iata).toBe('LHR')
    expect(searchAirports('New York').some(a => a.iata === 'JFK')).toBe(true)
    expect(searchAirports('KJF')[0].iata).toBe('JFK')
    expect(searchAirports('Paris', 2).length).toBe(2)
    expect(searchAirports('')).toEqual([])
    expect(resolveAirport('Paris')).toBeNull()
    expect(resolveAirport('XXXX')).toBeNull()
  })
})
