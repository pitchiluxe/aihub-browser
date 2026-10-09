/**
 * Pro transitions — what a good DJ does with the EQ and filter during a blend,
 * done for them:
 *
 *  blend  – tempos match: swap the basslines (the incoming song's low end stays
 *           out until the halfway point, then the outgoing song's drops away),
 *           so two kicks and two basses never fight.
 *  filter – tempos are too far apart to lock: sweep the outgoing song out through
 *           a high-pass while the incoming song opens up from a low-pass.
 */
import type { Deck, DjEngine } from './DjEngine'

export type TransitionStyle = 'blend' | 'filter'

export interface TransitionPlan {
  style: TransitionStyle
  /** Crossfade length, seconds. */
  seconds: number
  /** Whether the incoming song should be tempo-synced to the outgoing one. */
  sync: boolean
}

/** Tempos within this fraction of each other (after folding half/double time) can be locked. */
const LOCKABLE = 0.07

/** How far apart two tempos are as a fraction, treating half- and double-time as the same. */
export function tempoGap(a: number | null, b: number | null): number | null {
  if (!a || !b) return null
  let r = b / a
  while (r > 1.41) r /= 2
  while (r < 0.71) r *= 2
  return Math.abs(r - 1)
}

export function planTransition(outBpm: number | null, inBpm: number | null, fadeSeconds: number): TransitionPlan {
  const gap = tempoGap(outBpm, inBpm)
  if (gap !== null && gap <= LOCKABLE) return { style: 'blend', seconds: fadeSeconds, sync: true }
  // Tempos unknown or far apart: a long blend would sound like a train crash, so go shorter.
  return { style: 'filter', seconds: Math.min(fadeSeconds, gap === null ? 8 : 6), sync: false }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export interface FxBase { outLow: number; inLow: number; outFilter: number; inFilter: number }
export interface FxValues { outLow: number; inLow: number; outFilter: number; inFilter: number }

/** Knob positions (0..1) for the outgoing and incoming deck at progress `p` of the blend. */
export function fxAt(style: TransitionStyle, p: number, base: FxBase): FxValues {
  if (style === 'blend') {
    const s = smooth(0.42, 0.58, p)
    return { outLow: lerp(base.outLow, 0, s), inLow: lerp(0, base.inLow, s), outFilter: base.outFilter, inFilter: base.inFilter }
  }
  return {
    outLow: base.outLow, inLow: base.inLow,
    // Past 0.5 the outgoing filter is a high-pass closing down; the incoming one opens from muffled.
    outFilter: lerp(base.outFilter, 0.96, smooth(0.05, 0.95, p)),
    inFilter: lerp(0.1, base.inFilter, smooth(0.0, 0.8, p)),
  }
}

/** Where each knob must sit before the incoming deck makes a sound. */
export function fxStart(style: TransitionStyle, base: FxBase): FxValues { return fxAt(style, 0, base) }

/** Drives the EQ / filter of the two decks for the length of one crossfade, then puts everything back. */
export class TransitionFx {
  private base: FxBase
  private timer = 0
  private startedAt = 0
  private done = false

  constructor(private engine: DjEngine, private out: Deck, private into: Deck, private plan: TransitionPlan) {
    this.base = { outLow: out.eq.low, inLow: into.eq.low, outFilter: out.filterKnob, inFilter: into.filterKnob }
  }

  /** Does this pair of decks respond to EQ / filter at all? (A YouTube deck that could not be captured does not.) */
  get usable(): boolean { return this.out.fullControl && this.into.fullControl }

  /** Set the opening positions. Call before the incoming deck starts playing. */
  prepare(): void {
    if (!this.usable) return
    this.apply(fxStart(this.plan.style, this.base))
  }

  /** Follow the crossfade. Call right after it is started. */
  run(): void {
    if (!this.usable) return
    this.startedAt = performance.now()
    this.timer = window.setInterval(() => this.step(), 40)
  }

  private step(): void {
    const p = Math.min(1, (performance.now() - this.startedAt) / (this.plan.seconds * 1000))
    // The DJ took the crossfader (or the fade ended): hand everything back.
    if ((!this.engine.fading && performance.now() - this.startedAt > 250) || p >= 1) { this.finish(); return }
    this.apply(fxAt(this.plan.style, p, this.base))
  }

  private apply(v: FxValues): void {
    if (this.out.eq.low !== v.outLow) this.out.setEq('low', v.outLow)
    if (this.into.eq.low !== v.inLow) this.into.setEq('low', v.inLow)
    if (this.out.filterKnob !== v.outFilter) this.out.setFilterKnob(v.outFilter)
    if (this.into.filterKnob !== v.inFilter) this.into.setFilterKnob(v.inFilter)
  }

  finish(): void {
    if (this.done) return
    this.done = true
    window.clearInterval(this.timer)
    if (!this.usable) return
    this.apply({ ...this.base })
  }
}
