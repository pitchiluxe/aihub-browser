// src/shared/fares/rank.test.ts
import { describe, it, expect } from 'vitest'
import { mergeOffers, rankRows } from './rank'
import { estimatedBagFee } from './bagFees'
import type { FareOffer } from './types'

const offer = (over: Partial<FareOffer>): FareOffer => ({
  source: 'google', price: 200, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [],
  departTime: '07:05', arriveTime: '09:10', arriveDayOffset: 0, durationMin: 305,
  bags: { carry: 1, checked: 0 }, bookUrl: 'https://g.example', ret: null, ...over,
})

describe('mergeOffers', () => {
  it('merges the same outbound flight seen on several sites into one row', () => {
    const rows = mergeOffers([
      offer({ source: 'google', price: 178 }),
      offer({ source: 'kayak', price: 178, bookUrl: 'https://k.example' }),
      offer({ source: 'momondo', price: 181, bookUrl: 'https://m.example' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].best).toBe(178)
    expect(rows[0].prices.map(p => p.source)).toEqual(['google', 'kayak', 'momondo'])
    expect(rows[0].agreement).toBe(3)
  })

  it('keeps each site\'s cheapest price for an outbound (Kayak lists several returns)', () => {
    const rows = mergeOffers([offer({ source: 'kayak', price: 160 }), offer({ source: 'kayak', price: 150 })])
    expect(rows[0].prices).toHaveLength(1)
    expect(rows[0].prices[0].price).toBe(150)
  })

  it('flags a price far above the others as verify-on-site', () => {
    const rows = mergeOffers([offer({ source: 'google', price: 150 }), offer({ source: 'kayak', price: 240 })])
    expect(rows[0].prices.find(p => p.source === 'kayak')!.verify).toBe(true)
    expect(rows[0].agreement).toBe(1)
  })

  it('matches overnight flights across sites and keeps different days apart', () => {
    const rows = mergeOffers([
      offer({ source: 'google', departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1 }),
      offer({ source: 'kayak', departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1 }),
      offer({ source: 'kayak', departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 0 }),
    ])
    expect(rows).toHaveLength(2)
  })
})

describe('rankRows', () => {
  const cheapNoBags = offer({ airlines: ['Frontier'], price: 162, bags: { carry: 0, checked: 0 }, stops: 1, durationMin: 527, departTime: '10:29' })
  const deltaNonstop = offer({ airlines: ['Delta'], price: 190, bags: { carry: 1, checked: 0 }, departTime: '07:05' })

  it('adds bag fees the traveller would actually pay to the true total', () => {
    const [row] = rankRows(mergeOffers([cheapNoBags]), 'cheapest', { carry: true, checked: false }, 1)
    expect(row.bagFee).toBe(estimatedBagFee('Frontier', 'carry'))
    expect(row.trueTotal).toBe(162 + row.bagFee)
  })

  it('multiplies bag fees by travellers', () => {
    const [row] = rankRows(mergeOffers([cheapNoBags]), 'cheapest', { carry: true, checked: true }, 2)
    expect(row.bagFee).toBe((estimatedBagFee('Frontier', 'carry') + estimatedBagFee('Frontier', 'checked')) * 2)
  })

  it('sorts cheapest by true total, not the teaser price', () => {
    const rows = rankRows(mergeOffers([cheapNoBags, deltaNonstop]), 'cheapest', { carry: true, checked: false }, 1)
    expect(rows[0].offer.airlines[0]).toBe('Delta')
  })

  it('sorts fastest and fewest stops', () => {
    const rows = mergeOffers([cheapNoBags, deltaNonstop])
    expect(rankRows(rows, 'fastest', { carry: false, checked: false }, 1)[0].offer.airlines[0]).toBe('Delta')
    expect(rankRows(rows, 'stops', { carry: false, checked: false }, 1)[0].offer.stops).toBe(0)
  })

  it('filters to nonstop', () => {
    const rows = rankRows(mergeOffers([cheapNoBags, deltaNonstop]), 'best', { carry: false, checked: false }, 1, { nonstop: true })
    expect(rows.every(r => r.offer.stops === 0)).toBe(true)
  })
})

describe('estimatedBagFee', () => {
  it('knows low-cost carriers charge for carry-ons and legacy ones do not', () => {
    expect(estimatedBagFee('Frontier', 'carry')).toBeGreaterThan(0)
    expect(estimatedBagFee('Delta', 'carry')).toBe(0)
    expect(estimatedBagFee('Unknown Air', 'checked')).toBeGreaterThan(0)
  })
})
