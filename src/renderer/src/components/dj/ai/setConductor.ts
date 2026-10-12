// Runs the set. It keeps three analysed songs ready, answers the AutoMixer's
// `next()` — never with nothing while songs remain, because an empty answer
// switches Automix off (the old "AI take-over: nothing happens" bug) — and
// applies every instruction as a rule the next picks must obey.
import { Emitter, type DjTrack } from '../engine/DjEngine'
import { trackId, type TrackFacts } from './types'
import { curveAt, type SetBrief } from './setBrief'
import { gatherCandidates, type PoolDeps } from './candidatePool'
import { rankCandidates, type Candidate, type PlanContext, type Scored } from './setPlanner'
import { ruleLabel, type Parsed, type SetRule } from './instructions'

export interface ConductorDeps {
  pool: PoolDeps
  analysis: { ensure(t: DjTrack): Promise<TrackFacts>; known(t: DjTrack): TrackFacts | null }
  nowPlaying(): { track: DjTrack; facts: TrackFacts | null } | null
  startMixer(): void
  mixNow(t: DjTrack): void
  now?: () => number
}

export interface ConductorState {
  active: boolean
  paused: boolean
  brief: SetBrief | null
  upNext: Scored[]
  rules: SetRule[]
  message: string
  startedAt: number
  played: PlanContext['played']
  /** The last song handed to the mixer and how it will come in — the transition caption. */
  handoff: Handoff | null
}

export interface Handoff { transition: 'beatmatch' | 'echo' | 'filter'; fromBpm: number | null; toBpm: number | null; fromKey: string | null; toKey: string | null }

export function handoffCaption(h: Handoff): string {
  const style = h.transition === 'beatmatch' ? 'bass swap' : h.transition === 'filter' ? 'filter blend' : 'echo out'
  const bpm = h.fromBpm && h.toBpm ? ` · ${Math.round(h.fromBpm)}→${Math.round(h.toBpm)}` : ''
  const key = h.fromKey && h.toKey ? ` · ${h.fromKey}→${h.toKey}` : ''
  return `${style}${bpm}${key}`
}

const LOOKAHEAD = 3
const SHORTLIST = 5

export class SetConductor extends Emitter {
  state: ConductorState = { active: false, paused: false, brief: null, upNext: [], rules: [], message: '', startedAt: 0, played: [], handoff: null }
  private pool: Omit<Candidate, 'facts'>[] = []
  private energyOffset = 0
  private discovery = 0.25
  private refilling: Promise<void> | null = null
  private stopAfter = false
  private bursts = { discovery: 0, favorites: 0 }
  private seq: { query: string; count: number }[] = []
  private playNextQueue: DjTrack[] = []
  /** Requested songs still to look up — resolved at the start of a refill so the request wins the race. */
  private playNextQueries: string[] = []
  private readonly now: () => number

  constructor(private deps: ConductorDeps) {
    super()
    this.now = deps.now ?? Date.now
  }

  private set(patch: Partial<ConductorState>): void { this.state = { ...this.state, ...patch }; this.emit() }
  private minutesIn(): number { return (this.now() - this.state.startedAt) / 60_000 }

  async start(brief: SetBrief): Promise<void> {
    this.discovery = brief.discoveryShare
    this.energyOffset = 0
    this.stopAfter = false
    this.seq = []; this.playNextQueue = []; this.playNextQueries = []; this.bursts = { discovery: 0, favorites: 0 }
    this.set({ active: true, paused: false, brief, upNext: [], rules: [...brief.rules], played: [], startedAt: this.now(), message: `Building your set: ${brief.vibe}` })
    this.pool = await gatherCandidates(brief.seeds, this.deps.pool)
    await this.refill()
    this.deps.startMixer()
  }

  stop(): void { this.set({ active: false, upNext: [], message: 'Set finished.' }) }

  private context(): PlanContext {
    const last = this.state.upNext[this.state.upNext.length - 1]
    const playing = this.deps.nowPlaying()
    const cur = last?.candidate.facts ?? (playing ? playing.facts ?? this.deps.analysis.known(playing.track) : null)
    const target = this.state.brief ? curveAt(this.state.brief.curve, this.minutesIn() + 4 * (this.state.upNext.length + 1)) : 0.6
    return {
      current: cur ? { bpm: cur.bpm, camelot: cur.camelot } : null,
      targetEnergy: Math.max(0, Math.min(1, target + this.energyOffset)),
      discoveryShare: this.bursts.discovery > 0 ? 1 : this.discovery,
      played: [...this.state.played, ...this.state.upNext.map(s => ({ id: trackId(s.candidate.track), artist: s.candidate.track.artist, atMin: this.minutesIn(), known: s.candidate.known }))],
      nowMin: this.minutesIn(),
      rules: this.state.rules,
      nowMs: this.now(),
    }
  }

  private withFacts(c: Omit<Candidate, 'facts'>): Candidate { return { ...c, facts: this.deps.analysis.known(c.track) } }

