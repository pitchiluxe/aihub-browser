/**
 * Track analysis for AIHub DJ: waveform envelope, tempo and beat phase.
 *
 * Works on a mono signal at any sample rate. The envelope runs at a fixed
 * 100 frames/second so the zoomed waveform, beat grid and loop maths all share
 * one time base regardless of the file's sample rate.
 */

import { detectKey, type MusicalKey } from './key'

export const ENV_RATE = 100 // envelope frames per second

export interface Envelope {
  /** Full-band peak per frame, 0..1. */
  amp: Float32Array
  /** Low-band (kick/bass) peak per frame, 0..1 — drives the waveform colour. */
  low: Float32Array
  rate: number
}

export interface Analysis {
  bpm: number | null
  /** Seconds to the first downbeat of the detected grid. */
  firstBeat: number
  env: Envelope
  /** Musical key read from the audio; null when the music is too ambiguous. */
  key: MusicalKey | null
}

/** Downmix an AudioBuffer-like object to mono. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0].length
  const out = new Float32Array(n)
  const k = 1 / channels.length
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * k
  return out
}

export function buildEnvelope(mono: Float32Array, sampleRate: number): Envelope {
  // Fractional hop: frame f covers [f·hop, (f+1)·hop). Rounding the hop would
  // make the envelope run at e.g. 100.23 fps for 11025 Hz and drift the grid.
  const hop = sampleRate / ENV_RATE
  const frames = Math.ceil(mono.length / hop)
  const amp = new Float32Array(frames)
  const low = new Float32Array(frames)
  // One-pole low-pass at ~150 Hz isolates kick and bass.
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate)
  let lp = 0
  let maxAmp = 1e-9
  let maxLow = 1e-9
  for (let f = 0; f < frames; f++) {
    let pa = 0
    let pl = 0
    const end = Math.min(mono.length, Math.floor((f + 1) * hop))
    for (let i = Math.floor(f * hop); i < end; i++) {
      const s = mono[i]
      lp += a * (s - lp)
      const as = s < 0 ? -s : s
      const al = lp < 0 ? -lp : lp
      if (as > pa) pa = as
      if (al > pl) pl = al
    }
    amp[f] = pa
    low[f] = pl
    if (pa > maxAmp) maxAmp = pa
    if (pl > maxLow) maxLow = pl
  }
  // Normalise so quiet masters still draw a full-height waveform.
  for (let f = 0; f < frames; f++) { amp[f] /= maxAmp; low[f] /= maxLow }
  return { amp, low, rate: ENV_RATE }
}

/** Positive energy change of the low band — where kicks land. */
export function onsetCurve(env: Envelope): Float32Array {
  const src = env.low
  const out = new Float32Array(src.length)
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1] + 0.35 * (env.amp[i] - env.amp[i - 1])
    out[i] = d > 0 ? d : 0
  }
  return out
}

function interp(a: Float32Array, x: number): number {
  const i = Math.floor(x)
  if (i < 0 || i + 1 >= a.length) return 0
  const t = x - i
  return a[i] * (1 - t) + a[i + 1] * t
}

/**
 * Tempo by comb-filtered autocorrelation of the onset curve over 70–180 BPM,
 * with a gentle preference for the 90–140 range dance music lives in so a
 * 64 BPM half-time reading does not win over the real 128.
 *
 * `ceiling`: the fastest tempo the track's genre plausibly has (see
 * tempoCeiling) — a double-time reading above it is folded back down.
 */
