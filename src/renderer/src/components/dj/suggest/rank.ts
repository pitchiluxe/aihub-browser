// The vibe check: floor energy against the playing track's energy decides
// whether the set steps up, holds or cools down, and the three picks are
// re-ordered for it on the spot — no new model call needed.
import type { Direction, Pick } from './types'

/** Below this gap the floor and the track agree: hold. */
const DEADBAND = 0.1

export function directionFor(floor: number | null, trackEnergy: number | null): Direction {
  if (floor == null || trackEnergy == null) return 'hold'
  const d = floor - trackEnergy
  return d > DEADBAND ? 'step_up' : d < -DEADBAND ? 'cool_down' : 'hold'
}

export const directionSign = (d: Direction): number => (d === 'step_up' ? 1 : d === 'cool_down' ? -1 : 0)

const LIFT: Record<string, number> = { 'diagonal-up': 1, boost: 1, semitone: 1, 'diagonal-down': -1, parallel: -0.5 }

/**
 * Re-index the picks for the direction: the model's order counts (first is
 * worth most), then how far each pick's energy moves the way the floor wants,
 * and whether its key move lifts or drops.
 */
export function reindex(picks: Pick[], direction: Direction, trackEnergy: number | null): Pick[] {
  const sign = directionSign(direction)
  const cur = trackEnergy ?? 0.5
  const scored = picks.map((p, i) => {
    const e = p.entry.energy ?? p.energyRating / 10
    const move = e - cur
    const fit = sign === 0 ? -Math.abs(move) : sign * move
    return { p, s: (picks.length - i) * 0.4 + fit * 3 + sign * (LIFT[p.entry.relation] ?? 0) * 0.3 }
  })
  return scored.sort((a, b) => b.s - a.s).map(x => x.p)
}

/** Two keys that sit together (same, ±1, relative) — for layering two tracks at once. */
export function compatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const pa = /^(\d+)([AB])$/.exec(a), pb = /^(\d+)([AB])$/.exec(b)
  if (!pa || !pb) return false
  const na = Number(pa[1]), nb = Number(pb[1])
  const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12)
  return pa[2] === pb[2] ? d <= 1 : d === 0
}

/**
 * Floor energy smoothed over readings: an external meter can report every
 * second, a DJ's slider once in a while; either way a single spike must not
 * swing the set. Readings older than `staleMs` stop counting.
 */
export class FloorMeter {
  private value: number | null = null
  private at = 0
  source: string | null = null
  constructor(private staleMs = 5 * 60_000, private now: () => number = Date.now) {}
  push(v: number, source: string): void {
    const x = Math.max(0, Math.min(1, v))
    const t = this.now()
    // A hand on the slider is taken as is; meters are smoothed.
    this.value = source === 'manual' || this.value == null || t - this.at > this.staleMs ? x : this.value * 0.7 + x * 0.3
    this.at = t
    this.source = source
  }
  clear(): void { this.value = null; this.source = null }
  /** The DJ's own setting holds until changed; a meter that went quiet stops counting. */
  get(): number | null {
    if (this.value == null) return null
    return this.source === 'manual' || this.now() - this.at <= this.staleMs ? this.value : null
  }
}
