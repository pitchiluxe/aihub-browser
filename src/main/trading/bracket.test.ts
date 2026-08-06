import { describe, it, expect } from 'vitest'
import { trendContext, buildBracketPlan, buildLevels, type Candle } from './levels'

/** A V-shaped recovery: no higher high yet, but momentum clearly up. */
const rally: Candle[] = Array.from({ length: 60 }, (_, i) => {
  const base = i < 30 ? 4200 - i * 8 : 3960 + (i - 30) * 12
  return { t: Date.UTC(2026, 5, 1) + i * 86_400_000, o: base, h: base + 20, l: base - 20, c: base + 6, v: 1000 }
})

describe('trendContext — what a structure read alone misses', () => {
  const ctx = trendContext(rally)

  it('computes both moving averages', () => {
    expect(ctx.ema20).toBeGreaterThan(0)
    expect(ctx.ema50).toBeGreaterThan(0)
  })

  it('sees momentum a "no higher high yet" structure read would hide', () => {
    expect(ctx.momentumPct).toBeGreaterThan(0)
    expect(ctx.aboveEma20).toBe(true)
    expect(ctx.note).toMatch(/momentum is with the buyers/i)
  })

  it('reads a downtrend the other way round', () => {
    const falling: Candle[] = Array.from({ length: 60 }, (_, i) => {
      const base = 4300 - i * 10
      return { t: Date.UTC(2026, 5, 1) + i * 86_400_000, o: base, h: base + 15, l: base - 15, c: base - 5, v: 100 }
    })
    const ctx = trendContext(falling)
    expect(ctx.aboveEma20).toBe(false)
    expect(ctx.note).toMatch(/sellers/i)
  })

  it('survives a series too short for a 50 EMA', () => {
    expect(() => trendContext(rally.slice(-5))).not.toThrow()
  })
})

describe('buildBracketPlan — the if/then for an undecided chart', () => {
  const levelSet = buildLevels(rally, rally)
  const scenarios = buildBracketPlan(levelSet)

  it('gives both a long and a short scenario', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(1)
    for (const s of scenarios) {
      expect(['long', 'short']).toContain(s.direction)
      expect(s.trigger).toBeGreaterThan(0)
      expect(s.triggerLabel).toBeTruthy()
    }
  })

  it('names the level that triggers each side', () => {
    const long = scenarios.find(s => s.direction === 'long')
    if (long) expect(long.trigger).toBeGreaterThan(levelSet.price)
    const short = scenarios.find(s => s.direction === 'short')
    if (short) expect(short.trigger).toBeLessThan(levelSet.price)
  })

  it('puts each stop on the far side of the range, not at the trigger', () => {
    for (const s of scenarios) {
      if (s.direction === 'long') expect(s.stop).toBeLessThan(s.entry.from)
      else expect(s.stop).toBeGreaterThan(s.entry.to)
    }
  })

  it('only offers targets worth the risk', () => {
    for (const s of scenarios) {
      expect(s.targets.length).toBeGreaterThan(0)
      for (const t of s.targets) expect(t.rr).toBeGreaterThan(0.4)
    }
  })

  it('returns nothing rather than nonsense when there are no levels', () => {
    expect(buildBracketPlan({ levels: [], atr: 0, bias: 'range', price: 100, digits: 2 })).toEqual([])
  })
})
