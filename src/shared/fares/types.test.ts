// src/shared/fares/types.test.ts
import { describe, it, expect } from 'vitest'
import { to24h, parseDuration, splitAirlines, parseMoney, normalizeOffer, offerKey, type FareOffer } from './types'

const base: FareOffer = {
  source: 'google', price: 152, currency: 'USD', airlines: ['Frontier'], stops: 1, layovers: ['Las Vegas'],
  departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1, durationMin: 887,
  bags: { carry: 0, checked: 0 }, bookUrl: 'https://www.google.com/travel/flights', ret: null,
}

describe('to24h', () => {
  it('handles AM/PM in both cases and spacing', () => {
    expect(to24h('10:29 AM')).toBe('10:29')
    expect(to24h('9:32 pm')).toBe('21:32')
    expect(to24h('12:26 am')).toBe('00:26')
    expect(to24h('12:19 PM')).toBe('12:19')
    expect(to24h('25:00 PM')).toBeNull()
  })
})

describe('parseDuration', () => {
  it('reads Google and Kayak formats', () => {
    expect(parseDuration('8 hr 47 min')).toBe(527)
    expect(parseDuration('5 hr')).toBe(300)
    expect(parseDuration('14h 47m')).toBe(887)
    expect(parseDuration('45 min')).toBe(45)
    expect(parseDuration('soon')).toBeNull()
  })
})

describe('splitAirlines', () => {
  it('splits multi-carrier itineraries', () => {
    expect(splitAirlines('Delta and Alaska')).toEqual(['Delta', 'Alaska'])
    expect(splitAirlines('Delta, Alaska')).toEqual(['Delta', 'Alaska'])
    expect(splitAirlines('Frontier')).toEqual(['Frontier'])
  })
})

describe('parseMoney', () => {
  it('keeps thousands separators intact', () => {
    expect(parseMoney('$1,204')).toBe(1204)
    expect(parseMoney('1,204')).toBe(1204)
    expect(parseMoney('€ 89')).toBe(89)
    expect(parseMoney('free')).toBeNull()
  })
})

describe('normalizeOffer', () => {
  it('accepts a sane offer', () => { expect(normalizeOffer(base)).toEqual(base) })
  it('rejects junk prices, times and airlines', () => {
    expect(normalizeOffer({ ...base, price: 12 })).toBeNull()
    expect(normalizeOffer({ ...base, price: 60_000 })).toBeNull()
    expect(normalizeOffer({ ...base, airlines: [] })).toBeNull()
    expect(normalizeOffer({ ...base, departTime: 'x' })).toBeNull()
    expect(normalizeOffer({ ...base, durationMin: 0 })).toBeNull()
  })
})

describe('offerKey', () => {
  it('matches the same flight across sites regardless of case', () => {
    expect(offerKey(base)).toBe(offerKey({ ...base, airlines: ['frontier'] }))
    expect(offerKey(base)).not.toBe(offerKey({ ...base, arriveDayOffset: 0 }))
  })
})
