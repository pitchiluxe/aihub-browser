/**
 * Real-time song suggestions from the local model.
 *
 * Rides the engine clock: whenever the track on air changes it reads the deck
 * (title, artist, BPM, key, genre, energy), pulls 10–15 compatible tracks from
 * the library database (tempo ±6 %, a harmonic key), sends them to Ollama as one
 * JSON payload decoded against a schema, and publishes three picks with a
 * rationale, phrase-exact cues and a loop, a mashup pair and an FX macro.
 *
 * While the song plays it keeps the floor in view (re-ordering the picks when
 * the room wants more or less), writes what it learnt into the database, and
 * works one song ahead: pools for the next three picks, and the full
 * suggestion for the first, are ready before they are needed.
 */
import { DECK_IDS, Emitter, type Deck, type DeckId, type DjEngine, type DjTrack } from '../engine/DjEngine'
import { ENV_RATE } from '../engine/analysis'
import type { AutoMixer } from '../engine/autoMixer'
import { onAir } from '../djActions'
import { trackId, type TrackFacts } from '../ai/types'
import { factsCache } from '../ai/trackFacts'
import { withDeckCover } from '../coverLookup'
import * as lib from './libraryDb'
import { buildMessages, suggestionSchema } from './prompt'
import { extractJson, parseSuggestion } from './parse'
import { directionFor, directionSign, FloorMeter, reindex } from './rank'
import { findBreakdown, PHRASE_BEATS } from './phrase'
import { FxRunner } from './fxScript'
import { StemGuard } from './stemGuard'
import { interpret, VoiceRecorder } from './voice'
import type { CandidateFilter, Direction, NowTrack, Pick, PoolEntry, Suggestion, TrackRecord } from './types'

export type SuggestStatus = 'idle' | 'waiting' | 'querying' | 'thinking' | 'ready' | 'error'

export interface SuggestDeps {
  engine: DjEngine
  mixer: AutoMixer
  facts(t: DjTrack): TrackFacts | null
  say(msg: string): void
}

/** Pools and answers made ahead stay good this long. */
const AHEAD_TTL = 15 * 60_000
/** Progress through the song at which the next three picks are pre-buffered, and the first pick's suggestion is made. */
const AHEAD_POOLS_AT = 0.3
const AHEAD_RESULT_AT = 0.55
/** A new floor direction must hold this long before the model is asked again (the order changes at once). */
const REASK_AFTER_MS = 20_000

const ai = () => (window as any).electronAPI?.ai
const floorApi = () => (window as any).electronAPI?.dj?.floor
const filterSig = (f: CandidateFilter | null) => (f ? JSON.stringify(f) : '')

export class SuggestionEngine extends Emitter {
  status: SuggestStatus = 'idle'
  error = ''
  now: NowTrack | null = null
  pool: PoolEntry[] = []
  result: Suggestion | null = null
  /** The picks in the order the floor wants them. */
  ordered: Pick[] = []
  filter: CandidateFilter | null = null
  direction: Direction = 'hold'
  readonly floor = new FloorMeter()
  floorFeed = { on: false, port: 0, error: '' }
  pivots = true
  libraryCount = 0
  voice = { listening: false, busy: false, transcript: '', error: '' }
  /** Ids pre-buffered for the next song. */
  ahead: string[] = []
  mashupOn: [DeckId, DeckId] | null = null
  /** Earlier suggestion sets, oldest first; the Prev / Next arrows page through them. */
  history: { now: NowTrack; result: Suggestion; ordered: Pick[]; pool: PoolEntry[] }[] = []
  /** Index into `history` on screen. */
  viewing = -1

  readonly fx = new FxRunner()
  readonly stems: StemGuard
  private readonly recorder = new VoiceRecorder()

  private seq = 0
  private onAirId = ''
  private lastSlow = 0
  private lastNote = 0
  private dirSince = 0
  private aheadPools = new Map<string, { pool: PoolEntry[]; filter: string; at: number }>()
  private aheadResults = new Map<string, { s: Suggestion; at: number }>()
  private aheadFor = ''
  private aheadResultFor = ''
  private inflightAhead = false
  /** Picks waiting for their deck to finish loading, so cues land on the right song. */
  private pendingCues = new Map<string, Pick>()
  /** The pick on the incoming deck — its stem plan drives the stem trigger. */
  private incomingPick: Pick | null = null
  private unsub: () => void
  private unsubFloor: (() => void) | null = null