  refill(): Promise<void> {
    if (this.refilling) return this.refilling
    this.refilling = this.doRefill().finally(() => { this.refilling = null })
    return this.refilling
  }

  private async doRefill(): Promise<void> {
    if (!this.state.active || this.state.paused) return
    // Requested songs and sequences first: they are instructions, not suggestions.
    while (this.playNextQueries.length) {
      const q = this.playNextQueries.shift()!
      const found = (await this.deps.pool.search(q, 1).catch(() => []))[0]
      if (found) this.playNextQueue.push(found)
      else this.set({ message: `Couldn't find "${q}".` })
    }
    while (this.playNextQueue.length && this.state.upNext.length < LOOKAHEAD + 1) {
      const t = this.playNextQueue.shift()!
      const facts = await this.deps.analysis.ensure(t).catch(() => null)
      if (facts && !facts.playable) continue
      this.set({ upNext: [{ candidate: { track: t, facts, known: true, taste: 0, disliked: false, genres: [] }, total: 99, parts: { tempo: 0.5, key: 0.5, energy: 0.5, taste: 0.5, discovery: 0.5 }, why: 'you asked for it', transition: facts?.bpm ? 'beatmatch' : 'echo' }, ...this.state.upNext] })
    }
    let relaxed = false
    while (this.state.upNext.length < LOOKAHEAD) {
      if (this.seq.length) {
        const step = this.seq[0]
        const found = (await this.deps.pool.search(step.query, 8).catch(() => [])).find(t => !this.context().played.some(p => p.id === trackId(t)))
        if (found) {
          step.count--; if (step.count <= 0) this.seq.shift()
          const facts = await this.deps.analysis.ensure(found).catch(() => null)
          this.set({ upNext: [...this.state.upNext, { candidate: { track: found, facts, known: false, taste: 0, disliked: false, genres: [] }, total: 50, parts: { tempo: 0.5, key: 0.5, energy: 0.5, taste: 0.5, discovery: 0.5 }, why: `your request: ${step.query}`, transition: 'echo' }] })
          continue
        }
        this.seq.shift()
      }
      const ctx = this.context()
      let pool = this.pool.map(c => this.withFacts(c))
      if (this.bursts.favorites > 0) pool = pool.filter(c => c.known)
      let ranked = rankCandidates(pool, ctx)
      if (!ranked.length) {
        // Rules filtered everything: widen the pool once, then relax limits.
        const more = await gatherCandidates([...(this.state.brief?.seeds ?? []), ...this.relatedSeeds()], this.deps.pool, { perSeed: 25 })
        this.pool = mergePools(this.pool, more)
        ranked = rankCandidates(this.pool.map(c => this.withFacts(c)), ctx)
        if (!ranked.length) {
          ranked = rankCandidates(this.pool.map(c => this.withFacts(c)), { ...ctx, rules: ctx.rules.filter(r => r.kind === 'banArtist' || r.kind === 'noExplicit') })
          relaxed = ranked.length > 0
        }
        if (!ranked.length) break
      }
      // Measure the shortlist (cached ones are instant), then re-rank on real facts.
      for (const s of ranked.slice(0, SHORTLIST)) if (!s.candidate.facts) await this.deps.analysis.ensure(s.candidate.track).catch(() => null)
      const reranked = rankCandidates(ranked.slice(0, SHORTLIST).map(s => this.withFacts(s.candidate)), relaxed ? { ...ctx, rules: ctx.rules.filter(r => r.kind === 'banArtist' || r.kind === 'noExplicit') } : ctx)
      const pick = reranked[0] ?? ranked[0]
      if (!pick) break
      this.set({ upNext: [...this.state.upNext, pick] })
    }
    if (relaxed) this.set({ message: "Couldn't find songs that fit every rule — I relaxed the tempo/energy limits to keep the music going." })
  }

  private relatedSeeds(): string[] {
    const p = this.deps.pool.profile()
    return [...p.nowArtists.slice(0, 2), ...p.topArtists.slice(0, 2).map(a => a.artist)]
  }

  /** The AutoMixer's hook. Synchronous; never empty while songs remain. */
  next(): DjTrack | undefined {
    if (!this.state.active) return undefined
    if (this.stopAfter) { this.stop(); return undefined }
    let head = this.state.upNext[0]
    if (!head) {
      // Still analysing: hand over the best un-analysed song (safe transition)
      // rather than nothing, which would switch Automix off.
      const ranked = rankCandidates(this.pool.map(c => this.withFacts(c)), this.context())
      head = ranked[0]
      if (!head) return undefined
    } else {
      this.set({ upNext: this.state.upNext.slice(1) })
    }
    const from = this.deps.nowPlaying()
    const fromFacts = from ? from.facts ?? this.deps.analysis.known(from.track) : null
    const to = head.candidate.facts
    this.set({ handoff: { transition: head.transition, fromBpm: fromFacts?.bpm ?? null, toBpm: to?.bpm ?? null, fromKey: fromFacts?.camelot ?? null, toKey: to?.camelot ?? null } })
    this.noteStarted(head.candidate.track, head.candidate.known)
    if (this.bursts.discovery > 0 && !head.candidate.known) this.bursts.discovery--
    if (this.bursts.favorites > 0 && head.candidate.known) this.bursts.favorites--
    void this.refill()
    return head.candidate.track
  }