export function detectBpm(onset: Float32Array, rate = ENV_RATE, opts: TempoHint = {}): number | null {
  if (onset.length < rate * 8) return null // under 8 s: not enough to judge
  // Analyse at most ~4 minutes from the middle — intros and outros lie.
  const span = Math.min(onset.length, rate * 240)
  const from = Math.floor((onset.length - span) / 2)
  const o = onset.subarray(from, from + span)

  const score = (bpm: number) => {
    const lag = (60 * rate) / bpm
    let s = 0
    for (let i = 0; i + 2 * lag + 1 < o.length; i += 1) {
      const v = o[i]
      if (v === 0) continue
      s += v * (interp(o, i + lag) + 0.5 * interp(o, i + 2 * lag))
    }
    const prior = Math.exp(-Math.pow(Math.log2(bpm / 120), 2) / (2 * 0.5 * 0.5))
    return s * (0.75 + 0.25 * prior)
  }
  // Coarse to fine: every whole BPM first, then tenths around the best few —
  // the same answer as scanning every tenth, at a fraction of the work (this
  // runs while music plays, on the thread that draws the console).
  const coarse: { bpm: number; s: number }[] = []
  for (let bpm = 70; bpm <= 180; bpm += 1) coarse.push({ bpm, s: score(bpm) })
  coarse.sort((a, b) => b.s - a.s)
  let best = 0
  let bestBpm = 0
  for (const c of coarse.slice(0, 3)) {
    for (let bpm = Math.max(70, c.bpm - 1); bpm <= Math.min(180, c.bpm + 1) + 1e-9; bpm += 0.1) {
      const s = score(bpm)
      if (s > best) { best = s; bestBpm = bpm }
    }
  }
  if (!bestBpm || best <= 0) return null

  // ⅔ guard. A song at 160 BPM puts strong onsets at 1.5× the 107 BPM lag
  // (every third half-beat lands on a beat), and the 120-centred prior then
  // favours 107. If the tempo one and a half times faster explains the
  // onsets nearly as well WITHOUT the prior, it is the real beat.
  const raw = (bpm: number) => score(bpm) / (0.75 + 0.25 * Math.exp(-Math.pow(Math.log2(bpm / 120), 2) / (2 * 0.5 * 0.5)))
  if (takeThreeHalves(bestBpm, raw(bestBpm), raw(bestBpm * 1.5))) bestBpm *= 1.5

  // The middle 90 s: enough for the checks below, and cheap — this also runs
  // on the console's UI thread when a deck loads.
  const mid = Math.min(o.length, rate * 90)
  const om = o.subarray(Math.floor((o.length - mid) / 2), Math.floor((o.length - mid) / 2) + mid)
  const bar = (bpm: number) => barCorrelation(om, bpm, rate)
  bestBpm = barAlias(bestBpm, bar)
  bestBpm = foldToCeiling(bestBpm, opts.ceiling, bar)

  // Precise value. The two-tap comb above finds the right tempo FAMILY but
  // its peaks are broad — Blinding Lights scores flat from 167 to 174 BPM.
  // A long comb, weighing sixteen beats ahead, has one sharp peak: on the
  // real-song fixtures it reads 116/96/103/160/171 exactly.
  const long = (bpm: number) => {
    const lag = (60 * rate) / bpm
    let s = 0
    for (let i = 0; i + LONG_TAPS * lag + 1 < om.length; i++) {
      const v = om[i]
      if (v === 0) continue
      for (let k = 1; k <= LONG_TAPS; k++) s += (v * interp(om, i + k * lag)) / k
    }
    return s
  }
  let fine = 0
  let fineBpm = bestBpm
  for (let bpm = bestBpm * 0.97; bpm <= bestBpm * 1.03 + 1e-9; bpm += 0.5) {
    const s = long(bpm)
    if (s > fine) { fine = s; fineBpm = bpm }
  }
  const centre = fineBpm
  for (let bpm = centre - 0.5; bpm <= centre + 0.5 + 1e-9; bpm += 0.1) {
    const s = long(bpm)
    if (s > fine) { fine = s; fineBpm = bpm }
  }
  if (fine > 0) bestBpm = fineBpm
  const rounded = Math.round(bestBpm)
  return Math.abs(bestBpm - rounded) < 0.25 ? rounded : Math.round(bestBpm * 10) / 10
}

/** Corrected readings may go above the 180 search ceiling (drum & bass, fast pop). */
const MAX_CORRECTED_BPM = 200
/** Only a slow reading can be a fast song's ⅔ alias: 160→107 qualifies; a
 *  125 dance tempo with triplet hats is not a 187.5 song ("Bandana"). */
const MAX_GUARDED_BPM = 118

/** The ⅔ guard's decision: is `best` really two-thirds of the true tempo? */
export function takeThreeHalves(best: number, rawBest: number, rawUp: number): boolean {
  return best <= MAX_GUARDED_BPM && best * 1.5 <= MAX_CORRECTED_BPM && rawUp >= TWO_THIRDS_RATIO * rawBest
}
/** How close the 3/2 tempo's raw comb score must come to the winner's. Tuned on the real-song fixtures. */
const TWO_THIRDS_RATIO = 0.9
/** Beats ahead the precision comb weighs (1/k each). 16 reads every fixture exactly. */
const LONG_TAPS = 16

/** What is known about a track's tempo before its audio is read. */
export interface TempoHint {
  /** Fastest tempo the track plausibly has; readings above it are folded down. */
  ceiling?: number
}

/**
 * Genres whose songs rarely run past ~125 BPM. A reading of 176 for an
 * afrobeats song is its double time (Last Last is 88), and the beat-matcher
 * would sync another song to twice its real speed.
 */
const SLOW_GENRES = /\b(afro ?beats?|afro ?pop|afro ?swing|amapiano|r&b|rnb|neo ?soul|bongo|highlife)\b/
const SLOW_GENRE_CEILING = 125

/** The tempo ceiling for a track tagged with these genres, if any of them sets one. */
export function tempoCeiling(genres: readonly string[] | undefined): number | undefined {
  return genres?.some(g => SLOW_GENRES.test(g.toLowerCase())) ? SLOW_GENRE_CEILING : undefined
}

/**
 * How strongly the onsets repeat one bar (four beats) apart at `bpm`:
 * the normalised autocorrelation, best within ±2% of the bar.
 *
 * The beat combs cannot tell a tempo from its ¾ / 4⁄3 alias when the
 * rhythm is syncopated: a 3+3+2 kick (Last Last, 88 BPM) repeats every ¾
 * beat, which the comb reads as 117. The bar is what really repeats — at 88
 * the four-beat lag correlates 0.43, at 117 (three real beats) 0.06.
 */
