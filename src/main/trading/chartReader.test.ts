import { describe, it, expect } from 'vitest'
import {
  parseNumber, parseOhlc, normalizeInterval, parseTradingViewText,
  isChartUrl, describeReading,
} from './chartReader'

/**
 * Captured verbatim from a live TradingView chart (COMEX gold, daily) by
 * loading the real page — not written by hand. A parser tested against
 * invented input is exactly the failure this feature exists to fix.
 */
const LIVE_PAGE_TEXT = `GC1!
D
Indicator
Alert
Replay
Save
Save
Trade
Publi h
G
Gold Future
1D
COMEX
O
4,307.0
H
4,363.7
L
4,304.9
C
4,359.1
+53.9 (+1.25%)
4,359.1
SELL
0.1
4,359.2
BUY
Vol
30.88 K
1D
5D
1M
3M
6M
YTD
1Y
5Y
All
02:19:16 UTC
B-ADJ
SET
Watchli t
Symbol
La t
Chg
Chg%
INDICES
S
SPX
D
7,723.55
−12.97
−0.17%
N
NDQ
29,487.79
−245.37
−0.83%
D
DJI
54,354.44
263.03
0.49%
V
VIX
D
15.81
−0.69
−4.18%
D
DXY
99.655
−0.12`

const LIVE_TITLE = 'GC1! 4,359.1 ▲ +1.25%'

describe('parseNumber', () => {
  it('reads the formats a chart prints', () => {
    expect(parseNumber('4,359.1')).toBe(4359.1)
    expect(parseNumber('+53.9')).toBe(53.9)
    expect(parseNumber('30.88')).toBe(30.88)
  })
  it('handles the unicode minus these pages use', () => {
    expect(parseNumber('−12.97')).toBe(-12.97)
  })
  it('returns undefined rather than NaN for junk', () => {
    expect(parseNumber('')).toBeUndefined()
    expect(parseNumber('SELL')).toBeUndefined()
    expect(parseNumber(null)).toBeUndefined()
  })
})

describe('parseOhlc', () => {
  it('reads the legend off the real page', () => {
    expect(parseOhlc(LIVE_PAGE_TEXT)).toEqual({ open: 4307, high: 4363.7, low: 4304.9, close: 4359.1 })
  })

  it('reads a single-line legend too', () => {
    expect(parseOhlc('O 1.0850 H 1.0899 L 1.0840 C 1.0875')).toEqual({ open: 1.085, high: 1.0899, low: 1.084, close: 1.0875 })
  })

  it('returns nothing when the page has no legend, instead of inventing one', () => {
    expect(parseOhlc('some article about gold prices rising')).toBeUndefined()
  })

  it('rejects an impossible bar rather than passing on a bad parse', () => {
    // High below low — a misparse, never a real bar.
    expect(parseOhlc('O 10 H 5 L 8 C 9')).toBeUndefined()
  })
})

describe('normalizeInterval', () => {
  it('turns chart shorthand into something a person reads', () => {
    expect(normalizeInterval('5')).toBe('5m')
    expect(normalizeInterval('15 min')).toBe('15m')
    expect(normalizeInterval('1D')).toBe('1D')
    expect(normalizeInterval('D')).toBe('1D')
    expect(normalizeInterval('4h')).toBe('4H')
  })
  it('passes through the unknown untouched', () => {
    expect(normalizeInterval(undefined)).toBeUndefined()
    expect(normalizeInterval('tick')).toBe('tick')
  })
})

describe('parseTradingViewText — against the real captured page', () => {
  const reading = parseTradingViewText(LIVE_PAGE_TEXT, LIVE_TITLE)

  it('knows which instrument is on screen', () => {
    expect(reading.symbol).toBe('GC1!')
    expect(reading.exchange).toBe('COMEX')
    expect(reading.name).toMatch(/Gold Future/i)
  })

  it('knows which timeframe the bars are', () => {
    expect(reading.interval).toBe('1D')
  })

  it('reads the real OHLC rather than imagining candles', () => {
    expect(reading.ohlc).toEqual({ open: 4307, high: 4363.7, low: 4304.9, close: 4359.1 })
  })

  it('reads price and change', () => {
    expect(reading.price).toBe(4359.1)
    expect(reading.change).toBe(53.9)
    expect(reading.changePercent).toBe(1.25)
  })

  it('reads the two-sided quote and the volume', () => {
    expect(reading.bid).toBe(4359.1)
    expect(reading.ask).toBe(4359.2)
    expect(reading.volume).toMatch(/30.88/)
  })

  it('reads the exchange clock, which is how it knows the session', () => {
    expect(reading.sessionTime).toBe('02:19:16 UTC')
  })

  it('picks up cross-market context from the watchlist', () => {
    const symbols = reading.watchlist.map(w => w.symbol)
    expect(symbols).toContain('SPX')
    expect(symbols).toContain('DXY')
    const dxy = reading.watchlist.find(w => w.symbol === 'DXY')
    expect(dxy?.last).toBeCloseTo(99.655, 3)
    const spx = reading.watchlist.find(w => w.symbol === 'SPX')
    expect(spx?.changePercent).toBeCloseTo(-0.17, 2)
  })

  it('is usable — the assistant may analyse this', () => {
    expect(reading.usable).toBe(true)
  })
})

describe('parseTradingViewText — when there is nothing to read', () => {
  it('is unusable for an ordinary web page, so the assistant must not analyse', () => {
    const reading = parseTradingViewText('Gold hits record high as investors flee to safety', 'Reuters')
    expect(reading.usable).toBe(false)
    expect(reading.ohlc).toBeUndefined()
  })

  it('survives empty input', () => {
    const reading = parseTradingViewText('', '')
    expect(reading.usable).toBe(false)
    expect(reading.watchlist).toEqual([])
  })

  it('reports price-only pages as usable but without a bar', () => {
    const reading = parseTradingViewText('BTCUSD\n64,484.65\n', 'BTCUSD 64,484.65 ▲ +2.1%')
    expect(reading.symbol).toBe('BTCUSD')
    expect(reading.price).toBe(64484.65)
    expect(reading.ohlc).toBeUndefined()
    expect(reading.usable).toBe(true)
  })
})

describe('isChartUrl', () => {
  it('recognises TradingView', () => {
    expect(isChartUrl('https://www.tradingview.com/chart/?symbol=COMEX:GC1!')).toBe(true)
    expect(isChartUrl('https://tradingview.com/chart/abc/')).toBe(true)
  })
  it('does not claim other sites are charts', () => {
    expect(isChartUrl('https://example.com')).toBe(false)
    expect(isChartUrl('not a url')).toBe(false)
  })
})

describe('describeReading', () => {
  it('states exactly what an analysis is based on', () => {
    const line = describeReading(parseTradingViewText(LIVE_PAGE_TEXT, LIVE_TITLE))
    expect(line).toContain('GC1!')
    expect(line).toContain('COMEX')
    expect(line).toContain('1D')
    expect(line).toContain('4359.1')
  })
  it('says plainly when there is no chart', () => {
    expect(describeReading({ watchlist: [], usable: false })).toMatch(/no readable chart/i)
  })
})