  noteStarted(t: DjTrack, known = true): void {
    const id = trackId(t)
    if (this.state.played.some(p => p.id === id)) return
    this.set({ played: [...this.state.played, { id, artist: t.artist, atMin: this.minutesIn(), known }] })
  }

  instruct(p: Parsed): void {
    let rules = [...this.state.rules]
    for (const item of p.items) {
      if ('removeRule' in item) {
        rules = rules.filter(r => !(r.kind === item.removeRule && (!item.value || JSON.stringify(r).toLowerCase().includes(item.value.toLowerCase()))))
        continue
      }
      if (!('rule' in item)) continue
      const r = item.rule
      switch (r.kind) {
        case 'stopAfterCurrent': this.stopAfter = true; break
        case 'playNext': this.playNextQueries.push(r.query); break
        case 'sequence': this.seq = r.steps.map(s => ({ ...s })); this.set({ upNext: [] }); break
        case 'discoveryBurst': this.bursts.discovery = r.tracks; this.set({ upNext: [] }); break
        case 'favoritesOnly': this.bursts.favorites = r.tracks; this.set({ upNext: [] }); break
        case 'onlyGenres':
          rules = rules.filter(x => x.kind !== 'onlyGenres'); rules.push(r)
          void gatherCandidates(r.genres, this.deps.pool).then(more => { this.pool = mergePools(this.pool, more); void this.refill() })
          break
        default: rules = rules.filter(x => JSON.stringify(x) !== JSON.stringify(r)); rules.push(r)
      }
    }
    // Drop queued picks that break the new rules; keep the rest.
    const ctxRules = rules
    const keep = this.state.upNext.filter(s => rankCandidates([s.candidate], { ...this.context(), rules: ctxRules, played: [] }).length > 0 || s.why === 'you asked for it')
    this.set({ rules, upNext: keep, message: p.confirm || this.state.message })
    void this.refill()
  }

  removeRule(index: number): void {
    const r = this.state.rules[index]
    if (!r) return
    this.set({ rules: this.state.rules.filter((_, i) => i !== index), message: `Removed: ${ruleLabel(r)}` })
    void this.refill()
  }

  skip(): void {
    const t = this.next()
    if (t) this.deps.mixNow(t)
  }

  steer(s: 'more-energy' | 'calmer' | 'more-like-this'): void {
    if (s === 'more-energy') this.energyOffset = Math.min(0.4, this.energyOffset + 0.15)
    if (s === 'calmer') this.energyOffset = Math.max(-0.4, this.energyOffset - 0.15)
    if (s === 'more-like-this') {
      const p = this.deps.nowPlaying()
      if (p) void gatherCandidates([p.track.artist], this.deps.pool, { perSeed: 10 }).then(more => { this.pool = mergePools(this.pool, more); this.set({ upNext: [] }); void this.refill() })
    }
    this.set({ upNext: [], message: s === 'more-energy' ? 'Lifting the energy.' : s === 'calmer' ? 'Bringing it down.' : 'More like this coming up.' })
    void this.refill()
  }

  setDiscovery(share: number): void { this.discovery = Math.max(0, Math.min(1, share)); this.set({ upNext: [] }); void this.refill() }

  /** "I want the peak at 22:30": dragging the graph moves the top of the curve. */
  setPeak(atMin: number): void {
    const b = this.state.brief
    if (!b) return
    const at = Math.max(0, Math.min(b.durationMin, atMin))
    const start = curveAt(b.curve, 0)
    const curve = [{ atMin: 0, level: at === 0 ? 0.95 : start }, ...(at > 0 ? [{ atMin: at, level: 0.95 }] : []), ...(at < b.durationMin ? [{ atMin: b.durationMin, level: 0.7 }] : [])]
    this.set({ brief: { ...b, curve }, upNext: [], message: `Peak moved to ${Math.round(at)} min in.` })
    void this.refill()
  }

  setPaused(p: boolean): void {
    if (p === this.state.paused) return
    // Coming back from the console: whatever is actually playing is the new
    // starting point, so the old lookahead is stale.
    this.set({ paused: p, ...(p ? {} : { upNext: [] }) })
    if (!p) { const now = this.deps.nowPlaying(); if (now) this.noteStarted(now.track); void this.refill() }
  }
}

function mergePools(a: Omit<Candidate, 'facts'>[], b: Omit<Candidate, 'facts'>[]): Omit<Candidate, 'facts'>[] {
  const out = new Map(a.map(c => [c.track.youtubeId || c.track.path, c]))
  for (const c of b) {
    const k = c.track.youtubeId || c.track.path
    const prev = out.get(k)
    if (!prev) out.set(k, c)
    else for (const g of c.genres) if (!prev.genres.includes(g)) prev.genres.push(g)
  }
  return [...out.values()]
}
