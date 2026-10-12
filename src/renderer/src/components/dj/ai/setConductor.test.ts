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
    await c.refill()
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

  it('starts the music at once — the first song never waits for analysis', async () => {
    const lib = Array.from({ length: 6 }, (_, i) => yt(`artist${i}`))
    const d = deps(lib, { analysis: { ensure: () => new Promise(() => {}), known: () => null } })
    const c = new SetConductor(d)
    await Promise.race([c.start(parseBrief('afrobeats, 1h')), new Promise((_, rej) => setTimeout(() => rej(new Error('start() waited on analysis')), 200))])
    expect(d.startMixer).toHaveBeenCalled()
    expect(c.next()).toBeDefined()
  })

  it('scans at most two candidates per pick (a 2x scan is ~2 minutes each)', async () => {
    const lib = Array.from({ length: 10 }, (_, i) => yt(`artist${i}`))
    const ensure = vi.fn(async (_t: any) => ({ bpm: 120, bpmConfidence: 1, camelot: '8A', keyConfidence: 0.9, energy: 0.6, introEndSec: 5, outroStartSec: 200, durationSec: 210, playable: true, at: 1 }))
    const c = new SetConductor(deps(lib, { analysis: { ensure, known: () => null } }))
    await c.start(parseBrief('afrobeats, 1h'))
    await c.refill()
    expect(ensure.mock.calls.length).toBeLessThanOrEqual(2 * 3)
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

describe('SetConductor — final review', () => {
  it('a rule given while a song is being measured still applies to that song', async () => {
    const lib = [yt('Drake'), yt('Drake'), yt('Drake'), yt('Tems'), yt('Rema'), yt('Asake')]
    const facts = new Map(lib.map(l => [l.track.youtubeId, { bpm: 120, bpmConfidence: 1, camelot: '8A', keyConfidence: 0.9, energy: 0.6, introEndSec: 5, outroStartSec: 200, durationSec: 210, playable: true, at: 1 }]))
    const measured = new Set<string>()
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    const d = deps(lib, { analysis: { ensure: async (t: any) => { await gate; measured.add(t.youtubeId); return facts.get(t.youtubeId)! }, known: (t: any) => measured.has(t.youtubeId) ? facts.get(t.youtubeId)! : null } })
    const c = new SetConductor(d)
    await c.start(parseBrief('drake, 1h'))
    const filling = c.refill()
    await new Promise(r => setTimeout(r, 5))
    c.instruct(parseInstruction("don't play drake"))       // arrives mid-scan
    release()
    await filling; await c.refill()
    expect(c.state.upNext.length).toBeGreaterThan(0)
    expect(c.state.upNext.every(s => !/drake/i.test(s.candidate.track.artist))).toBe(true)
    for (let i = 0; i < 3; i++) expect(c.next()?.artist).not.toMatch(/drake/i)
  })

  it('a small pool never goes silent: artist-gap and repeat limits relax before Automix stops', async () => {
    const lib = [yt('Wizkid'), yt('Wizkid')]
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('wizkid, 1h'))
    for (let i = 0; i < 5; i++) { expect(c.next()).toBeDefined(); await c.refill() }
  })

  it('when nothing at all can play, the set ends and says so (no re-arm loop)', async () => {
    const lib = [yt('Drake'), yt('Drake')]
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('drake, 1h'))
    c.instruct(parseInstruction("don't play drake"))
    await c.refill()
    expect(c.next()).toBeUndefined()
    expect(c.state.active).toBe(false)
    expect(c.state.message).toMatch(/ran out|no songs/i)
  })

  it('never hands over the song that is already playing, even on a tiny pool', async () => {
    const lib = [yt('Wizkid'), yt('Drake')]
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('afrobeats, 1h'))
    await c.refill()
    const first = c.next()!
    await c.refill()
    c.instruct(parseInstruction("don't play drake"))
    const second = c.next()
    expect(second?.youtubeId).not.toBe(first.youtubeId)
  })

  it('a thin first search is topped up before anything repeats (live run: pool of 4 → Soweto twice)', async () => {
    const lib = Array.from({ length: 20 }, (_, i) => yt(`artist${i % 4}`))
    const d = deps(lib)
    // Like YouTube on a fresh profile: the brief's search keeps returning the same
    // 4 songs however many are asked for; searching an ARTIST finds their other songs.
    d.pool.search = async (q: string) => (/^artist\d$/.test(q) ? lib.filter(l => l.track.artist === q) : lib.slice(0, 4)).map(l => l.track)
    const c = new SetConductor(d)
    await c.start(parseBrief('afrobeats warm-up, 1h'))
    const seen: string[] = []
    for (let i = 0; i < 8; i++) { await c.refill(); const t = c.next(); expect(t).toBeDefined(); seen.push(t!.youtubeId!) }
    expect(new Set(seen).size).toBe(8)
    expect(c.state.message).not.toMatch(/repeats/)
  })

  it('a pool running low is widened before a repeat is ever queued (live: Bandana queued twice)', async () => {
    const lib = Array.from({ length: 20 }, (_, i) => yt(`artist${i % 5}`))
    const d = deps(lib)
    d.pool.search = async (q: string) => (/^artist\d$/.test(q) ? lib.filter(l => l.track.artist === q) : lib.slice(0, 5)).map(l => l.track)
    const c = new SetConductor(d)
    await c.start(parseBrief('afrobeats warm-up, 1h'))
    for (let i = 0; i < 4; i++) {
      await c.refill()
      const played = new Set(c.state.played.map(p => p.id))
      expect(c.state.upNext.filter(s => played.has(s.candidate.track.youtubeId ? `yt:${s.candidate.track.youtubeId}` : '')).length).toBe(0)
      expect(c.state.message).not.toMatch(/repeats/)
      c.next()
    }
  })

  it('a thin first search is widened right away, by the artists it found', async () => {
    const lib = Array.from({ length: 20 }, (_, i) => yt(`artist${i % 5}`))
    const d = deps(lib)
    const queries: string[] = []
    d.pool.search = async (q: string) => { queries.push(q); return (/^artist\d$/.test(q) ? lib.filter(l => l.track.artist === q) : lib.slice(0, 5)).map(l => l.track) }
    const c = new SetConductor(d)
    await c.start(parseBrief('afrobeats warm-up, 1h'))
    await new Promise(r => setTimeout(r, 0))
    expect(queries.some(q => /^artist\d$/.test(q))).toBe(true)
  })

  it('a pick queued under relaxed limits is played, not thrown away at hand-over', async () => {
    const lib = [yt('a', 120, 0.3), yt('b', 120, 0.3), yt('c', 120, 0.3)]
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('afrobeats, 1h'))
    c.instruct(parseInstruction('no more slow songs'))   // nothing fits: limits relax
    await c.refill()
    const queued = c.state.upNext.map(s => s.candidate.track.youtubeId)
    expect(queued.length).toBeGreaterThan(1)
    expect(c.next()?.youtubeId).toBe(queued[0])
    expect(c.state.upNext.map(s => s.candidate.track.youtubeId)).toContain(queued[1])
  })

  it('coming back from the console restarts the mixer', async () => {
    const lib = Array.from({ length: 5 }, (_, i) => yt(`artist${i}`))
    const d = deps(lib)
    const c = new SetConductor(d)
    await c.start(parseBrief('house, 1h'))
    c.setPaused(true)
    d.startMixer.mockClear()
    c.setPaused(false)
    expect(d.startMixer).toHaveBeenCalledTimes(1)
  })

  it('a requested sequence skips an unplayable upload', async () => {
    const lib = [yt('Wizkid'), yt('Wizkid'), yt('Tems'), yt('Rema')]
    const dead = lib[0].track.youtubeId
    const d = deps(lib)
    const ensure = d.analysis.ensure
    d.analysis.ensure = async (t: any) => t.youtubeId === dead ? { ...(await ensure(t)), playable: false } : ensure(t)
    const c = new SetConductor(d)
    await c.start(parseBrief('afrobeats, 1h'))
    c.instruct(parseInstruction('play 2 Wizkid songs then Tems'))
    await c.refill()
    expect(c.state.upNext.some(s => s.candidate.track.youtubeId === dead)).toBe(false)
  })
})

