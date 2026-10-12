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
