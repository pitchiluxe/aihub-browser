import { describe, it, expect } from 'vitest'
import { analyze, barCorrelation, bestLag, buildEnvelope, detectBpm, ENV_RATE, foldToCeiling, takeThreeHalves, tempoCeiling } from './analysis'
import onsets from './__fixtures__/onsets.json'

/** Decaying 60 Hz kicks at `bpm`, starting `offset` seconds in, over quiet noise. */
function kicks(bpm: number, seconds: number, sr: number, offset = 0): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sr))
  let seed = 7
  for (let i = 0; i < out.length; i++) { seed = (seed * 16807) % 2147483647; out[i] = ((seed / 2147483647) - 0.5) * 0.02 }
  const period = 60 / bpm
  for (let t = offset; t < seconds; t += period) {
    const s0 = Math.floor(t * sr)
    for (let k = 0; k < sr * 0.12 && s0 + k < out.length; k++) {
      out[s0 + k] += Math.sin((2 * Math.PI * 60 * k) / sr) * Math.exp(-k / (sr * 0.03))
    }
  }
  return out
}

describe('dj analysis', () => {
  const sr = 11025

  it('builds a normalised envelope at the fixed frame rate', () => {
    const env = buildEnvelope(kicks(120, 10, sr), sr)
    expect(env.rate).toBe(ENV_RATE)
    expect(env.amp.length).toBe(10 * ENV_RATE)
    expect(buildEnvelope(new Float32Array(44100 * 3), 44100).amp.length).toBe(3 * ENV_RATE)
    expect(Math.max(...env.amp)).toBeCloseTo(1, 5)
  })

  it.each([85, 90, 124, 128, 140])('detects %i BPM', bpm => {
    const a = analyze([kicks(bpm, 40, sr)], sr)
    expect(a.bpm).not.toBeNull()
    expect(Math.abs((a.bpm as number) - bpm)).toBeLessThanOrEqual(0.5)
  })

  it('reads fast tempos as the tempo or its half (octave-equivalent)', () => {
    const bpm = analyze([kicks(174, 40, sr)], sr).bpm as number
    expect([87, 174].some(x => Math.abs(bpm - x) <= 0.5)).toBe(true)
  })

  it('finds the beat phase', () => {
    const a = analyze([kicks(120, 40, sr, 0.23)], sr)
    expect(a.bpm).toBe(120)
    expect(Math.abs(a.firstBeat - 0.23)).toBeLessThan(0.03)
  })

  it('declines to guess on very short audio', () => {
    expect(analyze([kicks(120, 3, sr)], sr).bpm).toBeNull()
  })
})

describe('bestLag', () => {
  // An irregular envelope so only one shift lines it up.
  const env = (n: number) => {
    const a = new Float32Array(n)
    let seed = 11
    for (let i = 0; i < n; i++) { seed = (seed * 16807) % 2147483647; a[i] = 0.1 + (seed / 2147483647) * 0.9 }
    return a
  }

  it('finds how far the scan runs ahead or behind what was played', () => {
    const scan = env(3000)
    const play = new Float32Array(3000)
    for (let i = 25; i < 1500; i++) play[i] = scan[i - 25] // the played audio lands 25 frames later
    expect(bestLag(play, scan, 0, 1500, 100)).toBe(25)
    const early = new Float32Array(3000)
    for (let i = 0; i < 1500; i++) early[i] = scan[i + 12]
    expect(bestLag(early, scan, 0, 1500, 100)).toBe(-12)
  })

  it('refuses to guess from too little or unrelated audio', () => {
    const scan = env(3000)
    const play = new Float32Array(3000)
    for (let i = 0; i < 100; i++) play[i] = scan[i]
    expect(bestLag(play, scan, 0, 100, 50)).toBeNull()
    const noise = env(3000).reverse()
    expect(bestLag(noise, scan, 0, 1500, 50)).toBeNull()
  })
})

describe('detectBpm on real songs', () => {
  // Onset curves captured from the songs themselves (scripts/capture-dj-onsets.cjs).
  const songs = onsets as Record<string, { bpm: number; onset: number[] }>
  it.each(Object.keys(songs))('%s reads within ±2 BPM of its published tempo', name => {
    const s = songs[name]
    const got = detectBpm(Float32Array.from(s.onset))
    expect(got).not.toBeNull()
    expect(Math.abs((got as number) - s.bpm)).toBeLessThanOrEqual(2)
  })
})