describe('gatherCandidates — songs only', () => {
  it('drops hour-long mixes, mixtapes, playlists and compilations', async () => {
    const { gatherCandidates } = await import('./candidatePool')
    const mk = (title: string, durationHint?: number) => ({ token: title, path: '', name: title, title, artist: 'x', size: 0, youtubeId: title.slice(0, 11).padEnd(11, '0'), durationHint }) as any
    const results = [
      mk('NAIJA AFROBEAT MIX, AFROBEAT VIDEO MIX | BURNA BOY, AYRA STARR', 3739),
      mk('Afrobeats Mixtape 2026'), mk('Amapiano Nonstop Playlist'), mk('Best of Wizkid Full Album'),
      mk('1 Hour of Afro House', 3600), mk('DJ Set Live at Boiler Room'),
      mk('Burna Boy - Last Last', 172), mk('Tems - Free Mind', 246),
    ]
    const c = await gatherCandidates(['afrobeats'], {
      profile: () => ({ topArtists: [], avoidArtists: [], lovedTracks: [], recentSearches: [], nowArtists: [], stats: { minutes: 0, plays: 0, completes: 0, skips: 0 } }),
      favorites: () => [], search: async () => results,
    })
    expect(c.map(x => x.track.title)).toEqual(['Burna Boy - Last Last', 'Tems - Free Mind'])
  })
})

describe('SetConductor — what the stage shows', () => {
  it('shows a tentative next song while it is still being measured', async () => {
    const lib = Array.from({ length: 5 }, (_, i) => yt(`artist${i}`))
    const c = new SetConductor(deps(lib, { analysis: { ensure: () => new Promise(() => {}), known: () => null } }))
    void c.start(parseBrief('afrobeats, 1h'))
    await new Promise(r => setTimeout(r, 20))
    expect(c.state.upNext).toEqual([])
    expect(c.state.tentative?.candidate.track.artist).toMatch(/^artist/)
  })

  it('clears "Building your set" once the first song is handed over', async () => {
    const lib = Array.from({ length: 5 }, (_, i) => yt(`artist${i}`))
    const c = new SetConductor(deps(lib))
    await c.start(parseBrief('afrobeats, 1h'))
    expect(c.state.message).toMatch(/building/i)
    c.next()
    expect(c.state.message).toBe('')
  })
})
