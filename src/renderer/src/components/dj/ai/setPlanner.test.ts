import { describe, it, expect } from 'vitest'
import { tempoFit, keyFit, allowedByRules, rankCandidates, type Candidate, type PlanContext } from './setPlanner'

const facts = (bpm: number | null, camelot: string | null, energy = 0.6) => ({ bpm, bpmConfidence: 1, camelot, keyConfidence: 0.9, energy, introEndSec: 5, outroStartSec: 200, durationSec: 210, playable: true, at: 1 })
let n = 0
const cand = (over: Partial<Candidate> & { bpm?: number | null; camelot?: string | null; energy?: number; artist?: string; title?: string } = {}): Candidate => {
  const id = `v${String(++n).padStart(10, '0')}`
  return {
    track: { token: id, path: '', name: id, title: over.title ?? id, artist: over.artist ?? `artist${n}`, size: 0, youtubeId: id } as any,
    facts: 'facts' in over ? over.facts! : facts(over.bpm ?? 120, over.camelot ?? '8A', over.energy ?? 0.6),
    known: over.known ?? true, taste: over.taste ?? 0, disliked: over.disliked ?? false, genres: over.genres ?? [],
  }
}
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ current: { bpm: 120, camelot: '8A' }, targetEnergy: 0.6, discoveryShare: 0.25, played: [], nowMin: 10, rules: [], nowMs: 1_000, ...over })

describe('tempoFit', () => {
  it('is full within ±3%, tapers to 0 at ±8%, and accepts half/double', () => {
    expect(tempoFit(120, 123)).toBe(1)
    expect(tempoFit(120, 129.6)).toBeCloseTo(0, 5)
    expect(tempoFit(120, 126)).toBeGreaterThan(0)
    expect(tempoFit(120, 126)).toBeLessThan(1)
    expect(tempoFit(120, 60)).toBe(1)
    expect(tempoFit(120, 240)).toBe(1)
    expect(tempoFit(null, 120)).toBe(0.5)
  })
})

describe('keyFit', () => {
  it('scores the Camelot wheel', () => {
    expect(keyFit('8A', '8A')).toBe(1)
    expect(keyFit('8A', '9A')).toBe(1)
    expect(keyFit('8A', '8B')).toBe(1)
    expect(keyFit('12A', '1A')).toBe(1)
    expect(keyFit('8A', '10A')).toBe(0.5)
    expect(keyFit('8A', '3B')).toBe(0.2)
    expect(keyFit(null, '8A')).toBe(0.5)
  })
})

describe('allowedByRules', () => {
  it('enforces bans, genre focus, tempo, energy floors, explicit and expiry', () => {
    expect(allowedByRules(cand({ artist: 'Drake' }), [{ kind: 'banArtist', artist: 'drake' }], 0)).toBe(false)
    expect(allowedByRules(cand({ artist: 'Drake ft. Future' }), [{ kind: 'banArtist', artist: 'drake' }], 0)).toBe(false)
    expect(allowedByRules(cand({ genres: ['house'] }), [{ kind: 'onlyGenres', genres: ['amapiano'] }], 0)).toBe(false)
    expect(allowedByRules(cand({ genres: ['amapiano'] }), [{ kind: 'onlyGenres', genres: ['amapiano'] }], 0)).toBe(true)
    expect(allowedByRules(cand({ bpm: 128 }), [{ kind: 'tempoRange', max: 110 }], 0)).toBe(false)
    expect(allowedByRules(cand({ energy: 0.3 }), [{ kind: 'minEnergy', level: 0.5 }], 0)).toBe(false)
    expect(allowedByRules(cand({ energy: 0.3 }), [{ kind: 'minEnergy', level: 0.5, untilMs: 10 }], 20)).toBe(true)
    expect(allowedByRules(cand({ title: 'Song (Explicit)' }), [{ kind: 'noExplicit' }], 0)).toBe(false)
    // "no hip hop" excludes; "less hip hop" only down-ranks.
    expect(allowedByRules(cand({ genres: ['hip hop'] }), [{ kind: 'lessGenre', genre: 'hip hop', hard: true }], 0)).toBe(false)
    expect(allowedByRules(cand({ genres: ['hip hop'] }), [{ kind: 'lessGenre', genre: 'hip hop' }], 0)).toBe(true)
  })
})

describe('rankCandidates', () => {
  it('prefers a track that mixes well', () => {
    const good = cand({ bpm: 121, camelot: '9A' }), clash = cand({ bpm: 140, camelot: '3B' })
    const [top] = rankCandidates([clash, good], ctx())
    expect(top.candidate).toBe(good)
    expect(top.transition).toBe('beatmatch')
    expect(top.why).toMatch(/key|tempo|mix/i)
  })

  it('excludes disliked, already played, and artists heard in the last 45 minutes', () => {
    const disliked = cand({ disliked: true })
    const played = cand()
    const sameArtist = cand({ artist: 'Burna Boy' })
    const ok = cand()
    const ranked = rankCandidates([disliked, played, sameArtist, ok], ctx({ nowMin: 50, played: [{ id: `yt:${played.track.youtubeId}`, artist: 'x', atMin: 1, known: true }, { id: 'yt:zzz', artist: 'burna boy', atMin: 20, known: true }] }))
    expect(ranked.map(r => r.candidate)).toEqual([ok])
  })

  it('leans to discovery when the set has had too few new tracks', () => {
    const known = cand({ known: true }), fresh = cand({ known: false })
    const [top] = rankCandidates([known, fresh], ctx({ played: Array.from({ length: 6 }, (_, i) => ({ id: `yt:k${i}`, artist: `a${i}`, atMin: 0, known: true })) }))
    expect(top.candidate).toBe(fresh)
    expect(top.why).toMatch(/new to you/i)
  })

  it('uses a safe transition when the tempo is unknown or far off', () => {
    const unknown = cand({ facts: null })
    expect(rankCandidates([unknown], ctx())[0].transition).toBe('echo')
    const far = cand({ bpm: 150 })
    expect(rankCandidates([far], ctx())[0].transition).toBe('filter')
  })

  it('never ranks an unplayable track', () => {
    const dead = cand({ facts: { ...facts(120, '8A'), playable: false } })
    expect(rankCandidates([dead], ctx())).toEqual([])
  })

  it('boosts more-genre and penalises less-genre', () => {
    const house = cand({ genres: ['house'] }), hiphop = cand({ genres: ['hip hop'] })
    const [top] = rankCandidates([hiphop, house], ctx({ rules: [{ kind: 'lessGenre', genre: 'hip hop' }] }))
    expect(top.candidate).toBe(house)
  })
})

describe('same song, different upload', () => {
  it('never queues a song that already played under another video id', () => {
    const played = cand({ artist: 'Davido, Mayorkun, FOLA', title: 'B4 B4 (Official Video)' })
    const again = cand({ artist: 'Davido, Mayorkun, FOLA', title: 'B4 B4 (Official Audio)' })
    const other = cand()
    const ranked = rankCandidates([again, other], ctx({ played: [{ id: `yt:${played.track.youtubeId}`, artist: 'Davido, Mayorkun, FOLA', atMin: 100, known: true, title: 'B4 B4 (Official Video)' } as any], nowMin: 200 }))
    expect(ranked.map(r => r.candidate)).toEqual([other])
  })
})
