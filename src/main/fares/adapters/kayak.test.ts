import { describe, it, expect } from 'vitest'
import fixture from '../__fixtures__/atl-lax.json'
import { kayakAdapter, momondoAdapter, parseKayakCard } from './kayak'
import { FARE_ADAPTERS, handoffLinks } from './index'
import type { FareQuery } from '../../../shared/fares/types'

const q: FareQuery = { from: 'ATL', to: 'LAX', depart: '2026-11-10', ret: '2026-11-17', adults: 1, currency: 'USD' }

describe('kayakAdapter.url', () => {
  it('requests the route sorted by price', () => {
    expect(kayakAdapter.url(q)).toBe('https://www.kayak.com/flights/ATL-LAX/2026-11-10/2026-11-17?sort=price_a&currency=USD')
    expect(momondoAdapter.url(q)).toContain('https://www.momondo.com/flight-search/ATL-LAX/2026-11-10/2026-11-17')
  })
  it('adds adults when more than one', () => {
    expect(kayakAdapter.url({ ...q, adults: 2 })).toContain('/2026-11-17/2adults?')
  })
})

describe('parseKayakCard', () => {
  it('reads outbound, return, bags, price and deep link', () => {
    const o = parseKayakCard(fixture.kayak.cards[0], 'https://www.kayak.com', kayakAdapter.url(q), 'kayak')!
    expect(o).toMatchObject({
      source: 'kayak', price: 150, airlines: ['Frontier'], stops: 1, layovers: ['LAS'],
      departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1, durationMin: 887,
      bags: { carry: 0, checked: 0 }, bookUrl: 'https://www.kayak.com/book/flight?code=FIXTURE1',
    })
    expect(o.ret).toMatchObject({ departTime: '13:20', arriveTime: '20:59', stops: 0, durationMin: 279, airlines: ['Frontier'] })
  })

  it('falls back to the search URL when a card has no link', () => {
    const o = parseKayakCard(fixture.kayak.cards[2], 'https://www.kayak.com', 'https://www.kayak.com/flights/X', 'kayak')!
    expect(o.bookUrl).toBe('https://www.kayak.com/flights/X')
  })

  it('reports unknown bags when the counts are missing (Momondo)', () => {
    const o = parseKayakCard(fixture.momondo.cards[0], 'https://www.momondo.com', momondoAdapter.url(q), 'momondo')!
    expect(o.price).toBe(145)
    expect(o.bags).toBeNull()
  })

  it('keeps thousands separators', () => {
    const card = { ...fixture.kayak.cards[0], text: fixture.kayak.cards[0].text.replace('$150', '$1,204') }
    expect(parseKayakCard(card, 'https://www.kayak.com', 'https://www.kayak.com', 'kayak')!.price).toBe(1204)
  })

  it('splits multi-carrier itineraries', () => {
    const card = { ...fixture.kayak.cards[0], text: fixture.kayak.cards[0].text.replace('am+1\nFrontier', 'am+1\nDelta, Alaska') }
    expect(parseKayakCard(card, 'https://www.kayak.com', 'https://www.kayak.com', 'kayak')!.airlines).toEqual(['Delta', 'Alaska'])
  })

  it('rejects the filter sidebar and other non-result blocks', () => {
    expect(parseKayakCard({ text: 'Stops\nNonstop\n$175\n1 stop\n$183', href: null }, 'https://www.kayak.com', 'https://www.kayak.com', 'kayak')).toBeNull()
  })
})

describe('adapter registry', () => {
  it('lists the live sources in priority order', () => {
    expect(FARE_ADAPTERS.map(a => a.id)).toEqual(['google', 'kayak', 'momondo'])
  })
  it('keeps Expedia and Skyscanner as hand-off links', () => {
    expect(handoffLinks(q).map(l => l.name)).toEqual(['Expedia', 'Skyscanner'])
  })
  it('parses every Kayak fixture card', () => {
    expect(kayakAdapter.parse(fixture.kayak, q)).toHaveLength(4)
  })
})

describe('review fixes', () => {
  it('allows the visible verify window for every live adapter URL, and nothing else', async () => {
    const { isFareSiteUrl } = await import('./index')
    const { googleAdapter } = await import('./google')
    for (const a of [googleAdapter, kayakAdapter, momondoAdapter]) expect(isFareSiteUrl(a.url(q))).toBe(true)
    expect(isFareSiteUrl('https://www.google.com/search?q=x')).toBe(false)
    expect(isFareSiteUrl('https://www.kayak.com.evil.example/flights')).toBe(false)
    expect(isFareSiteUrl('http://www.kayak.com/flights')).toBe(false)
  })

  it('counts four-digit prices with separators, so a broken layout reads as unreadable not empty', async () => {
    const { PRICE_COUNT_SOURCE, COMMON_PROBE } = await import('./types')
    const re = new RegExp(PRICE_COUNT_SOURCE, 'g')
    expect('Delta $1,204 · United $2,310 · €89'.match(re)).toHaveLength(3)
    expect(COMMON_PROBE).toContain(JSON.stringify(PRICE_COUNT_SOURCE))
  })
})
