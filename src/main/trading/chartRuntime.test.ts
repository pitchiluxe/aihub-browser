import { describe, it, expect } from 'vitest'
import {
  normalizeRuntimeBars, describeResolution, splitSymbol, toDailyCandles,
  isDailyOrHigher, READ_BARS_SCRIPT,
} from './chartRuntime'

/**
 * Captured from the user's own live XAUUSD chart via TradingViewApi — the real
 * shape, not an invented one: [time(seconds), open, high, low, close, volume].
 */
const REAL_BARS = [
  [1785708000, 4050.83, 4079.25, 4018.99, 4054.85, 685472],
  [1785794400, 4054.85, 4106.39, 4042.49, 4077.27, 618315],
  [1785880800, 4077.27, 4268.13, 4065.24, 4247.07, 807952],
  [1785967200, 4247.07, 4304.03, 4245.51, 4262.86, 222753],
]

describe('normalizeRuntimeBars — the user’s real chart data', () => {
  const reading = normalizeRuntimeBars(JSON.stringify({ symbol: 'FX:XAUUSD', resolution: '1D', bars: REAL_BARS }))

  it('reads every real bar', () => {
    expect(reading.candles).toHaveLength(4)
    expect(reading.error).toBeUndefined()
  })

  it('keeps the actual prices — this is what stops the model inventing them', () => {
    const last = reading.candles[reading.candles.length - 1]
    expect(last).toMatchObject({ o: 4247.07, h: 4304.03, l: 4245.51, c: 4262.86 })
  })

  it('converts epoch SECONDS to milliseconds — otherwise every bar lands in 1970', () => {
    expect(reading.candles[0].t).toBe(1785708000 * 1000)
    expect(new Date(reading.candles[0].t).getUTCFullYear()).toBeGreaterThan(2020)
  })

  it('carries the symbol and resolution the chart is actually on', () => {
    expect(reading.symbol).toBe('FX:XAUUSD')
    expect(reading.resolution).toBe('1D')
  })

  it('leaves bars in time order, oldest first', () => {
    const times = reading.candles.map(c => c.t)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('accepts an already-parsed object as well as JSON text', () => {
    expect(normalizeRuntimeBars({ bars: REAL_BARS }).candles).toHaveLength(4)
  })
})

describe('normalizeRuntimeBars — refusing bad data', () => {
  it('reports the runtime being absent rather than returning empty silence', () => {
    expect(normalizeRuntimeBars(JSON.stringify({ error: 'no-runtime' })).error).toBe('no-runtime')
  })

  it('drops malformed bars instead of importing them', () => {
    const mixed = [[1785708000, 1, 2, 0.5, 1.5, 10], 'nonsense', [1, 2], [1785794400, 'x', 2, 1, 1.5]]
    expect(normalizeRuntimeBars({ bars: mixed }).candles).toHaveLength(1)
  })

  it('drops impossible bars where the high is below the low', () => {
    expect(normalizeRuntimeBars({ bars: [[1785708000, 10, 5, 8, 9, 1]] }).candles).toHaveLength(0)
  })

  it('survives junk input', () => {
    expect(normalizeRuntimeBars('not json').error).toBe('unreadable')
    expect(normalizeRuntimeBars(null).error).toBe('unreadable')
    expect(normalizeRuntimeBars({}).error).toBe('no-usable-bars')
  })
})

describe('READ_BARS_SCRIPT', () => {
  it('never throws out of the page — a changed internal must not break the tab', () => {
    expect(READ_BARS_SCRIPT).toContain('try {')
    expect(READ_BARS_SCRIPT).toContain("error: 'threw'")
  })
  it('bounds how much it ships back over IPC', () => {
    expect(READ_BARS_SCRIPT).toContain('slice(-400)')
  })
})

describe('describeResolution', () => {
  it('turns TradingView’s raw minutes into something a trader reads', () => {
    expect(describeResolution('1')).toBe('1m')
    expect(describeResolution('15')).toBe('15m')
    expect(describeResolution('60')).toBe('1H')
    expect(describeResolution('240')).toBe('4H')
    expect(describeResolution('1D')).toBe('1D')
  })
  it('passes through nothing', () => {
    expect(describeResolution(undefined)).toBeUndefined()
  })
})

describe('splitSymbol', () => {
  it('separates exchange from ticker', () => {
    expect(splitSymbol('FX:XAUUSD')).toEqual({ exchange: 'FX', ticker: 'XAUUSD' })
    expect(splitSymbol('COMEX:GC1!')).toEqual({ exchange: 'COMEX', ticker: 'GC1!' })
  })
  it('copes with a bare ticker', () => {
    expect(splitSymbol('AAPL')).toEqual({ ticker: 'AAPL' })
    expect(splitSymbol(undefined)).toEqual({})
  })
})

describe('toDailyCandles — so a 5-minute chart still has prior-day levels', () => {
  const intraday = [
    { t: Date.UTC(2026, 7, 4, 9), o: 10, h: 12, l: 9, c: 11, v: 100 },
    { t: Date.UTC(2026, 7, 4, 13), o: 11, h: 15, l: 10, c: 14, v: 200 },
    { t: Date.UTC(2026, 7, 5, 9), o: 14, h: 16, l: 13, c: 15, v: 50 },
  ]

  it('collapses each day into one bar', () => {
    expect(toDailyCandles(intraday)).toHaveLength(2)
  })

  it('takes the day’s true high, low, first open and last close', () => {
    const [day1] = toDailyCandles(intraday)
    expect(day1).toMatchObject({ o: 10, h: 15, l: 9, c: 14 })
  })

  it('sums the day’s volume', () => {
    expect(toDailyCandles(intraday)[0].v).toBe(300)
  })

  it('handles an empty series', () => {
    expect(toDailyCandles([])).toEqual([])
  })
})

describe('isDailyOrHigher', () => {
  it('knows when the series is already the daily one', () => {
    expect(isDailyOrHigher('1D')).toBe(true)
    expect(isDailyOrHigher('D')).toBe(true)
    expect(isDailyOrHigher('W')).toBe(true)
    expect(isDailyOrHigher('15')).toBe(false)
    expect(isDailyOrHigher('240')).toBe(false)
    expect(isDailyOrHigher(undefined)).toBe(false)
  })
})
