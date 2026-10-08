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
 */
export function detectBpm(onset: Float32Array, rate = ENV_RATE): number | null {
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
  const rounded = Math.round(bestBpm)
  return Math.abs(bestBpm - rounded) < 0.25 ? rounded : Math.round(bestBpm * 10) / 10
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

export function analyze(channels: Float32Array[], sampleRate: number): Analysis {
  const mono = toMono(channels)
  const env = buildEnvelope(mono, sampleRate)
  const onset = onsetCurve(env)
  const bpm = detectBpm(onset)
  let key: MusicalKey | null = null
  try { key = detectKey(mono, sampleRate) } catch { /* the key is a nicety — never lose the tempo over it */ }
  return { bpm, firstBeat: bpm ? detectFirstBeat(onset, bpm) : 0, env, key }
}
