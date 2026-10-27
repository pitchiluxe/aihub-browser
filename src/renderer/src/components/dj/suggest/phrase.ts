// Structural phrase metrics: the 16-beat grid cues and loops snap to, where a
// song breaks down, and how dense its master is.

export const PHRASE_BEATS = 16

/**
 * Phrase starts in milliseconds, from a downbeat `anchorSec` outwards, over the
 * playable part of the song (up to `max` of them, spread evenly when there are more).
 */
export function phraseGrid(bpm: number, anchorSec: number, durationSec: number, max = 16): number[] {
  if (!(bpm > 0) || !(durationSec > 0)) return []
  const phrase = (PHRASE_BEATS * 60) / bpm
  let t = anchorSec % phrase
  const out: number[] = []
  for (; t < durationSec - phrase / 2; t += phrase) out.push(Math.round(t * 1000))
  if (out.length <= max) return out
  const step = (out.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => out[Math.round(i * step)])
}

/** The grid point nearest `ms`; `ms` unchanged when there is no grid. */
export function snapMs(ms: number, grid: readonly number[]): number {
  if (!grid.length || !Number.isFinite(ms)) return Math.max(0, Math.round(ms) || 0)
  let best = grid[0]
  for (const g of grid) if (Math.abs(g - ms) < Math.abs(best - ms)) best = g
  return best
}

/**
 * Where the song strips back: the biggest sustained fall in the bass band after
 * the first quarter and before the outro (seconds), or null when the envelope
 * shows none. A breakdown is where a DJ times a filter cut or an echo-out.
 */
export function findBreakdown(low: ArrayLike<number> | null, rate: number, durationSec: number, outroStartSec = 0): number | null {
  if (!low || low.length < rate * 40 || !(durationSec > 0)) return null
  const win = Math.round(rate * 4)
  const before = Math.round(rate * 16)
  const from = Math.max(before, Math.floor(low.length * 0.25))
  const endSec = outroStartSec > durationSec * 0.5 ? outroStartSec : durationSec * 0.9
  const to = Math.min(low.length - win, Math.floor(endSec * rate))
  // Prefix sums make every window average O(1).
  const pre = new Float64Array(low.length + 1)
  for (let i = 0; i < low.length; i++) pre[i + 1] = pre[i] + low[i]
  const avg = (a: number, b: number) => (pre[b] - pre[a]) / Math.max(1, b - a)
  let best = 0, at = -1
  for (let i = from; i < to; i += Math.max(1, Math.round(rate / 4))) {
    const prior = avg(i - before, i)
    if (prior < 0.05) continue
    const drop = (prior - avg(i, i + win)) / prior
    if (drop > best) { best = drop; at = i }
  }
  return best >= 0.35 && at >= 0 ? at / rate : null
}

/** 0..1: average level against the loud peaks. A brick-walled modern master sits high, an older acoustic recording low. */
export function densityOf(amp: ArrayLike<number> | null): number | null {
  if (!amp || amp.length < 500) return null
  const xs: number[] = []
  for (let i = 0; i < amp.length; i += 4) if (amp[i] > 0.01) xs.push(amp[i])
  if (xs.length < 100) return null
  xs.sort((a, b) => a - b)
  const peak = xs[Math.floor(xs.length * 0.99)]
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length
  return peak > 0 ? Math.round(Math.min(1, mean / peak) * 100) / 100 : null
}