describe('detectBpm does not over-correct', () => {
  // Afrobeats/house: kick on every beat, shaker on every half-beat. The 3/2
  // tempo (187.5) explains those onsets well too, but no such song is 187.5.
  it.each([118, 122, 125])('%i BPM with half-beat shakers stays %i', bpm => {
    const sr = 11025, seconds = 40
    const out = kicks(bpm, seconds, sr)
    const half = 60 / bpm / 2
    for (let t = half; t < seconds; t += 60 / bpm) {
      const s0 = Math.floor(t * sr)
      for (let k = 0; k < sr * 0.03 && s0 + k < out.length; k++) out[s0 + k] += 0.35 * Math.sin((2 * Math.PI * 4000 * k) / sr) * Math.exp(-k / (sr * 0.008))
    }
    const got = analyze([out], sr).bpm as number
    expect(Math.abs(got - bpm)).toBeLessThanOrEqual(1)
  })

  // Afrobeats swing: strong triplet hats over a 125 kick ("Bandana" read 187.5).
  // The ⅔ guard exists for slow readings of fast songs (107 → 160); a 125
  // reading is already a dance tempo and must not be pushed to 187.5.
  it('the ⅔ guard only lifts slow readings (107 → 160), never a dance tempo (125 ↛ 187.5)', () => {
    expect(takeThreeHalves(107, 1, 0.95)).toBe(true)
    expect(takeThreeHalves(125, 1, 0.95)).toBe(false)
    expect(takeThreeHalves(107, 1, 0.5)).toBe(false)
  })

  it.each([122, 125])('%i BPM with triplet hats stays %i', bpm => {
    const sr = 11025, seconds = 40
    const out = kicks(bpm, seconds, sr)
    for (let t = 0; t < seconds; t += 60 / bpm / 3) {
      const s0 = Math.floor(t * sr)
      for (let k = 0; k < sr * 0.03 && s0 + k < out.length; k++) out[s0 + k] += 3 * Math.sin((2 * Math.PI * 4000 * k) / sr) * Math.exp(-k / (sr * 0.008))
    }
    const got = analyze([out], sr).bpm as number
    expect(Math.abs(got - bpm)).toBeLessThanOrEqual(1)
  })
})

describe('detectBpm tempo aliases (afrobeats / R&B)', () => {
  const songs = onsets as Record<string, { bpm: number; onset: number[]; head?: number[] }>
  const near = (got: number | null, want: number) => got !== null && Math.abs(got - want) <= 2

  // Last Last's kick is a 3+3+2 tresillo: the onsets repeat every ¾ beat, so
  // the comb read 117.4 (4⁄3 × 88). Only the real tempo's bar repeats.
  it('Last Last reads 88, not its 4⁄3 alias 117', () => {
    expect(near(detectBpm(Float32Array.from(songs['last-last'].onset)), 88)).toBe(true)
  })

  // What a deck measures live: the song's first 32 s.
  it.each(['last-last', 'essence', 'calm-down', 'kill-bill'])('%s reads its tempo from the first 32 s', name => {
    expect(near(detectBpm(Float32Array.from(songs[name].head!)), songs[name].bpm)).toBe(true)
  })

  // Short windows (a 24 s live reading) of the mid-song capture.
  it('Shape of You: the 24 s window that read 128 (4⁄3 × 96) reads 96', () => {
    expect(near(detectBpm(Float32Array.from(songs['shape-of-you'].onset).subarray(2000, 4400)), 96)).toBe(true)
    // Known miss: its window at 40 s reads 122.7 — not an alias; nothing there
    // repeats bar-to-bar at any tempo (bar correlation ≤ 0.17), so no rule can tell.
  })
  it.each(['last-last', 'essence', 'calm-down', 'get-lucky', 'levitating', 'blinding-lights'])('%s: every 24 s window reads its tempo', name => {
    const o = Float32Array.from(songs[name].onset)
    const readings = [0, 2000, 4000, 5800].map(at => detectBpm(o.subarray(at, at + 2400)))
    expect(readings.filter(b => !near(b, songs[name].bpm))).toEqual([])
  })

  // A genre that rarely runs past ~125 folds a double-time reading down.
  it('a genre ceiling folds double-time readings down, and leaves fast genres alone', () => {
    const kb = Float32Array.from(songs['kill-bill'].onset).subarray(4000, 6400)
    expect(detectBpm(kb)).toBeCloseTo(178, 0) // the octave above: the audio alone cannot tell
    expect(detectBpm(kb, ENV_RATE, { ceiling: tempoCeiling(['r&b']) })).toBeCloseTo(89, 0)
    expect(detectBpm(Float32Array.from(songs['blinding-lights'].onset), ENV_RATE, { ceiling: tempoCeiling(['pop']) })).toBeCloseTo(171, 0)
    expect(tempoCeiling(['afrobeats'])).toBe(125)
    expect(tempoCeiling(['amapiano', 'house'])).toBe(125)
    expect(tempoCeiling(['drum and bass'])).toBeUndefined()
    expect(tempoCeiling(undefined)).toBeUndefined()
  })

  it('folds a reading above the ceiling to the alias whose bar repeats (176 → 88, 139 → 104)', () => {
    const ll = Float32Array.from(songs['last-last'].onset)
    expect(foldToCeiling(176, 125, b => barCorrelation(ll, b))).toBeCloseTo(88, 0)
    const es = Float32Array.from(songs['essence'].onset)
    expect(foldToCeiling(139, 125, b => barCorrelation(es, b))).toBeCloseTo(104, 0)
    expect(foldToCeiling(110, 125, () => 1)).toBe(110)
  })
})
