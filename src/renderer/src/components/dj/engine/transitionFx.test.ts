import { describe, it, expect } from 'vitest'
import { fxAt, fxStart, planTransition, tempoGap } from './transitionFx'

const base = { outLow: 0.5, inLow: 0.5, outFilter: 0.5, inFilter: 0.5 }

describe('transition planning', () => {
  it('folds half and double time when comparing tempos', () => {
    expect(tempoGap(120, 120)).toBe(0)
    expect(tempoGap(70, 140)).toBeCloseTo(0, 5)
    expect(tempoGap(128, 124)).toBeCloseTo(0.03125, 4)
    expect(tempoGap(null, 120)).toBeNull()
  })

  it('locks tempos that are close and keeps the full fade', () => {
    expect(planTransition(124, 126, 10)).toEqual({ style: 'blend', seconds: 10, sync: true })
    expect(planTransition(87, 174, 10).style).toBe('blend')
  })

  it('filters out when tempos are far apart or unknown, and keeps it short', () => {
    expect(planTransition(100, 128, 10)).toEqual({ style: 'filter', seconds: 6, sync: false })
    expect(planTransition(null, 128, 16)).toEqual({ style: 'filter', seconds: 8, sync: false })
    expect(planTransition(100, 128, 4).seconds).toBe(4)
  })
})

describe('transition EQ moves', () => {
  it('blend: the incoming bass is out until halfway, then the swap', () => {
    expect(fxStart('blend', base).inLow).toBe(0)
    expect(fxAt('blend', 0.2, base)).toMatchObject({ outLow: 0.5, inLow: 0 })
    const mid = fxAt('blend', 0.5, base)
    expect(mid.outLow).toBeGreaterThan(0)
    expect(mid.outLow).toBeLessThan(0.5)
    expect(fxAt('blend', 0.8, base)).toMatchObject({ outLow: 0, inLow: 0.5 })
  })

  it('filter: the outgoing song closes into a high-pass, the incoming opens', () => {
    expect(fxStart('filter', base).inFilter).toBeCloseTo(0.1, 5)
    const late = fxAt('filter', 0.95, base)
    expect(late.outFilter).toBeCloseTo(0.96, 2)
    expect(late.inFilter).toBeCloseTo(0.5, 5)
  })

  it('never leaves the knob range', () => {
    for (const style of ['blend', 'filter'] as const) {
      for (let p = 0; p <= 1.0001; p += 0.05) {
        for (const v of Object.values(fxAt(style, p, base))) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
      }
    }
  })
})