  constructor(private deps: SuggestDeps) {
    super()
    this.stems = new StemGuard(() => this.incomingPick?.stems ?? null, m => deps.say(m))
    this.unsub = deps.engine.onTick(() => this.tick())
    this.unsubFloor = floorApi()?.onReading?.((r: { energy: number; source: string }) => {
      if (typeof r?.energy === 'number') { this.floor.push(r.energy, r.source || 'external'); this.emit() }
    }) ?? null
    void lib.count().then(n => { this.libraryCount = n; this.emit() })
    void this.loadSttUrl()
  }

  dispose(): void {
    this.unsub()
    this.unsubFloor?.()
    this.fx.disarm()
    this.stems.restore()
    if (this.floorFeed.on) void floorApi()?.setFeed(false)
    void this.recorder.stop()
  }

  private get decks(): Deck[] { return DECK_IDS.map(id => this.deps.engine.decks[id]) }

  // ── the playback loop ──
  private tick(): void {
    this.fx.tick()
    this.stems.tick(this.decks)
    const t = performance.now()
    if (t - this.lastSlow < 1000) return
    this.lastSlow = t
    this.slowTick(t)
  }

  private slowTick(t: number): void {
    if (t - this.lastNote > 5000) {
      this.lastNote = t
      for (const d of this.decks) if (d.track && !d.loading) { const r = lib.recordFromDeck(d, this.deps.facts(d.track)); if (r) lib.note(r) }
    }
    this.applyPendingCues()

    const live = onAir(this.deps.engine)
    const id = live?.track ? trackId(live.track) : ''
    if (!live || !id) {
      // A request still running for the song that just ended keeps its spinner.
      if (this.status !== 'idle' && this.status !== 'querying' && this.status !== 'thinking' && !this.result) { this.status = 'idle'; this.emit() }
      return
    }
    if (id !== this.onAirId || (this.status === 'waiting' && live.bpm)) {
      const changed = id !== this.onAirId
      this.onAirId = id
      void this.onTrack(live, changed)
      return
    }
    if (!this.now) return
    this.now.positionSec = live.time
    // Vibe check: the floor against the track.
    const dir = directionFor(this.floor.get(), this.now.energy)
    if (dir !== this.direction) {
      this.direction = dir
      this.dirSince = t
      // Only the latest set follows the floor; an earlier one paged back to stays as it was.
      if (this.result && this.result.forId === this.now.id) this.ordered = reindex(this.result.picks, dir, this.now.energy)
      this.emit()
    } else if (this.result && this.result.direction !== dir && this.status === 'ready' && t - this.dirSince > REASK_AFTER_MS) {
      void this.refresh(true)
    }
    this.queueAhead(this.now.durationSec ? live.time / this.now.durationSec : 0)
  }

  private async onTrack(deck: Deck, changed: boolean): Promise<void> {
    const track = deck.track!
    if (changed) { this.fx.disarm(); this.result = null; this.ordered = []; this.pool = [] }
    const bpm = deck.bpm
    if (!bpm) { this.now = null; this.status = 'waiting'; this.error = ''; this.emit(); return }
    // Out of 'waiting' at once: the clock calls again every second while this awaits.
    this.status = 'querying'
    const id = trackId(track)
    const stored: TrackRecord | undefined = (await (window as any).electronAPI?.dj?.db?.get([id]).catch(() => ({})))?.[id]
    if (this.onAirId !== id) return
    const facts = this.deps.facts(track)
    const duration = deck.duration || facts?.durationSec || stored?.durationSec || 0
    const outro = facts?.outroStartSec || stored?.outroStartSec || duration * 0.85
    const low = deck.analysis?.env.low ?? deck.liveLow
    const breakdown = findBreakdown(low, ENV_RATE, duration, outro)
    const rec = lib.recordFromDeck(deck, facts)
    this.now = {
      id, deck: deck.id, title: track.title, artist: track.artist,
      genre: track.genre || track.genres?.[0] || stored?.genre, year: track.year || stored?.year,
      bpm, camelot: deck.musicalKey?.camelot ?? stored?.camelot ?? null,
      energy: facts?.energy ?? stored?.energy ?? null,
      density: rec?.density ?? stored?.density ?? null,
      durationSec: duration, positionSec: deck.time,
      firstBeat: deck.firstBeat,
      breakdownSec: breakdown ?? outro,
      outroStartSec: outro,
    }
    this.direction = directionFor(this.floor.get(), this.now.energy)
    this.dirSince = performance.now()
    await this.refresh(false)
  }

