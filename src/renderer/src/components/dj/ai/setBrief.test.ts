import { describe, it, expect } from 'vitest'
import { parseBrief, curveAt, PRESETS } from './setBrief'

describe('parseBrief', () => {
  it('reads the example from the design', () => {
    const b = parseBrief('Afrobeats warm-up into amapiano, 2h, peak at 11', { nowHour: 21, nowMinute: 0 })
    expect(b.durationMin).toBe(120)
    expect(b.seeds).toEqual(['afrobeats', 'amapiano'])
    expect(curveAt(b.curve, 0)).toBeLessThan(0.5)                 // warm-up start
    expect(curveAt(b.curve, 120)).toBeGreaterThan(0.8)             // peak at 23:00 = minute 120
    expect(b.discoveryShare).toBe(0.25)
  })

  it('reads durations in several forms', () => {
    expect(parseBrief('house, 90 min').durationMin).toBe(90)
    expect(parseBrief('jazz for 2 hours').durationMin).toBe(120)
    expect(parseBrief('techno 45m').durationMin).toBe(45)
    expect(parseBrief('gospel').durationMin).toBe(60)
  })

  it('keeps embedded instructions as rules', () => {
    const b = parseBrief('hip hop, no Drake, under 100 bpm')
    expect(b.seeds).toEqual(['hip hop'])
    expect(b.rules).toEqual([{ kind: 'banArtist', artist: 'drake' }, { kind: 'tempoRange', max: 100 }])
  })

  it('every preset parses to a non-empty plan', () => {
    for (const p of Object.values(PRESETS)) {
      const b = parseBrief(p.text)
      expect(b.curve.length).toBeGreaterThanOrEqual(2)
      expect(b.durationMin).toBeGreaterThan(0)
    }
  })
})

describe('curveAt', () => {
  it('interpolates between points and clamps at the ends', () => {
    const c = [{ atMin: 0, level: 0.2 }, { atMin: 60, level: 0.8 }]
    expect(curveAt(c, 30)).toBeCloseTo(0.5)
    expect(curveAt(c, -5)).toBe(0.2)
    expect(curveAt(c, 90)).toBe(0.8)
  })
})
