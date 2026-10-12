// One scan at a time, never during a transition: a scan shares the CPU and
// the network with the decks, and a stuttering blend is the one thing a DJ
// cannot do. Results are cached so a song is only ever measured once.
import type { DjTrack } from './DjEngine'
import type { FactSource } from './factScan'
import { trackId, type TrackFacts } from '../ai/types'

export interface FactsCache { get(id: string): TrackFacts | null; put(id: string, f: TrackFacts): void }

export class AnalysisQueue {
  private chain: Promise<unknown> = Promise.resolve()
  private inflight = new Map<string, Promise<TrackFacts>>()
  private signal = { cancelled: false }
  private waiting = 0
  private readonly isBusy: () => boolean
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(private source: FactSource, private cache: FactsCache, opts: { isBusy?: () => boolean; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}) {
    this.isBusy = opts.isBusy ?? (() => false)
    this.sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
    this.now = opts.now ?? Date.now
  }

  /** Failed scans, kept for this session only: a network blip or an ad must
   *  not ban a song forever, so they never reach the persistent cache. */
  private unplayable = new Map<string, TrackFacts>()

  known(track: DjTrack): TrackFacts | null { const id = trackId(track); return this.cache.get(id) ?? this.unplayable.get(id) ?? null }
  get pending(): number { return this.waiting }

  ensure(track: DjTrack): Promise<TrackFacts> {
    const id = trackId(track)
    const hit = this.cache.get(id) ?? this.unplayable.get(id)
    if (hit) return Promise.resolve(hit)
    const running = this.inflight.get(id)
    if (running) return running
    this.waiting++
    // Captured per job: dispose() cancels what is queued now, not what comes after.
    const signal = this.signal
    const job = this.chain.then(async () => {
      while (this.isBusy() && !signal.cancelled) await this.sleep(1000)
      const m = signal.cancelled ? null : await this.source.measure(track, signal).catch(() => null)
      const facts: TrackFacts = m
        ? { ...m, playable: true, at: this.now() }
        : { bpm: null, bpmConfidence: 0, camelot: null, keyConfidence: 0, energy: 0.5, introEndSec: 0, outroStartSec: 0, durationSec: 0, playable: false, at: this.now() }
      if (signal.cancelled) return facts
      if (m) this.cache.put(id, facts)
      else this.unplayable.set(id, facts)
      return facts
    }).finally(() => { this.waiting--; this.inflight.delete(id) })
    this.chain = job.catch(() => {})
    this.inflight.set(id, job)
    return job
  }

  /** Cancels the scans queued so far. Reversible: React StrictMode disposes and
   *  re-mounts the same memoised queue, which must keep working afterwards. */
  dispose(): void { this.signal.cancelled = true; this.signal = { cancelled: false } }
}