  /** Ask for fresh picks (force: skip anything made ahead). */
  async refresh(force = true): Promise<void> {
    const now = this.now
    if (!now) return
    const seq = ++this.seq
    const fsig = filterSig(this.filter)
    const made = this.aheadResults.get(`${now.id}|${fsig}`)
    if (!force && made && Date.now() - made.at < AHEAD_TTL) {
      this.publish({ ...made.s, forId: now.id }, made.s.picks.map(p => p.entry))
      return
    }
    this.status = 'querying'; this.error = ''; this.emit()
    const cachedPool = this.aheadPools.get(now.id)
    const pool = !force && cachedPool && cachedPool.filter === fsig && Date.now() - cachedPool.at < AHEAD_TTL
      ? cachedPool.pool
      : await this.queryPool(now, this.direction)
    if (seq !== this.seq) return
    this.pool = pool
    this.libraryCount = await lib.count()
    if (pool.length < 3) {
      const s = this.offline(now, pool)
      this.error = pool.length ? `Only ${pool.length} compatible track${pool.length > 1 ? 's' : ''} in the library (BPM ±6 %, harmonic key)` : 'No compatible tracks in the library yet (BPM ±6 %, harmonic key) — load or browse more music so it is measured'
      this.publish(s, pool, 'error')
      return
    }
    this.status = 'thinking'; this.emit()
    const s = await this.ask(now, pool, this.direction).catch((e: any) => { this.error = e?.message || String(e); return null })
    if (seq !== this.seq) return
    this.publish(s ?? this.offline(now, pool), pool)
  }

  private queryPool(now: { id: string; bpm: number; camelot: string | null; year?: number; density: number | null; energy: number | null }, dir: Direction, exclude: string[] = []): Promise<PoolEntry[]> {
    return lib.query({
      bpm: now.bpm, camelot: now.camelot, year: now.year ?? null, density: now.density, energy: now.energy,
      direction: directionSign(dir), pivots: this.pivots, filter: this.filter,
      excludeIds: [now.id, ...exclude, ...this.decks.filter(d => d.track).map(d => trackId(d.track!))],
    })
  }

  /** The model call: payload in, validated picks out. */
  private async ask(now: NowTrack, pool: PoolEntry[], dir: Direction): Promise<Suggestion> {
    const msgs = buildMessages({ now, floor: { energy: this.floor.get() ?? now.energy ?? 0.5, direction: dir }, filter: this.filter, pool })
    const r = await ai()?.json(msgs, suggestionSchema(pool.map(p => p.id)))
    if (!r?.ok) throw new Error(r?.error || 'The local model did not answer')
    const json = extractJson(r.content)
    if (!json) throw new Error('The local model did not return JSON')
    const p = parseSuggestion(json, pool, dir)
    if (!p.fromModel) throw new Error('The local model picked no track from the pool')
    return { forId: now.id, picks: p.picks, mashup: p.mashup, fx: p.fx, direction: dir, provider: r.provider, model: r.model, at: Date.now() }
  }

  /** Library ranking alone, when the model is unavailable. */
  private offline(now: NowTrack, pool: PoolEntry[]): Suggestion {
    const p = parseSuggestion(null, pool, this.direction)
    return { forId: now.id, picks: p.picks, mashup: p.mashup, fx: p.fx, direction: this.direction, provider: 'library', at: Date.now() }
  }

