/**
 * Automix — the hands-free DJ. Pulls the next song from a source (the
 * sidelist, then the YouTube queue), cues it on the idle deck well before
 * the playing song ends, beat-matches when both tempos are known and blends
 * across with the crossfader. "Mix now" does the same transition on demand.
 *
 * It respects the DJ: while a hand is on a record, or a song has been paused
 * part-way through, Automix waits instead of loading over it.
 */
import { planTransition, TransitionFx } from './transitionFx'
import { Emitter, type Deck, type DeckId, type DjEngine, type DjTrack } from './DjEngine'

/** Start the next song this many seconds before the end. */
const LEAD = 12
/** Load it this much earlier still, so a YouTube player is ready in time. */
const PRELOAD = 30
const TICK_MS = 150

export interface AutoMixerHooks {
  /** Next song to play, removed from wherever it came from; undefined when there is none. */
  next(): DjTrack | undefined
  /** A deck was loaded by Automix (true) or Mix now (false). */
  loaded(deck: DeckId, auto: boolean): void
  say(msg: string): void
  /** A song is about to come in — the moment for a voice drop. */
  mixing?(track: DjTrack): void
}

export class AutoMixer extends Emitter {
  on = false
  /** Crossfade length, seconds. */
  fadeSeconds = 10
  /** Bass swaps and filter sweeps during blends, chosen from the two songs' tempos. */
  proTransitions = true
  private fx: TransitionFx | null = null
  /** The song each deck finished (or was faded out of) — free to be replaced. */
  private spent = new Map<DeckId, DjTrack>()
  private loadingNext = false
  private transition: { from: DeckId; to: DeckId } | null = null
  private timer = 0

  constructor(private engine: DjEngine, private hooks: AutoMixerHooks) { super() }

  setOn(on: boolean): void {
    if (on === this.on) return
    this.on = on
    window.clearInterval(this.timer)
    this.timer = 0
    if (on) this.timer = window.setInterval(() => this.tick(), TICK_MS)
    this.emit()
  }
  setProTransitions(on: boolean): void { this.proTransitions = on; this.emit() }
  setFadeSeconds(s: number): void { this.fadeSeconds = Math.max(2, Math.min(30, s)); this.emit() }

  get busy(): boolean { return !!this.transition || this.loadingNext }

  private other(d: Deck): Deck { return d.id === 'A' ? this.engine.decks.B : this.engine.decks.A }
  private side(id: DeckId): number { return id === 'A' ? 0 : 1 }

  /** Blend from whatever is playing into `track` right now. */
  async mixNow(track: DjTrack, seconds = Math.min(this.fadeSeconds, 6)): Promise<boolean> {
    const { A, B } = this.engine.decks
    const live = A.active ? A : B.active ? B : null
    const target = live ? this.other(live) : A
    if (target.active || target.held) { this.hooks.say('Both decks are busy — pause one first'); return false }
    if (this.transition) { this.hooks.say('Still mixing the last song — one moment'); return false }
    this.hooks.say(`Mixing in ${track.title}…`)
    await target.load(track)
    this.hooks.loaded(target.id, false)
    if (target.error) { this.hooks.say(target.error); return false }
    await this.blendInto(target, seconds)
    return true
  }

  private async blendInto(target: Deck, seconds: number): Promise<void> {
    const live = this.other(target)
    if (target.track) this.hooks.mixing?.(target.track)
    if (!live.active) {
      this.engine.setCrossfader(this.side(target.id))
      await target.play()
      return
    }
    const plan = this.proTransitions
      ? planTransition(live.bpm, target.bpm, seconds)
      : { style: 'blend' as const, seconds, sync: true }
    if (plan.sync) target.sync(live)
    if (target.time < 1 && target.gridKnown && plan.sync) target.seek(Math.max(0, target.firstBeat))
    // EQ / filter positions must be set before the new song makes a sound.
    this.fx?.finish()
    this.fx = null
    if (this.proTransitions) {
      this.fx = new TransitionFx(this.engine, live, target, plan)
      this.fx.prepare()
    }
    await target.play()
    this.transition = { from: live.id, to: target.id }
    this.engine.fadeTo(this.side(target.id), plan.seconds)
    this.fx?.run()
    this.emit()
  }

  private tick(): void {
    const { A, B } = this.engine.decks
    if (A.held || B.held) return

    // Finishing a blend: once the fader has crossed, stop the outgoing deck.
    if (this.transition) {
      if (this.engine.fading) return
      const from = this.engine.decks[this.transition.from]
      from.pause()
      if (from.track) this.spent.set(from.id, from.track)
      this.transition = null
      this.emit()
      return
    }

    const isSpent = (d: Deck) => !d.track || !!d.error || this.spent.get(d.id) === d.track ||
      (d.duration > 0 && d.time > d.duration - 2)
    const live = A.playing ? A : B.playing ? B : null
    if (!live) {
      // The DJ paused a song part-way: wait for them rather than load over it.
      const parked = [A, B].find(d => !isSpent(d) && !d.active && d.time > 1)
      if (parked || A.active || B.active || A.loading || B.loading || this.loadingNext) return
      const ready = [A, B].find(d => !isSpent(d) && d.time < 1 && !d.active)
      if (ready) {
        this.engine.setCrossfader(this.side(ready.id))
        void ready.play()
        return
      }
      const t = this.hooks.next()
      if (!t) { this.setOn(false); this.hooks.say('Automix finished — nothing left to play'); return }
      const deck = isSpent(A) ? A : B
      this.loadingNext = true
      void deck.load(t).then(() => {
        this.loadingNext = false
        this.hooks.loaded(deck.id, true)
        if (deck.error) { this.hooks.say(`Skipped ${t.title}: ${deck.error}`); deck.eject() }
      })
      return
    }

    const other = this.other(live)
    if (!live.duration || other.active || other.held) return
    const left = (live.duration - live.time) / Math.max(0.25, live.rate)

    // Cue the next song early so it is loaded (and analysed) by the time it
    // is needed. A song the DJ put on the other deck themselves goes next.
    if (left < LEAD + PRELOAD && !this.loadingNext && isSpent(other)) {
      const t = this.hooks.next()
      if (t) {
        this.loadingNext = true
        void other.load(t).then(() => {
          this.loadingNext = false
          this.hooks.loaded(other.id, true)
          if (other.error) { this.hooks.say(`Skipped ${t.title}: ${other.error}`); other.eject() }
        })
      }
      return
    }

    if (left < LEAD && !isSpent(other) && !other.loading && !this.loadingNext) {
      void this.blendInto(other, Math.min(this.fadeSeconds, Math.max(2, left - 1)))
    }
  }

  dispose(): void { this.fx?.finish(); this.setOn(false) }
}
