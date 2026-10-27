// Smart FX macros: the model's timed steps (beats from the breakdown) played on
// the deck through the same calls the FX buttons and filter knob make. Driven by
// the engine clock, so the moves land on the beat at any tempo.
import type { Deck } from '../engine/DjEngine'
import type { FxStep } from './types'

interface Ramp { from: number; to: number; start: number; end: number; apply: (v: number) => void }

export interface FxPlan { atSec: number; step: FxStep }

/** Steps → absolute song times on a deck's beat grid. */
export function schedule(steps: FxStep[], anchorSec: number, beatSec: number): FxPlan[] {
  return steps.map(step => ({ atSec: anchorSec + step.atBeat * beatSec, step })).sort((a, b) => a.atSec - b.atSec)
}

export class FxRunner {
  private plan: FxPlan[] = []
  private next = 0
  private ramps: Ramp[] = []
  private deck: Deck | null = null
  private trackToken = ''
  private endSec = 0
  armed = false

  /** Arm a macro on `deck`, anchored on `anchorSec` (the breakdown). Steps already in the past are skipped. */
  arm(deck: Deck, steps: FxStep[], anchorSec: number): number {
    this.disarm()
    const beat = deck.beatLen
    this.plan = schedule(steps, anchorSec, beat)
    this.next = this.plan.findIndex(p => p.atSec >= deck.time)
    if (this.next < 0 || !deck.track) { this.plan = []; return 0 }
    this.deck = deck
    this.trackToken = deck.track.token
    const last = this.plan[this.plan.length - 1]
    this.endSec = last.atSec + last.step.beats * beat + beat
    this.armed = true
    return this.plan.length - this.next
  }

  /** Stop the macro and leave the deck as the DJ would expect: filter open, effect off. */
  disarm(): void {
    if (this.armed && this.deck) {
      this.deck.setFilterKnob(0.5)
      if (this.deck.fxOn) this.deck.setFxOn(false)
    }
    this.armed = false
    this.deck = null
    this.plan = []
    this.ramps = []
  }

  /** Called on the engine clock. */
  tick(): void {
    const d = this.deck
    if (!this.armed || !d) return
    // A new song on the deck, or a jump back before the macro: it no longer applies.
    if (d.track?.token !== this.trackToken) { this.armed = false; this.deck = null; return }
    const t = d.time
    while (this.next < this.plan.length && t >= this.plan[this.next].atSec) this.fire(d, this.plan[this.next++], t)
    this.ramps = this.ramps.filter(r => {
      const k = r.end <= r.start ? 1 : Math.max(0, Math.min(1, (t - r.start) / (r.end - r.start)))
      r.apply(r.from + (r.to - r.from) * k)
      return k < 1
    })
    if (this.next >= this.plan.length && !this.ramps.length && t > this.endSec) { this.armed = false; this.deck = null }
  }

  private fire(d: Deck, p: FxPlan, t: number): void {
    const { step } = p
    const dur = step.beats * d.beatLen
    if (step.fx === 'filter' && step.action !== 'on' && step.action !== 'off') {
      this.ramps.push({ from: d.filterKnob, to: step.value, start: t, end: t + dur, apply: v => d.setFilterKnob(v) })
      return
    }
    if (step.fx === 'filter' && step.action === 'off') { d.setFilterKnob(0.5); return }
    if (step.fx === 'filter') { d.setFilterKnob(step.value); return }
    if (step.action === 'off') { if (d.fxType === step.fx) d.setFxOn(false); return }
    d.setFxType(step.fx)
    if (step.action === 'sweep') {
      if (!d.fxOn) { d.setFxStrength(0); d.setFxOn(true) }
      this.ramps.push({ from: d.fxStrength, to: step.value, start: t, end: t + dur, apply: v => d.setFxStrength(v) })
      return
    }
    d.setFxStrength(step.value)
    d.setFxOn(true)
  }
}
