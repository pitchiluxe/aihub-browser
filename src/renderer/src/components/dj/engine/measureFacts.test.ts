import { describe, it, expect } from 'vitest'
import { measureFacts } from './measureFacts'
import { trackId } from '../ai/types'

const SR = 8000
function noise(seconds: number, amp: number, seed = 3): Float32Array {
  const out = new Float32Array(Math.floor(seconds * SR))
  for (let i = 0; i < out.length; i++) { seed = (seed * 16807) % 2147483647; out[i] = ((seed / 2147483647) - 0.5) * amp }
  return out
}
function kicks(bpm: number, seconds: number, gain = 1): Float32Array {
  const out = noise(seconds, 0.02)
  for (let t = 0; t < seconds; t += 60 / bpm) {
    const s0 = Math.floor(t * SR)
    for (let k = 0; k < SR * 0.12 && s0 + k < out.length; k++) out[s0 + k] += gain * Math.sin((2 * Math.PI * 60 * k) / SR) * Math.exp(-k / (SR * 0.03))
  }
  return out
}
const join = (...parts: Float32Array[]) => { const o = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length } return o }

describe('measureFacts', () => {
  it('reads tempo with high confidence on a steady beat', () => {
    const f = measureFacts(kicks(124, 60), SR)
    // detectBpm's own resolution at 8 kHz is a few tenths; the planner's
    // tempo tolerance is ±3%, so ±0.5 BPM is the precision that matters.
    expect(Math.abs((f.bpm as number) - 124)).toBeLessThanOrEqual(0.5)
    expect(f.bpmConfidence).toBe(1)
    expect(f.durationSec).toBeCloseTo(60, 0)
  })

  it('rates a loud, fast track higher energy than a quiet, slow one', () => {
    const loud = measureFacts(kicks(128, 40, 1), SR)
    const quiet = measureFacts(kicks(85, 40, 0.15), SR)
    expect(loud.energy).toBeGreaterThan(quiet.energy)
    expect(loud.energy).toBeGreaterThanOrEqual(0)
    expect(loud.energy).toBeLessThanOrEqual(1)
  })

  it('finds where the intro ends and the outro starts', () => {
    const f = measureFacts(join(noise(16, 0.01), kicks(120, 60), noise(14, 0.01)), SR)
    expect(f.introEndSec).toBeGreaterThan(12)
    expect(f.introEndSec).toBeLessThan(20)
    expect(f.outroStartSec).toBeGreaterThan(72)
    expect(f.outroStartSec).toBeLessThan(80)
  })

  it('reports no tempo and zero confidence for silence', () => {
    const f = measureFacts(new Float32Array(SR * 20), SR)
    expect(f.bpm).toBeNull()
    expect(f.bpmConfidence).toBe(0)
    expect(f.camelot).toBeNull()
  })
})

describe('trackId', () => {
  it('keys YouTube by video id and files by path', () => {
    expect(trackId({ youtubeId: 'abcdefghijk', path: '' })).toBe('yt:abcdefghijk')
    expect(trackId({ path: 'C:/m/a.mp3' })).toBe('file:C:/m/a.mp3')
  })
})