  private publish(s: Suggestion, pool: PoolEntry[], status: SuggestStatus = 'ready'): void {
    const now = this.now
    if (!now || s.forId !== now.id) return
    this.result = s
    if (!this.pool.length) this.pool = pool
    this.ordered = reindex(s.picks, this.direction, now.energy)
    this.history = [...this.history, { now: { ...now }, result: s, ordered: this.ordered, pool: this.pool }].slice(-20)
    this.viewing = this.history.length - 1
    this.status = status === 'error' && s.picks.length ? 'ready' : status
    this.aheadFor = ''
    this.aheadResultFor = ''
    // Remember what the model said, for the next time these songs come up.
    if (s.provider !== 'library') {
      for (const p of s.picks) lib.enrich(p.entry.id, p.entry.title, { rationale: p.rationale, energyRating: p.energyRating, cues: p.cues, loop: p.loop ?? undefined, after: `${now.artist ? `${now.artist} – ` : ''}${now.title}` })
    }
    this.emit()
  }

  // ── queue-ahead ──
  private queueAhead(progress: number): void {
    const now = this.now
    const picks = this.ordered
    if (!now || !picks.length || this.status === 'querying' || this.status === 'thinking') return
    if (progress >= AHEAD_POOLS_AT && this.aheadFor !== now.id) {
      this.aheadFor = now.id
      const top = picks.slice(0, 3)
      this.ahead = top.map(p => p.entry.id)
      const fsig = filterSig(this.filter)
      void factsCache.load(this.ahead)
      for (const p of top) {
        const r = p.entry.record
        if (!r.bpm) continue
        void this.queryPool({ id: r.id, bpm: r.bpm, camelot: r.camelot, year: r.year, density: r.density, energy: r.energy }, this.direction, [now.id])
          .then(pool => { this.aheadPools.set(r.id, { pool, filter: fsig, at: Date.now() }); this.prune() })
        // Cover art and the file's registration, so the deck loads without a wait.
        void lib.trackFor(r).then(t => t && withDeckCover(t)).catch(() => {})
      }
      this.emit()
    }
    // One model call at a time: a CPU-only machine answers two at half speed each.
    if (progress >= AHEAD_RESULT_AT && this.aheadResultFor !== now.id && !this.inflightAhead) {
      const next = picks[0].entry
      const pool = this.aheadPools.get(next.id)?.pool
      // The pick's pool is still being fetched: try again on the next tick.
      if (!pool) return
      this.aheadResultFor = now.id
      if (pool.length < 3 || !next.bpm) return
      const r = next.record
      const future: NowTrack = {
        id: next.id, deck: now.deck, title: next.title, artist: next.artist, genre: next.genre, year: next.year,
        bpm: next.bpm, camelot: next.camelot, energy: next.energy, density: next.density,
        durationSec: next.durationSec, positionSec: 0, firstBeat: (r.introEndSec || 0) % (60 / next.bpm),
        breakdownSec: (r.outroStartSec || next.durationSec * 0.85), outroStartSec: r.outroStartSec || next.durationSec * 0.85,
      }
      this.inflightAhead = true
      void this.ask(future, pool, this.direction)
        .then(s => { this.aheadResults.set(`${next.id}|${filterSig(this.filter)}`, { s, at: Date.now() }); this.prune() })
        .catch(() => { /* made live when the song comes on instead */ })
        .finally(() => { this.inflightAhead = false })
    }
  }

  private prune(): void {
    const old = Date.now() - AHEAD_TTL
    for (const [k, v] of this.aheadPools) if (v.at < old || this.aheadPools.size > 12) this.aheadPools.delete(k)
    for (const [k, v] of this.aheadResults) if (v.at < old || this.aheadResults.size > 6) this.aheadResults.delete(k)
  }

  // ── history ──
  get canPrev(): boolean { return this.viewing > 0 }
  get canNext(): boolean { return this.viewing >= 0 && this.viewing < this.history.length - 1 }
  /** The track the suggestions on screen were made for (an earlier one when paging back). */
  get shownFor(): NowTrack | null { return this.history[this.viewing]?.now ?? this.now }

