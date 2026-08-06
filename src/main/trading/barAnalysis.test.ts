import { describe, it, expect } from 'vitest'
import { rangePosition, barBias, buildBarLevels, buildBarPlan, analyseReading } from './barAnalysis'
import { parseTradingViewText } from './chartReader'

/** The real gold bar read off the live chart. */
const GOLD = { open: 4307, high: 4363.7, low: 4304.9, close: 4359.1 }
const goldReading = {
  symbol: 'GC1!', name: 'Gold Futures', exchange: 'COMEX', interval: '1D',
  ohlc: GOLD, price: 4359.1, watchlist: [{ symbol: 'DXY', last: 99.655 }], usable: true,
}

describe('rangePosition', () => {
  it('says where in the bar price closed', () => {
    expect(rangePosition({ open: 10, high: 20, low: 10, close: 20 })).toBe(1)
    expect(rangePosition({ open: 20, high: 20, low: 10, close: 10 })).toBe(0)
    expect(rangePosition({ open: 10, high: 20, low: 10, close: 15 })).toBe(0.5)
  })
  it('is neutral for a flat bar instead of dividing by zero', () => {
    expect(rangePosition({ open: 5, high: 5, low: 5, close: 5 })).toBe(0.5)
  })
  it('puts the real gold bar near the highs', () => {
    expect(rangePosition(GOLD)).toBeGreaterThan(0.9)
  })
})

describe('barBias', () => {
  it('is bullish when it closes high AND above the open', () => {
    expect(barBias(GOLD)).toBe('bullish')
  })
  it('is bearish when it closes low AND below the open', () => {
    expect(barBias({ open: 100, high: 101, low: 90, close: 91 })).toBe('bearish')
  })
  it('refuses to call a direction when the two signals disagree', () => {
    // Closed near the high but below the open — not a clean bull bar.
    expect(barBias({ open: 100, high: 101, low: 90, close: 99.5 })).toBe('range')
  })
  it('calls a mid-range close a range, which is the useful answer', () => {
    expect(barBias({ open: 95, high: 100, low: 90, close: 95.5 })).toBe('range')
  })
})

describe('buildBarLevels', () => {
  const levels = buildBarLevels(GOLD, 4359.1)

  it('marks the session high and low — where the stops are', () => {
    expect(levels.some(l => l.kind === 'session-high' && l.price === 4363.7)).toBe(true)
    expect(levels.some(l => l.kind === 'session-low' && l.price === 4304.9)).toBe(true)
  })

  it('marks the open and the equilibrium midpoint', () => {
    expect(levels.some(l => l.kind === 'open' && l.price === 4307)).toBe(true)
    expect(levels.some(l => /midpoint/i.test(l.label))).toBe(true)
  })

  it('includes round numbers near price', () => {
    expect(levels.some(l => l.kind === 'round')).toBe(true)
  })

  it('is sorted high to low, the way a chart is read', () => {
    const prices = levels.map(l => l.price)
    expect([...prices].sort((a, b) => b - a)).toEqual(prices)
  })

  it('does not stack near-identical levels on top of each other', () => {
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i - 1].price - levels[i].price).toBeGreaterThan(0)
    }
  })
})

