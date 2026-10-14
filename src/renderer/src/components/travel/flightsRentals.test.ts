import { describe, it, expect, vi } from 'vitest'
import { validateTrip, bookingSearches, chooseBookingSearch, researchTrip, researchQueries, readSavedTrips, type Trip } from './flightsRentals'
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
  it('searches with short keyword queries and merges both result lists', async () => {
    const webSearch = vi.fn()
      .mockResolvedValueOnce({ success: true, results: [{ title: 'A1', url: 'https://a.com/1', snippet: '' }, { title: 'A2', url: 'https://a.com/2', snippet: '' }] })
      .mockResolvedValueOnce({ success: true, results: [{ title: 'dup', url: 'https://a.com/1', snippet: '' }, { title: 'B2', url: 'https://b.com/2', snippet: '' }] })
    const result = await researchTrip(trip, { webSearch, chat: vi.fn().mockResolvedValue({ provider: 'ollama', content: 'ok' }) })
    expect(result.sources.map(s => s.title)).toEqual(['A1', 'A2', 'B2'])
    for (const [q] of webSearch.mock.calls) { expect(q.length).toBeLessThan(90); expect(q).not.toContain('adults') }
    expect(researchQueries({ ...trip, kind: 'stays', destination: 'Lisbon' })[0]).toMatch(/^cheap hotels Lisbon \w+ \d{4} deals$/)
  })
  it('streams the brief as it is written and keeps the prompt short', async () => {
    const long = 'x'.repeat(2000)
    const webSearch = vi.fn().mockResolvedValue({ success: true, results: [{ title: 'A', url: 'https://a.com/', snippet: long }] })
    const stream = vi.fn(async (_m: any[], onPartial: (t: string) => void) => { onPartial('## Best'); onPartial('## Best options'); return { provider: 'ollama', content: '## Best options\n\nDone.' } })
    const drafts: string[] = []
    const result = await researchTrip(trip, { webSearch, chat: vi.fn(), stream }, d => drafts.push(d.text))
    expect(drafts).toEqual(['## Best', '## Best options'])
    expect(result.text).toBe('## Best options\n\nDone.')
    const prompt = stream.mock.calls[0][0][1].content
    expect(prompt).toContain('x'.repeat(400))
    expect(prompt).not.toContain('x'.repeat(401))
    expect(stream.mock.calls[0][0][0].content).toContain('under 300 words')
  })
  it('still researches when one of the two searches fails', async () => {
    const webSearch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true, results: [{ title: 'B', url: 'https://b.com/', snippet: '' }] })
    const result = await researchTrip(trip, { webSearch, chat: vi.fn().mockResolvedValue({ provider: 'ollama', content: 'ok' }) })
    expect(result.sources).toHaveLength(1)
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
    expect(readSavedTrips(JSON.stringify([{ id: 'a', trip }]))[0].estimate.lines.every(line => line.amount === '')).toBe(true)
  })
  it('restores saved cost estimates and replaces malformed estimate data with unknown entries', () => {
    const valid = readSavedTrips(JSON.stringify([{ id: 'a', trip, estimate: { updatedAt: '2026-10-09T12:00:00Z', currency: 'EUR', lines: [{ id: 'flights', amount: '120.00' }, ...Array.from(['baggage', 'hotel', 'hotelFees', 'transfers', 'rental', 'rentalInsurance'], id => ({ id, amount: '' }))] } }]))[0]
    expect(valid.estimate.currency).toBe('EUR')
    expect(valid.estimate.lines[0].amount).toBe('120.00')
    const recovered = readSavedTrips(JSON.stringify([{ id: 'b', trip, estimate: { currency: 'FAKE' } }]))[0]
    expect(recovered.estimate.lines.every(line => line.amount === '')).toBe(true)
  })
})
