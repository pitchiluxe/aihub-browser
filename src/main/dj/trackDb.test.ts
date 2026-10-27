import { describe, it, expect } from 'vitest'
import { compatibleKeys, keyRelation, mergeRecord, queryCandidates, tempoRatio, upsertRecords, type TrackRecord } from './trackDb'

let n = 0
const rec = (over: Partial<TrackRecord> = {}): TrackRecord => ({
  id: `file:C:/m/${++n}.mp3`, title: `Song ${n}`, artist: 'A', bpm: 124, camelot: '8A', energy: 0.6, density: 0.5,
  durationSec: 240, introEndSec: 8, outroStartSec: 210, seenAt: n, ...over,
})
const dbOf = (rs: TrackRecord[]) => Object.fromEntries(rs.map(r => [r.id, r]))

describe('harmonic rules', () => {
  it('lists standard moves and pivots around the wheel', () => {
    const k = Object.fromEntries(compatibleKeys('8A').map(x => [x.camelot, x.relation]))
    expect(k).toEqual({ '8A': 'perfect', '9A': 'adjacent', '7A': 'adjacent', '8B': 'relative', '9B': 'diagonal-up', '7B': 'diagonal-down', '10A': 'boost', '3A': 'semitone', '11B': 'parallel' })
    // Wraps 12 → 1, and C major (8B) has C minor (5A) as its parallel.
    expect(keyRelation('12B', '1B')).toBe('adjacent')
    expect(keyRelation('8B', '5A')).toBe('parallel')
    expect(keyRelation('8A', '2A')).toBeNull()
  })

  it('matches tempo within 6 %, half and double time included', () => {
    expect(tempoRatio(124, 128)).toBeCloseTo(128 / 124)
    expect(tempoRatio(124, 133)).toBeNull()
    expect(tempoRatio(174, 87)).toBe(1)
    expect(tempoRatio(87, 174)).toBe(1)
  })
})

describe('library records', () => {
  it('merges a later partial reading without losing what was known', () => {
    const a = mergeRecord(undefined, { id: 'yt:abcdefghijk', title: 'X', artist: 'Y', bpm: 120, camelot: '5B', genre: 'house' })!
    const b = mergeRecord(a, { id: 'yt:abcdefghijk', title: 'X', energy: 0.8, enrich: { rationale: 'Smooth.', cues: [{ label: 'Mix in', ms: 8000.4 }] } })!
    expect(b).toMatchObject({ bpm: 120, camelot: '5B', genre: 'house', energy: 0.8, youtubeId: 'abcdefghijk' })
    expect(b.enrich?.cues).toEqual([{ label: 'Mix in', ms: 8000 }])
  })

  it('rejects bad ids, bad keys and caps the store', () => {
    expect(mergeRecord(undefined, { id: 'http://x', title: 'x' })).toBeNull()
    expect(mergeRecord(undefined, { id: 'yt:abcdefghijk', title: 'x', camelot: '13A' })!.camelot).toBeNull()
    const { db } = upsertRecords({}, [rec(), rec(), rec()], 2)
    expect(Object.keys(db)).toHaveLength(2)
  })
})

describe('candidate query', () => {
  it('keeps tempo-and-key matches, ranked, and drops clashes', () => {
    const near = rec({ bpm: 125, camelot: '8A' })
    const pivot = rec({ bpm: 124, camelot: '9B' })
    const clash = rec({ bpm: 124, camelot: '2A' })
    const slow = rec({ bpm: 100, camelot: '8A' })
    const out = queryCandidates(dbOf([near, pivot, clash, slow]), { bpm: 124, camelot: '8A' })
    expect(out.map(c => c.record.id)).toEqual([near.id, pivot.id])
    expect(out[1].relation).toBe('diagonal-up')
    expect(queryCandidates(dbOf([near, pivot]), { bpm: 124, camelot: '8A', pivots: false }).map(c => c.record.id)).toEqual([near.id])
  })

  it('returns at most 15 and fills a thin pool with unknown keys', () => {
    const many = Array.from({ length: 30 }, () => rec({ camelot: '8A' }))
    expect(queryCandidates(dbOf(many), { bpm: 124, camelot: '8A' })).toHaveLength(15)
    const thin = [rec({ camelot: '8A' }), rec({ camelot: null }), rec({ camelot: null })]
    const out = queryCandidates(dbOf(thin), { bpm: 124, camelot: '8A' })
    expect(out).toHaveLength(3)
    expect(out[0].relation).toBe('perfect')
  })

  it('follows the floor direction and the era/density balance', () => {
    const hot = rec({ energy: 0.9, year: 2023, density: 0.8 })
    const calm = rec({ energy: 0.4, year: 1978, density: 0.3 })
    const up = queryCandidates(dbOf([hot, calm]), { bpm: 124, camelot: '8A', energy: 0.7, direction: 1 })
    expect(up[0].record.id).toBe(hot.id)
    const old = queryCandidates(dbOf([hot, calm]), { bpm: 124, camelot: '8A', energy: 0.6, year: 1975, density: 0.3 })
    expect(old[0].record.id).toBe(calm.id)
  })

  it('applies the voice filter', () => {
    const house = rec({ genre: 'Deep House', year: 1996 })
    const afro = rec({ genre: 'Afrobeats', year: 2021 })
    expect(queryCandidates(dbOf([house, afro]), { bpm: 124, camelot: '8A', filter: { genres: ['house'], yearFrom: 1990, yearTo: 1999 } }).map(c => c.record.id)).toEqual([house.id])
  })
})
