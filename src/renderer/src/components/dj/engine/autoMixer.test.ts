import { describe, it, expect, vi } from 'vitest'
import { AutoMixer } from './autoMixer'

const track = (id: string) => ({ token: id, path: '', name: id, title: id, artist: 'x', size: 0, youtubeId: id.padEnd(11, '0') }) as any

function fakeDeck(id: 'A' | 'B', over: Record<string, unknown> = {}) {
  return {
    id, track: null as any, error: null, duration: 0, time: 0, rate: 1,
    playing: false, active: false, held: false, loading: false, finished: false,
    load: vi.fn(async function (this: any, t: any) { this.track = t; this.time = 0; this.finished = false }),
    play: vi.fn(async () => {}), pause: vi.fn(), eject: vi.fn(),
    ...over,
  }
}

function setup(a: Record<string, unknown>, b: Record<string, unknown> = {}) {
  const A = fakeDeck('A', a), B = fakeDeck('B', b)
  const engine = { decks: { A, B }, fading: false, setCrossfader: vi.fn(), fadeTo: vi.fn() } as any
  const next = vi.fn(() => track('next'))
  const m = new AutoMixer(engine, { next, loaded: vi.fn(), say: vi.fn() })
  return { A, B, next, tick: () => (m as any).tick() }
}

describe('AutoMixer — no silence at hand-over', () => {
  it('waits until the incoming song is actually audible before fading the outgoing one', async () => {
    vi.useFakeTimers()
    try {
      const { A, B, mixer, engine } = setupMixer()
      A.track = track('out'); A.playing = true; A.active = true; A.duration = 200; A.time = 190
      // A YouTube deck takes a moment (buffering, an ad) before it makes a sound.
      B.play = vi.fn(async () => { B.active = true; setTimeout(() => { B.playing = true }, 2500) })
      const done = mixer.mixNow(track('in'))
      await vi.advanceTimersByTimeAsync(1000)
      expect(engine.fadeTo).not.toHaveBeenCalled()       // still buffering: keep A up
      ;(mixer as any).tick()                              // Automix's own tick meanwhile…
      expect(A.pause).not.toHaveBeenCalled()             // …must not stop the outgoing song
      await vi.advanceTimersByTimeAsync(2000)
      await done
      expect(engine.fadeTo).toHaveBeenCalledTimes(1)     // now it is audible: blend
    } finally { vi.useRealTimers() }
  })

  it('never waits forever for a deck that will not start', async () => {
    vi.useFakeTimers()
    try {
      const { A, B, mixer, engine } = setupMixer()
      A.track = track('out'); A.playing = true; A.active = true; A.duration = 200; A.time = 190
      B.play = vi.fn(async () => { B.active = true })     // never becomes audible
      const done = mixer.mixNow(track('in'))
      await vi.advanceTimersByTimeAsync(6000)
      await done
      expect(engine.fadeTo).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
})

function setupMixer() {
  const A = fakeDeck('A'), B = fakeDeck('B')
  ;(B as any).sync = vi.fn(); (B as any).gridKnown = false; (A as any).bpm = null; (B as any).bpm = null
  const engine = { decks: { A, B }, fading: false, setCrossfader: vi.fn(), fadeTo: vi.fn() } as any
  const mixer = new AutoMixer(engine, { next: vi.fn(), loaded: vi.fn(), say: vi.fn() })
  mixer.setProTransitions(false)
  return { A, B, mixer, engine }
}

describe('AutoMixer — a playlist never stalls between songs', () => {
  it('a song that ENDED short of its length (YouTube ad, rounded duration) is finished, not "paused part-way"', () => {
    // Ended at 3:14 of a reported 3:20 — more than 2 s short.
    const { A, next, tick } = setup({ track: track('a'), duration: 200, time: 194, finished: true })
    tick()
    expect(next).toHaveBeenCalledTimes(1)
    expect(A.load).toHaveBeenCalled()   // the finished deck takes the next song
  })

  it('a song whose length was never known still moves on when it ends', () => {
    const { next, tick } = setup({ track: track('a'), duration: 0, time: 181, finished: true })
    tick()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('a song the DJ paused part-way is still left alone', () => {
    const { next, tick } = setup({ track: track('a'), duration: 200, time: 90, finished: false })
    tick()
    expect(next).not.toHaveBeenCalled()
  })
})