describe('buildBarPlan — a plan a trader can actually place', () => {
  const levels = buildBarLevels(GOLD, 4359.1)
  const plan = buildBarPlan(GOLD, 4359.1, levels, 'bullish')

  it('goes long with the bias', () => {
    expect(plan.direction).toBe('long')
  })

  it('waits for a pullback rather than chasing the current price', () => {
    expect(plan.entry).toBeTruthy()
    expect(plan.entry!.to).toBeLessThan(4359.1)
    expect(plan.entry!.rationale).toMatch(/do not chase/i)
  })

  it('puts the stop below the level the idea rests on', () => {
    expect(plan.stop!.price).toBeLessThan(plan.entry!.from)
  })

  it('gives targets above entry with real reward-to-risk numbers', () => {
    expect(plan.targets.length).toBeGreaterThan(0)
    for (const target of plan.targets) {
      expect(target.price).toBeGreaterThan(plan.entry!.to)
      expect(target.rr).toBeGreaterThan(0)
    }
    // Targets get further away, so R:R must increase down the list.
    const rrs = plan.targets.map(t => t.rr)
    expect([...rrs].sort((a, b) => a - b)).toEqual(rrs)
  })

  it('states where the idea is wrong, with a price', () => {
    expect(plan.invalidation).toMatch(/\d/)
    expect(plan.riskPerUnit).toBeGreaterThan(0)
  })

  it('mirrors correctly for a short', () => {
    const bearBar = { open: 100, high: 101, low: 90, close: 91 }
    const bearLevels = buildBarLevels(bearBar, 91)
    const short = buildBarPlan(bearBar, 91, bearLevels, 'bearish')
    expect(short.direction).toBe('short')
    expect(short.entry!.from).toBeGreaterThan(91)
    expect(short.stop!.price).toBeGreaterThan(short.entry!.to)
    for (const target of short.targets) expect(target.price).toBeLessThan(short.entry!.from)
  })

  it('declines to invent a trade when the bar is a range', () => {
    const rangeBar = { open: 95, high: 100, low: 90, close: 95.5 }
    const plan = buildBarPlan(rangeBar, 95.5, buildBarLevels(rangeBar, 95.5), 'range')
    expect(plan.direction).toBe('none')
    expect(plan.entry).toBeNull()
    expect(plan.invalidation).toMatch(/wait for/i)
  })
})

describe('analyseReading', () => {
  it('analyses the real gold reading end to end', () => {
    const analysis = analyseReading(goldReading as any)!
    expect(analysis.bias).toBe('bullish')
    expect(analysis.plan.direction).toBe('long')
    expect(analysis.range).toBeCloseTo(58.8, 1)
    expect(analysis.reasoning).toMatch(/buyers finished in control/i)
  })

  it('states its own limits, so nothing is implied that was not read', () => {
    const analysis = analyseReading(goldReading as any)!
    expect(analysis.limits.join(' ')).toMatch(/not from history/i)
  })

  it('returns nothing when there is no price at all — the assistant must then ask', () => {
    expect(analyseReading(parseTradingViewText('an article about gold', 'News') as any)).toBeNull()
    expect(analyseReading({ symbol: 'X', watchlist: [], usable: true } as any)).toBeNull()
  })

  it('gives an honest partial answer when the layout hides the OHLC legend', () => {
    // Some TradingView layouts only show O/H/L/C under the crosshair.
    const analysis = analyseReading({ symbol: 'GC1!', interval: '1D', price: 4352.9, watchlist: [], usable: true } as any)!
    expect(analysis.plan.direction).toBe('none')
    expect(analysis.plan.entry).toBeNull()
    // It still offers the levels a live price genuinely supports.
    expect(analysis.levels.every(l => l.kind === 'round')).toBe(true)
    expect(analysis.levels.length).toBeGreaterThan(0)
    // And it says WHY, rather than implying it analysed a bar.
    expect(analysis.limits.join(' ')).toMatch(/legend is not visible/i)
    expect(analysis.reasoning).toMatch(/not showing the bar/i)
  })

  it('never claims a bias it cannot support from a price alone', () => {
    const analysis = analyseReading({ symbol: 'X', price: 100, watchlist: [], usable: true } as any)!
    expect(analysis.bias).toBe('range')
    expect(analysis.range).toBe(0)
  })

  it('works on an instrument priced in decimals, not just thousands', () => {
    const fx = analyseReading({
      symbol: 'EURUSD', interval: '15m', price: 1.0875,
      ohlc: { open: 1.084, high: 1.0899, low: 1.0838, close: 1.0875 },
      watchlist: [], usable: true,
    } as any)!
    expect(fx.digits).toBeGreaterThanOrEqual(4)
    expect(fx.plan.direction === 'long' || fx.plan.direction === 'none').toBe(true)
  })
})
