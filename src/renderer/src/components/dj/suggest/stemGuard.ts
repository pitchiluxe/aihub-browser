// Intelligent stem triggering: while two decks are heard together, listen to
// both for clashing vocals or overlapping basslines and isolate stems to clear
// the clash — the instrumental of one track, or the bass of the incoming one —
// then give both tracks back their full sound when the blend is over.
import type { Deck } from '../engine/DjEngine'
import type { StemPlan } from './types'

export interface Levels { vocal: number; bass: number }
export type Clash = { vocal: boolean; bass: boolean }

/** Both above these for a moment = both carrying the band. */
const VOCAL_ON = 0.6
const BASS_ON = 0.62
/** Readings (100 ms apart) a clash must last before acting — a single hit is not a clash. */
const HOLD = 8

export function clashOf(out: Levels, inc: Levels): Clash {
  return { vocal: out.vocal >= VOCAL_ON && inc.vocal >= VOCAL_ON, bass: out.bass >= BASS_ON && inc.bass >= BASS_ON }
}

export interface StemAction { deck: 'incoming' | 'outgoing'; isolate: 'instrumental' | 'acapella' | null; killBass: boolean }

/** What to do about a clash, following the plan the model gave for this pick. */
export function decide(c: Clash, plan: StemPlan | null): StemAction | null {
  if (!c.vocal && !c.bass) return null
  const deck = plan?.deck ?? 'incoming'
  const isolate = c.vocal ? (plan && plan.isolate !== 'none' ? plan.isolate : 'instrumental') : null
  // An acapella has no bass left to clash; otherwise the incoming bass waits for the swap.
  return { deck, isolate, killBass: c.bass && isolate !== 'acapella' }
}

export class StemGuard {
  enabled = false
  private main: Deck | null = null
  private streak = 0
  private acted: { deck: Deck; isolate: 'instrumental' | 'acapella' | null; bassDeck: Deck | null } | null = null
  private lastRead = 0
  /** Last thing done, for the panel. */
  status = ''

  constructor(private plan: () => StemPlan | null, private say: (m: string) => void) {}

  tick(decks: Deck[], now = performance.now()): void {
    if (now - this.lastRead < 100) return
    this.lastRead = now
    const heard = decks.filter(d => d.track && d.audible())
    if (heard.length < 2) {
      if (heard.length === 1) this.main = heard[0]
      this.restore()
      this.streak = 0
      return
    }
    if (!this.enabled || this.acted) return
    const out = this.main && heard.includes(this.main) ? this.main : heard[0]
    const inc = heard.find(d => d !== out)!
    const c = clashOf(out.bandLevels(), inc.bandLevels())
    this.streak = c.vocal || c.bass ? this.streak + 1 : 0
    if (this.streak < HOLD) return
    const a = decide(c, this.plan())
    if (!a) return
    const deck = a.deck === 'incoming' ? inc : out
    if (a.isolate) deck.soloStem(a.isolate)
    if (a.killBass) inc.setStem('bass', false)
    this.acted = { deck, isolate: a.isolate, bassDeck: a.killBass ? inc : null }
    this.status = [a.isolate ? `${a.isolate} on deck ${deck.id}` : '', a.killBass ? `bass held on deck ${inc.id}` : ''].filter(Boolean).join(' · ')
    this.say(`Stems: ${this.status}`)
  }

  /** The blend is over: both tracks whole again. */
  restore(): void {
    const a = this.acted
    if (!a) return
    this.acted = null
    if (a.isolate && !(a.deck.stems.vocal && a.deck.stems.instru)) a.deck.soloStem(a.isolate)
    if (a.bassDeck && !a.bassDeck.stems.bass) a.bassDeck.setStem('bass', true)
    this.status = ''
  }
}
