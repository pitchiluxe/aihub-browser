import { describe, it, expect } from 'vitest'
import fixture from '../__fixtures__/atl-lax.json'
import { googleAdapter, parseGoogleLabel } from './google'
import type { FareQuery } from '../../../shared/fares/types'

const q: FareQuery = { from: 'ATL', to: 'LAX', depart: '2026-11-10', ret: '2026-11-17', adults: 1, currency: 'USD' }
const URL0 = googleAdapter.url(q)

describe('googleAdapter.url', () => {
  it('builds a search for the route, dates and currency', () => {
    expect(URL0).toContain('google.com/travel/flights')
    expect(decodeURIComponent(URL0)).toContain('from ATL to LAX on 2026-11-10 through 2026-11-17')
    expect(URL0).toContain('curr=USD')
  })
})

describe('parseGoogleLabel', () => {
  it('reads a one-stop label fully', () => {
    const o = parseGoogleLabel(fixture.google.labels[0], URL0)!
    expect(o).toMatchObject({
      source: 'google', price: 162, currency: 'USD', airlines: ['Frontier'], stops: 1,
      layovers: ['Las Vegas'], departTime: '10:29', arriveTime: '16:16', arriveDayOffset: 0,
      durationMin: 527, bags: { carry: 0, checked: 0 }, ret: null,
    })
  })

  it('reads nonstop with an hours-only duration', () => {
    const o = parseGoogleLabel(fixture.google.labels[1], URL0)!
    expect(o.stops).toBe(0)
    expect(o.durationMin).toBe(300)
    expect(o.layovers).toEqual([])
  })

  it('detects overnight arrival', () => {
    const o = parseGoogleLabel(fixture.google.labels[3], URL0)!
    expect(o.arriveDayOffset).toBe(1)
    expect(o.departTime).toBe('21:32')
    expect(o.arriveTime).toBe('09:19')
  })

  it('handles thousands separators and multi-carrier itineraries', () => {
    const label = fixture.google.labels[1].replace('From 178 US dollars', 'From 1,204 US dollars').replace('flight with Frontier', 'flight with Delta and Alaska')
    const o = parseGoogleLabel(label, URL0)!
    expect(o.price).toBe(1204)
    expect(o.airlines).toEqual(['Delta', 'Alaska'])
  })

  it('returns null for unrelated aria-labels', () => {
    expect(parseGoogleLabel('Select flight', URL0)).toBeNull()
  })
})

describe('googleAdapter.parse', () => {
  it('parses every fixture label', () => {
    const offers = googleAdapter.parse({ labels: fixture.google.labels }, q)
    expect(offers).toHaveLength(6)
    expect(Math.min(...offers.map(o => o.price))).toBe(152)
  })

  it('dedupes repeated labels (Google renders each offer twice)', () => {
    const labels = [...fixture.google.labels, ...fixture.google.labels]
    expect(googleAdapter.parse({ labels }, q)).toHaveLength(6)
  })
})