  /** Page through earlier suggestion sets (-1 back, +1 forward). */
  step(dir: -1 | 1): void {
    const i = this.viewing + dir
    const h = this.history[i]
    if (!h) return
    this.viewing = i
    this.result = h.result
    this.ordered = i === this.history.length - 1 && this.now?.id === h.now.id ? reindex(h.result.picks, this.direction, this.now.energy) : h.ordered
    this.pool = h.pool
    this.emit()
  }

  // ── controls ──
  setFloor(v: number | null): void {
    if (v == null) this.floor.clear(); else this.floor.push(v, 'manual')
    this.emit()
  }

  async setFloorFeed(on: boolean): Promise<void> {
    const r = await floorApi()?.setFeed(on).catch((e: any) => ({ on: false, port: 0, error: String(e?.message || e) }))
    this.floorFeed = { on: !!r?.on, port: r?.port ?? 0, error: r?.error ?? '' }
    this.emit()
  }

  setPivots(on: boolean): void { this.pivots = on; this.aheadPools.clear(); void this.refresh(true) }

  setFilter(f: CandidateFilter | null): void {
    this.filter = f && Object.keys(f).length ? f : null
    this.aheadPools.clear()
    void this.refresh(true)
  }

  /** The deck a pick goes to: the free one across the mixer from the music on air. */
  private targetDeck(): Deck | null {
    const { A, B } = this.deps.engine.decks
    const live = onAir(this.deps.engine)
    const other = live?.id === 'A' || live?.id === 'C' ? B : A
    return !other.active && !other.held ? other : null
  }

  async load(pick: Pick, deckId?: DeckId): Promise<void> {
    const deck = deckId ? this.deps.engine.decks[deckId] : this.targetDeck()
    if (!deck || deck.active || deck.held) { this.deps.say('No free deck — let the playing song finish or stop one first'); return }
    const t = await lib.trackFor(pick.entry.record)
    if (!t) { this.deps.say(`${pick.entry.title} is no longer in the library`); return }
    this.pendingCues.set(trackId(t), pick)
    this.incomingPick = pick
    await deck.load(await withDeckCover(t))
    if (deck.error) this.deps.say(`Couldn't load ${t.title}: ${deck.error}`)
  }

  async mix(pick: Pick): Promise<void> {
    const t = await lib.trackFor(pick.entry.record)
    if (!t) { this.deps.say(`${pick.entry.title} is no longer in the library`); return }
    this.pendingCues.set(trackId(t), pick)
    this.incomingPick = pick
    void this.deps.mixer.mixNow(await withDeckCover(t))
  }

  /** Cues, loop and era/density trim onto the deck that now holds the pick (hot cue pads 1–3). */
  private applyPendingCues(): void {
    if (!this.pendingCues.size) return
    for (const d of this.decks) {
      if (!d.track || d.loading || !d.duration) continue
      const pick = this.pendingCues.get(trackId(d.track))
      if (!pick) continue
      this.pendingCues.delete(trackId(d.track))
      this.applyCues(pick, d)
    }
  }

  applyCues(pick: Pick, d: Deck): void {
    pick.cues.slice(0, d.hotCues.length).forEach((c, i) => d.setHotCueAt(i, c.ms / 1000))
    if (pick.loop) d.setLoopRegion(pick.loop.startMs / 1000, pick.loop.endMs / 1000, false)
    if (pick.gainTrimDb) d.setGainKnob(Math.max(0, Math.min(1, 0.5 + pick.gainTrimDb / 24)))
    this.deps.say(`Deck ${d.id}: cues ${pick.cues.map(c => `${c.label} ${fmtMs(c.ms)}`).join(' · ')}`)
  }

