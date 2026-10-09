import { describe, it, expect } from 'vitest'
import { analyze, bestLag, buildEnvelope, ENV_RATE } from './analysis'

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
