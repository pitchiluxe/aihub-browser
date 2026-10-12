import { describe, it, expect, vi } from 'vitest'
import { SetConductor, handoffCaption, type ConductorDeps } from './setConductor'
import { parseBrief } from './setBrief'
import { parseInstruction } from './instructions'

let n = 0
const yt = (artist: string, bpm = 120, energy = 0.6) => {
  const id = `v${String(++n).padStart(10, '0')}`
  return { track: { token: id, path: '', name: `${artist} - song${n}`, title: `song${n}`, artist, size: 0, youtubeId: id } as any, bpm, energy }
}
function deps(library: ReturnType<typeof yt>[], over: Partial<ConductorDeps> = {}): ConductorDeps & { mixNow: any; startMixer: any } {
  const facts = new Map(library.map(l => [l.track.youtubeId, { bpm: l.bpm, bpmConfidence: 1, camelot: '8A', keyConfidence: 0.9, energy: l.energy, introEndSec: 5, outroStartSec: 200, durationSec: 210, playable: true, at: 1 }]))
  return {
    pool: {
      profile: () => ({ topArtists: [], avoidArtists: [], lovedTracks: [], recentSearches: [], nowArtists: [], stats: { minutes: 0, plays: 0, completes: 0, skips: 0 } }),
      favorites: () => [],
      search: async (q: string) => library.filter(l => q === '*' || l.track.artist.toLowerCase().includes(q) || q.split(' ').some(w => l.track.name.toLowerCase().includes(w))).map(l => l.track).concat(library.map(l => l.track)),
    },
    analysis: { ensure: async (t: any) => facts.get(t.youtubeId)!, known: (t: any) => facts.get(t.youtubeId) ?? null },
    nowPlaying: () => null,
    startMixer: vi.fn(),
    mixNow: vi.fn(),
    now: () => 1_000,
    ...over,
  } as any
}

describe('SetConductor', () => {
  it('starts a set with a 3-track lookahead and starts the mixer', async () => {
    const lib = Array.from({ length: 8 }, (_, i) => yt(`artist${i}`))
    const d = deps(lib)
    const c = new SetConductor(d)
    await c.start(parseBrief('afrobeats, 1h'))
    expect(c.state.active).toBe(true)
    expect(c.state.upNext.length).toBe(3)
    expect(d.startMixer).toHaveBeenCalled()
  })

  it('next() hands over the lookahead head and never returns undefined while candidates remain', async () => {
    const lib = Array.from({ length: 6 }, (_, i) => yt(`artist${i}`))
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('afrobeats, 1h'))
    const got = new Set<string>()
    for (let i = 0; i < 6; i++) { const t = c.next(); expect(t).toBeDefined(); got.add(t!.youtubeId!); await c.refill() }
    expect(got.size).toBe(6)
  })

  it('gives a safe un-analysed pick when the lookahead is still empty', async () => {
    const lib = Array.from({ length: 4 }, (_, i) => yt(`artist${i}`))
    const d = deps(lib, { analysis: { ensure: () => new Promise(() => {}), known: () => null } })
    const c = new SetConductor(d)
    void c.start(parseBrief('afrobeats, 1h'))
    await new Promise(r => setTimeout(r, 10))
    expect(c.next()).toBeDefined()
  })

  it('a ban rule removes that artist from the lookahead immediately and confirms it', async () => {
    const lib = [yt('Drake'), yt('Drake'), yt('Burna Boy'), yt('Tems'), yt('Rema'), yt('Asake')]
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('afrobeats, 1h'))
    c.instruct(parseInstruction("don't play drake"))
    await c.refill()
    expect(c.state.upNext.every(s => !/drake/i.test(s.candidate.track.artist))).toBe(true)
    expect(c.state.message).toMatch(/no drake/i)
    expect(c.state.rules).toEqual([{ kind: 'banArtist', artist: 'drake' }])
  })

  it('relaxes limits instead of going silent when rules filter out everything', async () => {
    const lib = Array.from({ length: 5 }, (_, i) => yt(`artist${i}`, 128))
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('house, 1h'))
    c.instruct(parseInstruction('keep it under 90 bpm'))
    await c.refill()
    expect(c.next()).toBeDefined()
    expect(c.state.message).toMatch(/relax|couldn'?t find/i)
  })

  it('stop after this song: next() returns undefined and the set ends', async () => {
    const lib = Array.from({ length: 5 }, (_, i) => yt(`artist${i}`))
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('house, 1h'))
    c.instruct(parseInstruction('stop after this song'))
    expect(c.next()).toBeUndefined()
    expect(c.state.active).toBe(false)
  })

  it('playNext jumps the queue', async () => {
    const lib = [yt('a'), yt('b'), yt('c'), yt('Rema', 107)]
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('afrobeats, 1h'))
    c.instruct(parseInstruction('play Calm Down by Rema next'))
    await c.refill()
    expect(c.next()?.artist).toBe('Rema')
  })

  it('records each handoff for the transition caption', async () => {
    const lib = Array.from({ length: 5 }, (_, i) => yt(`artist${i}`, 104))
    const c = new SetConductor(deps(lib, { nowPlaying: () => ({ track: lib[0].track, facts: { bpm: 104, bpmConfidence: 1, camelot: '8A', keyConfidence: 1, energy: 0.6, introEndSec: 0, outroStartSec: 200, durationSec: 210, playable: true, at: 1 } }) }))
    await c.start(parseBrief('afrobeats, 1h'))
    c.next()
    expect(c.state.handoff).toMatchObject({ transition: 'beatmatch', fromBpm: 104, toBpm: 104, fromKey: '8A', toKey: '8A' })
    expect(handoffCaption(c.state.handoff!)).toBe('bass swap · 104→104 · 8A→8A')
  })

  it('moving the peak on the energy graph re-plans the lookahead', async () => {
    const lib = Array.from({ length: 8 }, (_, i) => yt(`artist${i}`, 120, i < 4 ? 0.3 : 0.95))
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('late night, 1h'))           // falling curve: calm picks first
    expect(c.state.upNext[0].candidate.facts!.energy).toBeLessThan(0.5)
    c.setPeak(0)                                            // peak right now
    await c.refill()
    expect(c.state.brief!.curve.some(p => p.atMin === 0 && p.level >= 0.9)).toBe(true)
    expect(c.state.upNext[0].candidate.facts!.energy).toBeGreaterThan(0.8)
  })

  it('skip mixes the next track in now', async () => {
    const lib = Array.from({ length: 5 }, (_, i) => yt(`artist${i}`))
    const d = deps(lib)
    const c = new SetConductor(d)
    await c.start(parseBrief('house, 1h'))
    c.skip()
    expect(d.mixNow).toHaveBeenCalledTimes(1)
  })

  it('after taking the decks back, plans from what is actually playing', async () => {
    const lib = Array.from({ length: 6 }, (_, i) => yt(`artist${i}`, 120 + i * 4))
    let playing: any = null
    const d = deps(lib, { nowPlaying: () => playing })
    const c = new SetConductor(d)
    await c.start(parseBrief('house, 1h'))
    c.setPaused(true)
    playing = { track: lib[5].track, facts: { bpm: 140, bpmConfidence: 1, camelot: '8A', keyConfidence: 1, energy: 0.6, introEndSec: 0, outroStartSec: 200, durationSec: 210, playable: true, at: 1 } }
    c.setPaused(false)
    await c.refill()
    expect(c.state.upNext[0].candidate.facts!.bpm).toBeGreaterThanOrEqual(132)
  })
})