export function barCorrelation(o: Float32Array, bpm: number, rate = ENV_RATE): number {
  const n = o.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += o[i]
  mean /= n
  let v0 = 0
  for (let i = 0; i < n; i++) v0 += (o[i] - mean) * (o[i] - mean)
  v0 /= n
  if (v0 <= 0) return 0
  const barLag = (4 * 60 * rate) / bpm
  let best = -1
  for (let lag = barLag * 0.98; lag <= barLag * 1.02 + 1e-9; lag += 0.25) {
    let s = 0, k = 0
    for (let i = 0; i + lag + 1 < n; i++) { s += (o[i] - mean) * (interp(o, i + lag) - mean); k++ }
    if (k > 0 && s / k / v0 > best) best = s / k / v0
  }
  return best
}

/** Lowest tempo a correction may land on (half-time ballads sit near 60–70). */
const MIN_CORRECTED_BPM = 60
/** A ¾ / 4⁄3 alternative must repeat its bar this many times better… */
const BAR_RATIO = 2
/** …and by at least this much. Tuned on the real-song fixtures: no true tempo
 *  there is ever displaced, every Last Last window and Shape of You's 128 are. */
const BAR_MARGIN = 0.12

/** The ¾ / 4⁄3 check: the reading, or the alias whose bar repeats far more clearly. */
export function barAlias(bpm: number, bar: (bpm: number) => number): number {
  const here = bar(bpm)
  let pick = bpm, pickBar = here
  for (const f of [3 / 4, 4 / 3]) {
    const c = bpm * f
    if (c < MIN_CORRECTED_BPM || c > MAX_CORRECTED_BPM) continue
    const b = bar(c)
    if (b >= BAR_RATIO * here && b - here >= BAR_MARGIN && b > pickBar) { pick = c; pickBar = b }
  }
  return pick
}

/**
 * A reading above the genre's ceiling is an alias of a slower tempo: ½ (176
 * → 88), ¾ (139 → 104, Essence's first scan) or ⅔. The one whose bar repeats
 * best wins. At or under the ceiling (+4% grace) the reading stands.
 */
export function foldToCeiling(bpm: number, ceiling: number | undefined, bar: (bpm: number) => number): number {
  if (!ceiling || bpm <= ceiling * 1.04) return bpm
  let pick = bpm, pickBar = -Infinity
  for (const f of [1 / 2, 3 / 4, 2 / 3]) {
    const c = bpm * f
    if (c < MIN_CORRECTED_BPM || c > ceiling * 1.04) continue
    const b = bar(c)
    if (b > pickBar) { pick = c; pickBar = b }
  }
  return pick
}

/** Offset (seconds) of the beat grid that best lines up with the onsets. */
export function detectFirstBeat(onset: Float32Array, bpm: number, rate = ENV_RATE): number {
  const period = (60 * rate) / bpm
  const steps = Math.max(1, Math.floor(period))
  let best = -1
  let bestOff = 0
  for (let off = 0; off < steps; off++) {
    let s = 0
    for (let x = off; x < onset.length; x += period) s += interp(onset, x)
    if (s > best) { best = s; bestOff = off }
  }
  return bestOff / rate
}

/**
 * The shift that best lines `scan` up with `play` over frames [from, to):
 * play[i] ≈ scan[i - lag]. Used to align a YouTube song's scanned waveform
 * with what the deck actually played. Null when the two do not agree well
 * enough to trust (too little overlap or a weak match).
 */
export function bestLag(play: Float32Array, scan: Float32Array, from: number, to: number, maxLag: number): number | null {
  let best = -Infinity
  let bestLagV = 0
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let n = 0, sp = 0, ss = 0, spp = 0, sss = 0, sps = 0
    for (let i = Math.max(from, lag, 0); i < Math.min(to, play.length, scan.length + lag); i++) {
      const p = play[i]
      const s = scan[i - lag]
      if (!p || !s) continue
      n++; sp += p; ss += s; spp += p * p; sss += s * s; sps += p * s
    }
    if (n < 200) continue
    const cov = sps - (sp * ss) / n
    const vp = spp - (sp * sp) / n
    const vs = sss - (ss * ss) / n
    if (vp <= 0 || vs <= 0) continue
    const r = cov / Math.sqrt(vp * vs)
    if (r > best) { best = r; bestLagV = lag }
  }
  return best >= 0.3 ? bestLagV : null
}

export function analyze(channels: Float32Array[], sampleRate: number, tempo: TempoHint = {}): Analysis {
  const mono = toMono(channels)
  const env = buildEnvelope(mono, sampleRate)
  const onset = onsetCurve(env)
  const bpm = detectBpm(onset, ENV_RATE, tempo)
  let key: MusicalKey | null = null
  try { key = detectKey(mono, sampleRate) } catch { /* the key is a nicety — never lose the tempo over it */ }
  return { bpm, firstBeat: bpm ? detectFirstBeat(onset, bpm) : 0, env, key }
}
