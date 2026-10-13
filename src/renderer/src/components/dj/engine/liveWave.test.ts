import { describe, it, expect } from 'vitest'
import { LiveWave } from './liveWave'

// 100 envelope frames per second (ENV_RATE).
const filled = (w: LiveWave, from: number, to: number) => {
  let n = 0
  for (let i = from; i < to; i++) if ((w as any).scanEnv[i] > 0) n++
  return n
}

describe('LiveWave scanned peaks — a busy machine must not leave a comb of thin bars', () => {
  it('readings a few frames apart fill the frames between them', () => {
    const w = new LiveWave(1000)
    w.addScanned(1.00, 0.8, 0.4)
    w.addScanned(1.12, 0.6, 0.3)                // 12 frames later (readings arrive sparsely under load)
    expect(filled(w, 100, 113)).toBe(13)        // no gaps in between
    expect((w as any).scanEnv[106]).toBeGreaterThan(0.5)
  })
  it('a real interruption (an ad, a stall) stays empty — the resumed scan fills it', () => {
    const w = new LiveWave(2000)
    w.addScanned(1.0, 0.8, 0.4)
    w.addScanned(5.0, 0.8, 0.4)                 // 4 s later
    expect(filled(w, 101, 500)).toBe(0)
  })
  it('a resumed scan (starting earlier than the last reading) does not smear backwards', () => {
    const w = new LiveWave(2000)
    w.addScanned(10.0, 0.9, 0.5)
    w.addScanned(9.5, 0.2, 0.1)                 // scan resumed from a bit before where it stopped
    expect((w as any).scanEnv[1000]).toBeCloseTo(0.9)
    expect(filled(w, 951, 1000)).toBe(0)
  })
})