  /** Arm the FX macro on the playing deck, timed from its breakdown (or the next phrase when that has passed). */
  armFx(): void {
    const now = this.now, s = this.result
    if (!now || !s) return
    if (s.forId !== now.id) { this.deps.say('That macro was made for an earlier track — go forward to the latest suggestions'); return }
    const deck = this.deps.engine.decks[now.deck]
    const beat = deck.beatLen
    const lead = Math.min(0, ...s.fx.map(f => f.atBeat)) * beat
    const phrase = PHRASE_BEATS * beat
    const nextPhrase = now.firstBeat + Math.ceil((deck.time - now.firstBeat) / phrase + 1) * phrase
    const anchor = [now.breakdownSec, now.outroStartSec, nextPhrase - lead].find(a => a + lead > deck.time + beat) ?? nextPhrase - lead
    const n = this.fx.arm(deck, s.fx, anchor)
    this.deps.say(n ? `FX macro armed on deck ${deck.id} at ${fmtMs(anchor * 1000)}` : 'The FX macro has nothing left to play on this song')
    this.emit()
  }
  disarmFx(): void { this.fx.disarm(); this.emit() }

  setAutoStems(on: boolean): void { this.stems.enabled = on; if (!on) this.stems.restore(); this.emit() }

  /** Three-deck layering: the mashup pair on decks C and D, synced to the music on air, faders down. */
  async mashup(): Promise<void> {
    const m = this.result?.mashup
    const live = onAir(this.deps.engine)
    if (!m || !live) return
    const { C, D } = this.deps.engine.decks
    if (C.active || D.active) { this.deps.say('Decks C and D are playing — stop them first'); return }
    const [a, b] = await Promise.all(m.entries.map(e => lib.trackFor(e.record)))
    if (!a || !b) { this.deps.say('A mashup track is no longer in the library'); return }
    await Promise.all([C.load(a), D.load(b)])
    for (const d of [C, D]) { d.setVolume(0); await d.play(); d.sync(live, true) }
    // The first is the vocal layer, the second the rhythm under it.
    C.soloStem('acapella')
    D.setStem('bass', false)
    this.mashupOn = ['C', 'D']
    this.deps.say(`Mashup on C (acapella) + D (no bass) — raise their faders to layer`)
    this.emit()
  }
  stopMashup(): void {
    const { C, D } = this.deps.engine.decks
    for (const d of [C, D]) { d.pause(); d.setVolume(1) }
    if (!(C.stems.vocal && C.stems.instru)) C.soloStem('acapella')
    if (!D.stems.bass) D.setStem('bass', true)
    this.mashupOn = null
    this.emit()
  }

  // ── voice ──
  sttUrl = ''
  async loadSttUrl(): Promise<void> {
    const s = await ai()?.settings?.get().catch(() => null)
    if (s?.sttUrl) { this.sttUrl = s.sttUrl; this.emit() }
  }
  async setSttUrl(url: string): Promise<void> {
    const s = await ai()?.settings?.set({ sttUrl: url.trim() }).catch(() => null)
    if (s?.sttUrl) this.sttUrl = s.sttUrl
    this.voice = { ...this.voice, error: '' }
    this.emit()
  }

  async voiceStart(): Promise<void> {
    if (this.recorder.recording) return
    try {
      await this.recorder.start()
      this.voice = { listening: true, busy: false, transcript: '', error: '' }
    } catch (e: any) {
      this.voice = { ...this.voice, listening: false, error: e?.name === 'NotAllowedError' ? 'Microphone access was refused' : 'No microphone available' }
    }
    this.emit()
  }

  async voiceStop(): Promise<void> {
    const wav = await this.recorder.stop()
    this.voice = { ...this.voice, listening: false, busy: !!wav }
    this.emit()
    if (!wav) return
    try {
      const { transcript, result } = await interpret(wav, this.now ? { bpm: this.now.bpm, camelot: this.now.camelot } : null)
      this.voice = { listening: false, busy: false, transcript, error: '' }
      if (result.direction && result.direction !== 'hold') this.setFloor(Math.max(0, Math.min(1, (this.now?.energy ?? 0.5) + directionSign(result.direction) * 0.25)))
      this.setFilter(result.clear ? null : { ...(this.filter ?? {}), ...result.filter })
    } catch (e: any) {
      this.voice = { listening: false, busy: false, transcript: '', error: e?.message || String(e) }
      this.emit()
    }
  }
}

export function fmtMs(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}
