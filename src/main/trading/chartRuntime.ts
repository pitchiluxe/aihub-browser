import type { Candle } from './levels'

/**
 * AIHub Browser — reading the chart's REAL candle history.
 *
 * Scraping the page text was a dead end on a serious trader's layout: the
 * user's own chart exposes 190 characters of text — symbol, price, clock —
 * while the candles, fair-value gaps, order blocks, CHOCH markers and the
 * price axis are all painted onto eleven canvases. Pixels are not text, so
 * the assistant kept saying "no visible data" while looking at a chart
 * covered in structure.
 *
 * TradingView's own runtime does expose it. `window.TradingViewApi
 * .activeChart()` reaches the live series, and its bar store holds the same
 * array the chart is drawing: [time, open, high, low, close, volume] per bar,
 * hundreds of them. That is the user's own data, already in their browser —
 * no API key, no third-party quote, and it is exactly what they are looking
 * at, including their timeframe and their symbol.
 */

/**
 * Injected into the chart page. Deliberately defensive: TradingView's internals
 * are not a public contract, so every step is optional-chained and the whole
 * thing returns a reason string instead of throwing when the shape changes.
 */
export const READ_BARS_SCRIPT = `(() => {
  try {
    const api = window.TradingViewApi
    if (!api || typeof api.activeChart !== 'function') return JSON.stringify({ error: 'no-runtime' })
    const chart = api.activeChart()
    if (!chart) return JSON.stringify({ error: 'no-chart' })

    const symbol = typeof chart.symbol === 'function' ? chart.symbol() : undefined
    const resolution = typeof chart.resolution === 'function' ? chart.resolution() : undefined

    const series = typeof chart.getSeries === 'function' ? chart.getSeries() : null
    const data = series && typeof series.data === 'function' ? series.data() : null
    const barStore = data && typeof data.bars === 'function' ? data.bars() : null
    const items = barStore && barStore._items
    const arr = Array.isArray(items) ? items : (items && items.length ? Array.from(items) : [])
    if (!arr.length) return JSON.stringify({ error: 'no-bars', symbol, resolution })

    // Keep this bounded: a year of 1m bars would be megabytes over IPC, and
    // 400 bars is more than any level calculation needs.
    const recent = arr.slice(-400).map(item => item && item.value).filter(v => Array.isArray(v) && v.length >= 5)
    return JSON.stringify({ symbol, resolution, bars: recent })
  } catch (e) {
    return JSON.stringify({ error: 'threw', message: String(e && e.message || e) })
  }
})()`

export interface RuntimeReading {
  symbol?: string
  resolution?: string
  candles: Candle[]
  error?: string
}

/**
 * Turn the raw arrays into candles, dropping anything malformed.
 *
 * TradingView's bar times are epoch SECONDS; everything downstream works in
 * milliseconds, and a thousand-fold error here would put every bar in 1970 and
 * silently break day grouping.
 */
export function normalizeRuntimeBars(raw: unknown): RuntimeReading {
  let parsed: any = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return { candles: [], error: 'unreadable' } }
  }
  if (!parsed || typeof parsed !== 'object') return { candles: [], error: 'unreadable' }
  if (parsed.error) return { candles: [], error: parsed.error, symbol: parsed.symbol, resolution: parsed.resolution }

  const bars = Array.isArray(parsed.bars) ? parsed.bars : []
  const candles: Candle[] = []
  for (const bar of bars) {
    if (!Array.isArray(bar) || bar.length < 5) continue
    const [time, open, high, low, close, volume] = bar
    if (![time, open, high, low, close].every(v => typeof v === 'number' && isFinite(v))) continue
    // A bar whose high is under its low is corrupt, not a market event.
    if (high < low || high < open || high < close || low > open || low > close) continue
    candles.push({
      t: time > 1e12 ? time : time * 1000,
      o: open, h: high, l: low, c: close,
      v: typeof volume === 'number' ? volume : undefined,
    })
  }

  candles.sort((a, b) => a.t - b.t)
  return {
    symbol: typeof parsed.symbol === 'string' ? parsed.symbol : undefined,
    resolution: typeof parsed.resolution === 'string' ? parsed.resolution : undefined,
    candles,
    error: candles.length ? undefined : 'no-usable-bars',
  }
}

/** "1" → "1m", "60" → "1H", "1D" stays. TradingView reports raw minutes. */
export function describeResolution(resolution: string | undefined): string | undefined {
  if (!resolution) return undefined
  const value = String(resolution).trim()
  if (/^\d+$/.test(value)) {
    const minutes = Number(value)
    if (minutes % 60 === 0 && minutes >= 60) return `${minutes / 60}H`
    return `${minutes}m`
  }
  return value.toUpperCase()
}

/** "FX:XAUUSD" → { exchange: "FX", ticker: "XAUUSD" } */
export function splitSymbol(symbol: string | undefined): { exchange?: string; ticker?: string } {
  if (!symbol) return {}
  const [left, right] = String(symbol).split(':')
  return right ? { exchange: left, ticker: right } : { ticker: left }
}

/**
 * Daily bars derived from an intraday series, so prior-day levels exist even
 * when the user is on a 5-minute chart. Grouping is by UTC day: a session
 * boundary that is off by an hour still puts the right high and low together,
 * and guessing each instrument's session open would be worse than honest.
 */
export function toDailyCandles(candles: Candle[]): Candle[] {
  const byDay = new Map<string, Candle>()
  for (const candle of candles) {
    const key = new Date(candle.t).toISOString().slice(0, 10)
    const existing = byDay.get(key)
    if (!existing) {
      byDay.set(key, { ...candle })
    } else {
      existing.h = Math.max(existing.h, candle.h)
      existing.l = Math.min(existing.l, candle.l)
      existing.c = candle.c
      if (typeof candle.v === 'number') existing.v = (existing.v || 0) + candle.v
    }
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t)
}

/** Is this series already daily-or-higher? Then it IS the daily series. */
export function isDailyOrHigher(resolution: string | undefined): boolean {
  if (!resolution) return false
  return /^(1?D|W|M|\d+D|\d+W|\d+M)$/i.test(String(resolution).trim())
}
