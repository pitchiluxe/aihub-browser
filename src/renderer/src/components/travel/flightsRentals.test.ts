import { describe, it, expect, vi } from 'vitest'
import { validateTrip, bookingSearches, chooseBookingSearch, researchTrip, readSavedTrips, type Trip } from './flightsRentals'
const trip: Trip = { kind: 'flights', origin: 'JFK', destination: 'CDG', start: '2099-06-10', end: '2099-06-17', travelers: 2, budget: '1500', currency: 'USD', flexible: true }
describe('trip planning', () => {
  it('randomly chooses a direct booking site for every category without repeating the previous site', () => {
    for (const kind of ['flights', 'cars', 'stays'] as const) {
      const t = { ...trip, kind }
      const links = bookingSearches(t)
      expect(links.length).toBeGreaterThanOrEqual(2)
      expect(links.every(l => !l.url.includes('google.com/search'))).toBe(true)
      expect(chooseBookingSearch(t, undefined, () => 0)).toEqual(links[0])
      expect(chooseBookingSearch(t, links[0].name, () => 0).name).not.toBe(links[0].name)
      expect(chooseBookingSearch(t, undefined, () => 0.999).name).toBe(links.at(-1)!.name)
    }
  })
  it('prefills car and hotel sites and requests lowest-price sorting', () => {
    for (const kind of ['cars', 'stays'] as const) {
      const links = bookingSearches({ ...trip, kind, destination: kind === 'cars' ? 'KJFK' : 'Paris' })
      for (const link of links) {
        const url = new URL(link.url)
        expect(url.searchParams.get('order') || url.searchParams.get('sort')).toMatch(/price/)
        expect(decodeURIComponent(link.url)).toContain(trip.start)
        expect(decodeURIComponent(link.url)).toContain(trip.end)
        if (kind === 'cars') expect(url.pathname).toContain('/cars/JFK/')
        else if (link.name !== 'Booking.com') expect(url.pathname).toContain('/2adults')
      }
    }
  })
  it('rejects invalid dates, reversed dates, missing origins and invalid travelers', () => {
    for (const change of [{ start: '2099-02-30' }, { end: '2099-01-01' }, { origin: '' }, { travelers: 0 }, { travelers: 1.5 }, { budget: '-4' }]) expect(validateTrip({ ...trip, ...change })).not.toBeNull()
    expect(validateTrip(trip)).toBeNull()
    expect(validateTrip({ ...trip, kind: 'stays', origin: '' })).toBeNull()
  })
  it('carries dates and travelers to stays and encodes destination text safely', () => {
    const links = bookingSearches({ ...trip, kind: 'stays', destination: 'Paris & Nice' })
    const url = new URL(links[0].url)
    expect(url.searchParams.get('ss')).toBe('Paris & Nice')
    expect(url.searchParams.get('checkin')).toBe(trip.start)
    expect(url.searchParams.get('group_adults')).toBe('2')
    expect(links.every(l => l.url.startsWith('https://'))).toBe(true)
  })
  it('retains dates and locations in flight and car searches', () => {
    for (const kind of ['flights', 'cars'] as const) {
      const urls = bookingSearches({ ...trip, kind }).map(l => decodeURIComponent(l.url.replace(/\+/g, ' '))).join(' ')
      expect(urls).toContain('CDG'); expect(urls).toContain(trip.start); expect(urls).toContain(trip.end)
    }
  })
  it('prefills flight provider forms with IATA codes, exact dates, adults and currency', () => {
    const links = bookingSearches({ ...trip, origin: 'KJFK', destination: 'LFPG' })
    const kayak = new URL(links.find(l => l.name === 'Kayak')!.url)
    expect(kayak.pathname).toBe('/flights/JFK-CDG/2099-06-10/2099-06-17/2adults')
    expect(kayak.searchParams.get('currency')).toBe('USD')
    const sky = new URL(links.find(l => l.name === 'Skyscanner')!.url)
    expect(sky.pathname).toBe('/transport/flights/jfk/cdg/990610/990617/')
    expect(sky.searchParams.get('adults')).toBe('2')
  })
  it('refuses ambiguous flight cities instead of opening unfilled searches', () => {
    expect(validateTrip({ ...trip, origin: 'New York' })).toContain('departure airport')
    expect(validateTrip({ ...trip, destination: 'Paris' })).toContain('destination airport')
    expect(validateTrip({ ...trip, origin: 'LFPG' })).toContain('different airports')
  })
  it('filters unsafe sources and grounds AI on the returned evidence', async () => {
    const chat = vi.fn().mockResolvedValue({ provider: 'ollama', content: 'Compare baggage fees.' })
    const result = await researchTrip(trip, { webSearch: vi.fn().mockResolvedValue({ success: true, results: [{ title: 'Fare advice', url: 'https://example.com', snippet: 'Baggage costs extra.' }, { title: 'Bad', url: 'javascript:alert(1)', snippet: '' }] }), chat })
    expect(result.sources).toHaveLength(1)
    expect(chat.mock.calls[0][0][0].content).toContain('Never invent prices')
    expect(chat.mock.calls[0][0][1].content).toContain('Baggage costs extra.')
  })
  it('does not request AI advice without evidence and reports model failures', async () => {
    const chat = vi.fn()
    await expect(researchTrip(trip, { webSearch: vi.fn().mockResolvedValue({ success: false }), chat })).rejects.toThrow('sources')
    expect(chat).not.toHaveBeenCalled()
    await expect(researchTrip(trip, { webSearch: vi.fn().mockResolvedValue({ success: true, results: [{ url: 'https://example.com', title: 'Source', snippet: '' }] }), chat: vi.fn().mockResolvedValue({ provider: 'error', content: 'failure' }) })).rejects.toThrow('AI')
  })
  it('survives corrupt storage and discards invalid saved trips', () => {
    expect(readSavedTrips('oops')).toEqual([])
    expect(readSavedTrips(JSON.stringify([{ id: 'a', trip }, { id: 'b', trip: {} }]))).toHaveLength(1)
  })
})
