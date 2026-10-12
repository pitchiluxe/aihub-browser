import { describe, it, expect } from 'vitest'
import { reduceProgress, initialFareState, type SiteProgress, type FareSearchState } from './useFareSearch'
import type { FareOffer } from '../../../../../shared/fares/types'

const o = (price: number, source: any): FareOffer => ({ source, price, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [], departTime: '07:05', arriveTime: '09:10', arriveDayOffset: 0, durationMin: 305, bags: null, bookUrl: 'https://x.example', ret: null })
const p = (over: Partial<SiteProgress>): SiteProgress => ({ searchId: 's1', site: 'google', label: 'Google Flights', status: 'loading', offers: [], url: 'https://g', at: 1, ...over })

describe('reduceProgress', () => {
  it('adds offers as sites finish and marks done when every site is final', () => {
    let s: FareSearchState = { ...initialFareState(), phase: 'searching' }
    s = reduceProgress(s, p({ status: 'loading' }), 's1')
    s = reduceProgress(s, p({ site: 'kayak', label: 'Kayak', status: 'loading' }), 's1')
    s = reduceProgress(s, p({ status: 'done', offers: [o(150, 'google')] }), 's1')
    expect(s.phase).toBe('searching')
    expect(s.offers).toHaveLength(1)
    s = reduceProgress(s, p({ site: 'kayak', label: 'Kayak', status: 'blocked' }), 's1')
    expect(s.phase).toBe('done')
    expect(s.sites.find(x => x.site === 'kayak')!.status).toBe('blocked')
  })

  it('stays searching when a cached site reports before the others have said loading', () => {
    let s: FareSearchState = { ...initialFareState(), phase: 'searching' }
    s = reduceProgress(s, p({ status: 'cached', offers: [o(150, 'google')], total: 3 }), 's1')
    expect(s.phase).toBe('searching')
    s = reduceProgress(s, p({ site: 'kayak', label: 'Kayak', status: 'done', offers: [], total: 3 }), 's1')
    s = reduceProgress(s, p({ site: 'momondo', label: 'Momondo', status: 'blocked', offers: [], total: 3 }), 's1')
    expect(s.phase).toBe('done')
  })

  it('ignores events from a stale search (form edited mid-search)', () => {
    const s0 = { ...initialFareState(), phase: 'searching' as const }
    const s1 = reduceProgress(s0, p({ searchId: 'old', status: 'done', offers: [o(99, 'google')] }), 's2')
    expect(s1).toBe(s0)
  })

  it('replaces a site\'s offers rather than duplicating them on a repeat event', () => {
    let s: FareSearchState = { ...initialFareState(), phase: 'searching' }
    s = reduceProgress(s, p({ status: 'done', offers: [o(150, 'google')] }), 's1')
    s = reduceProgress(s, p({ status: 'done', offers: [o(149, 'google')] }), 's1')
    expect(s.offers.map(x => x.price)).toEqual([149])
  })
})
