import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/incognitoMode', () => ({ IS_INCOGNITO: false }))

import { buildProfile, classifyListen, decay, describeTaste, eventWeight, type TasteEvent } from './taste'

const NOW = new Date('2026-10-06T20:00:00').getTime()
const play = (artist: string, title: string, outcome: TasteEvent['outcome'], extra: Partial<TasteEvent> = {}): TasteEvent =>
  ({ kind: 'play', at: NOW - 3600_000, artist, title, outcome, listened: 180, duration: 200, ...extra })

describe('classifyListen', () => {
  it('counts a song heard to the end as played out', () => {
    expect(classifyListen(30, 200, true)).toBe('complete')
    expect(classifyListen(150, 200, false)).toBe('complete')
    expect(classifyListen(175, 200, false)).toBe('complete') // under 30 s left
  })
  it('counts an early drop as a skip, but not a two-second blip', () => {
    expect(classifyListen(20, 200, false)).toBe('skip')
    expect(classifyListen(2, 200, false)).toBe('sample')
    expect(classifyListen(100, 200, false)).toBe('sample')
  })
})

describe('decay', () => {
  it('halves every 30 days', () => {
    expect(decay(NOW, NOW)).toBe(1)
    expect(decay(NOW - 30 * 86_400_000, NOW)).toBeCloseTo(0.5)
  })
})

describe('eventWeight', () => {
  it('likes beat plays, skips and dislikes are negative', () => {
    expect(eventWeight({ kind: 'like', at: 0 })).toBeGreaterThan(eventWeight(play('a', 'b', 'complete')))
    expect(eventWeight(play('a', 'b', 'skip'))).toBeLessThan(0)
    expect(eventWeight({ kind: 'dislike', at: 0 })).toBeLessThan(0)
    expect(eventWeight({ kind: 'search', at: 0, query: 'x' })).toBe(0)
  })
  it('discounts the AI DJ\'s own picks', () => {
    expect(eventWeight(play('a', 'b', 'complete', { auto: true }))).toBeLessThan(eventWeight(play('a', 'b', 'complete')))
  })
})

describe('buildProfile', () => {
  const events: TasteEvent[] = [
    play('Fally Ipupa', 'Eloko Oyo', 'complete'),
    play('Fally Ipupa', 'Science-Fiction', 'complete'),
    play('fally ipupa', 'Eloko Oyo', 'complete'),
    { kind: 'like', at: NOW - 1000, artist: 'Koffi Olomide', title: 'Loi' },
    play('Noise Band', 'Track', 'skip'),
    play('Noise Band', 'Track 2', 'skip'),
    { kind: 'dislike', at: NOW - 1000, artist: 'Noise Band', title: 'Track 3' },
    { kind: 'search', at: NOW - 5000, query: 'ndombolo mix' },
    { kind: 'search', at: NOW - 4000, query: 'Ndombolo Mix' },
  ]
  const p = buildProfile(events, NOW)

  it('ranks loved artists and merges case variants', () => {
    expect(p.topArtists[0].artist).toBe('Fally Ipupa')
    expect(p.topArtists.map(a => a.artist)).toContain('Koffi Olomide')
  })
  it('lists artists to avoid', () => {
    expect(p.avoidArtists).toEqual(['Noise Band'])
    expect(p.topArtists.map(a => a.artist)).not.toContain('Noise Band')
  })
  it('keeps searches newest first without duplicates', () => {
    expect(p.recentSearches).toEqual(['Ndombolo Mix'])
  })
  it('counts listening stats', () => {
    expect(p.stats.plays).toBe(5)
    expect(p.stats.skips).toBe(2)
    expect(p.stats.completes).toBe(3)
  })
  it('remembers what is played at this time of day', () => {
    expect(p.nowArtists[0]).toBe('Fally Ipupa')
  })
  it('describes the taste for the AI and says what to avoid', () => {
    const text = describeTaste(p, new Date(NOW))
    expect(text).toContain('Fally Ipupa')
    expect(text).toMatch(/do not pick these/)
    expect(describeTaste(buildProfile([], NOW))).toBe('')
  })
})
