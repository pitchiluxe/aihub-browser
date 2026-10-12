import { describe, it, expect } from 'vitest'
import { buildPickPrompt, parsePick, fetchAiPick } from './aiPick'
import { mergeOffers, rankRows } from '../../../../../shared/fares/rank'
import type { FareOffer } from '../../../../../shared/fares/types'

const o = (over: Partial<FareOffer>): FareOffer => ({ source: 'google', price: 178, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [], departTime: '07:05', arriveTime: '09:10', arriveDayOffset: 0, durationMin: 305, bags: { carry: 1, checked: 0 }, bookUrl: 'https://x.example', ret: null, ...over })
const rows = rankRows(mergeOffers([o({}), o({ airlines: ['Frontier'], price: 152, stops: 1, durationMin: 887, departTime: '21:32', bags: { carry: 0, checked: 0 } })]), 'best', { carry: true, checked: false }, 1)

describe('buildPickPrompt', () => {
  it('sends normalized fields only, keyed by row id', () => {
    const msgs = buildPickPrompt(rows, { adults: 1, needs: { carry: true, checked: false } })
    const text = msgs.map(m => m.content).join('\n')
    expect(text).toContain(rows[0].key)
    expect(text).not.toContain('https://')
  })
})

describe('parsePick', () => {
  it('accepts a reply naming a real row', () => {
    const reply = JSON.stringify({ key: rows[1].key, reason: 'Nonstop, carry-on included.' })
    expect(parsePick(`Sure!\n${reply}`, rows)).toEqual({ key: rows[1].key, reason: 'Nonstop, carry-on included.' })
  })
  it('discards a pick for a row that does not exist', () => {
    expect(parsePick(JSON.stringify({ key: 'made|up|key|0', reason: 'x' }), rows)).toBeNull()
  })
  it('discards non-JSON replies', () => {
    expect(parsePick('I recommend Delta.', rows)).toBeNull()
  })
})

describe('fetchAiPick', () => {
  it('returns null when the AI provider failed', async () => {
    expect(await fetchAiPick(rows, { adults: 1, needs: { carry: true, checked: false } }, async () => ({ provider: 'none', content: 'AI providers are currently unavailable.' }))).toBeNull()
  })
})
