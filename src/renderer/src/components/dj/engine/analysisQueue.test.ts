import { describe, it, expect, vi } from 'vitest'
import { AnalysisQueue } from './analysisQueue'
import type { TrackFacts } from '../ai/types'

const track = (id: string) => ({ token: id, path: '', name: id, title: id, artist: 'x', size: 0, youtubeId: id.padEnd(11, '0') }) as any
const measured = { bpm: 120, bpmConfidence: 1, camelot: '8A', keyConfidence: 0.9, energy: 0.6, introEndSec: 5, outroStartSec: 200, durationSec: 210 }
function memCache() { const m = new Map<string, TrackFacts>(); return { m, get: (id: string) => m.get(id) ?? null, put: (id: string, f: TrackFacts) => { m.set(id, f) } } }

describe('AnalysisQueue', () => {
  it('measures tracks one at a time and caches them', async () => {
    let running = 0, peak = 0
    const source = { measure: vi.fn(async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return measured }) }
    const q = new AnalysisQueue(source, memCache(), { sleep: async () => {} })
    const [a, b] = await Promise.all([q.ensure(track('a')), q.ensure(track('b'))])
    expect(a.bpm).toBe(120); expect(b.playable).toBe(true)
    expect(peak).toBe(1)
    await q.ensure(track('a'))
    expect(source.measure).toHaveBeenCalledTimes(2)
  })

  it('marks a track that cannot be scanned as unplayable', async () => {
    const q = new AnalysisQueue({ measure: async () => null }, memCache(), { sleep: async () => {} })
    expect((await q.ensure(track('c'))).playable).toBe(false)
  })

  it('remembers an unplayable track for this session only — a network blip never bans a song forever', async () => {
    const cache = memCache()
    const source = { measure: vi.fn(async () => null) }
    const q = new AnalysisQueue(source, cache, { sleep: async () => {} })
    expect((await q.ensure(track('f'))).playable).toBe(false)
    expect((await q.ensure(track('f'))).playable).toBe(false)
    expect(source.measure).toHaveBeenCalledTimes(1)
    expect(cache.m.size).toBe(0)
    expect(q.known(track('f'))?.playable).toBe(false)
  })

  it('keeps working after dispose (React StrictMode mounts, disposes, mounts again)', async () => {
    const source = { measure: vi.fn(async () => measured) }
    const q = new AnalysisQueue(source, memCache(), { sleep: async () => {} })
    q.dispose()
    expect((await q.ensure(track('g'))).playable).toBe(true)
    expect(source.measure).toHaveBeenCalledTimes(1)
  })

  it('waits while a transition is running before starting a scan', async () => {
    let busy = true
    const slept: number[] = []
    const source = { measure: vi.fn(async () => measured) }
    const q = new AnalysisQueue(source, memCache(), { isBusy: () => busy, sleep: async ms => { slept.push(ms); busy = false } })
    await q.ensure(track('d'))
    expect(slept.length).toBeGreaterThan(0)
    expect(source.measure).toHaveBeenCalledTimes(1)
  })

  it('returns cached facts without scanning', async () => {
    const cache = memCache()
    cache.put('yt:e0000000000', { ...measured, playable: true, at: 1 })
    const source = { measure: vi.fn(async () => measured) }
    const q = new AnalysisQueue(source, cache, { sleep: async () => {} })
    expect((await q.ensure(track('e'))).bpm).toBe(120)
    expect(source.measure).not.toHaveBeenCalled()
  })
})
