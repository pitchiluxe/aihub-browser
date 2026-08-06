/**
 * AIHub Browser — reading the chart the user is actually looking at.
 *
 * The assistant used to answer chart questions from imagination: asked about
 * gold it produced a table of "Mon Mar 6" candles with invented open, high,
 * low and close values, five months stale and never read from anywhere. The
 * cure is not a better prompt, it is real numbers.
 *
 * A live TradingView chart puts its data in the page as text — symbol,
 * exchange, interval, the current bar's OHLC, the change, volume, the session
 * clock and the watchlist. This parses exactly that, and nothing here guesses:
 * a field that is not on the page comes back undefined so the assistant can
 * say it does not have it.
 */

export interface Ohlc { open: number; high: number; low: number; close: number }

export interface ChartReading {
  /** Ticker as the chart shows it: "GC1!", "XAUUSD", "BTCUSD". */
  symbol?: string
  /** Human name when the page gives one: "Gold Futures". */
  name?: string
  exchange?: string
  /** Timeframe of the bars on screen: "1D", "5", "15", "1H". */
  interval?: string
  ohlc?: Ohlc
  price?: number
  change?: number
  changePercent?: number
  volume?: string
  bid?: number
  ask?: number
  /** Exchange clock as printed on the page, e.g. "02:19:16 UTC". */
  sessionTime?: string
  /** Index/FX context from the watchlist, when visible. */
  watchlist: { symbol: string; last: number; changePercent?: number }[]
  /** True when enough was read to analyse rather than guess. */
  usable: boolean
}

/** Parse a number the way a chart prints it: "4,359.1" → 4359.1. */
export function parseNumber(raw: string | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined
  // Minus signs on these pages are often U+2212, not ASCII hyphen.
  const cleaned = String(raw).replace(/−/g, '-').replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}

/**
 * TradingView prints the legend as "O <v> H <v> L <v> C <v>", each on its own
 * line. Accepts the labels adjacent to their values with any whitespace
 * between, which is what survives innerText extraction.
 */
export function parseOhlc(text: string): Ohlc | undefined {
  const match = text.match(
    /\bO\s*[:\s]\s*([\d.,−-]+)\s*H\s*[:\s]\s*([\d.,−-]+)\s*L\s*[:\s]\s*([\d.,−-]+)\s*C\s*[:\s]\s*([\d.,−-]+)/i,
  )
  if (!match) return undefined
  const [open, high, low, close] = match.slice(1, 5).map(parseNumber)
  if ([open, high, low, close].some(v => v === undefined)) return undefined
  // A bar whose high is below its low is a parse error, not a market event.
  if (high! < low! || high! < open! || high! < close! || low! > open! || low! > close!) return undefined
  return { open: open!, high: high!, low: low!, close: close! }
}

const INTERVAL_LINE = /^(\d+\s*(?:m|min|h|H|D|W|M)?|1D|5D|1M|3M|6M|YTD|1Y|5Y|All)$/

/** Normalise what the chart calls a timeframe into something readable. */
export function normalizeInterval(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const value = raw.trim()
  if (/^\d+$/.test(value)) return `${value}m`          // bare number = minutes
  if (/^\d+\s*m(in)?$/i.test(value)) return value.replace(/\s*min?$/i, 'm')
  if (/^\d+\s*h$/i.test(value)) return value.toUpperCase().replace(/\s+/g, '')
  if (/^1?D$/i.test(value)) return '1D'
  if (/^1?W$/i.test(value)) return '1W'
  if (/^1?M$/i.test(value)) return '1M'
  return value
}

/**
 * Pull a reading out of the chart page's visible text.
 *
 * Written against the real text a TradingView chart produces, because a
 * scraper built from guessed selectors is exactly the kind of thing that
 * silently returns nothing and lets the model fall back to inventing.
 */
export function parseTradingViewText(pageText: string, pageTitle = ''): ChartReading {
  const text = String(pageText || '')
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const reading: ChartReading = { watchlist: [], usable: false }

  // Title carries symbol and last price: "GC1! 4,359.1 ▲ +1.25%"
  const titleMatch = String(pageTitle || '').match(/^([A-Z0-9!.:_-]{1,15})\s+([\d.,]+)/i)
  if (titleMatch) {
    reading.symbol = titleMatch[1]
    reading.price = parseNumber(titleMatch[2])
  }
  if (!reading.symbol && lines.length) {
    const first = lines[0]
    if (/^[A-Z0-9!.:_-]{1,15}$/i.test(first)) reading.symbol = first
  }

  reading.ohlc = parseOhlc(text)
  if (reading.ohlc && reading.price === undefined) reading.price = reading.ohlc.close

  // "Gold Futures" style name, and the exchange that follows it.
  const nameIndex = lines.findIndex(l => /futures?$|index$|\/\s*U\.?S\.?\s*Dollar/i.test(l) && l.length < 40)
  if (nameIndex !== -1) {
    reading.name = lines[nameIndex]
    const after = lines.slice(nameIndex + 1, nameIndex + 4)
    reading.interval = normalizeInterval(after.find(l => INTERVAL_LINE.test(l)))
    reading.exchange = after.find(l => /^[A-Z]{3,8}$/.test(l) && !INTERVAL_LINE.test(l))
  }
  if (!reading.interval) {
    const early = lines.slice(0, 12).find(l => INTERVAL_LINE.test(l) && l !== reading.symbol)
    reading.interval = normalizeInterval(early)
  }

  // "+53.9 (+1.25%)"
  const changeMatch = text.match(/([+\-−][\d.,]+)\s*\(([+\-−][\d.,]+)%\)/)
  if (changeMatch) {
    reading.change = parseNumber(changeMatch[1])
    reading.changePercent = parseNumber(changeMatch[2])
  }

  const volumeMatch = text.match(/\bVol\b\s*\n?\s*([\d.,]+\s*[KMB]?)/i)
  if (volumeMatch) reading.volume = volumeMatch[1].replace(/\s+/g, ' ').trim()

  // The two-sided quote around the last price.
  const sellIndex = lines.findIndex(l => /^SELL$/i.test(l))
  if (sellIndex > 0) reading.bid = parseNumber(lines[sellIndex - 1])
  const buyIndex = lines.findIndex(l => /^BUY$/i.test(l))
  if (buyIndex > 0) reading.ask = parseNumber(lines[buyIndex - 1])

  const clockMatch = text.match(/\b(\d{2}:\d{2}:\d{2}\s*(?:UTC|GMT|EST|EDT|CET|CEST|JST)?)\b/)
  if (clockMatch) reading.sessionTime = clockMatch[1].trim()

  // Watchlist rows: SYMBOL then price then change then change%.
  const known = ['SPX', 'NDQ', 'DJI', 'VIX', 'DXY', 'NKY', 'DAX', 'UKX', 'US10Y', 'GOLD', 'BTCUSD', 'ETHUSD']
  for (let i = 0; i < lines.length; i++) {
    if (!known.includes(lines[i])) continue
    const window = lines.slice(i + 1, i + 5)
    const last = window.map(parseNumber).find(v => v !== undefined && Math.abs(v) > 1)
    const pct = window.find(l => /%$/.test(l))
    if (last !== undefined && !reading.watchlist.some(w => w.symbol === lines[i])) {
      reading.watchlist.push({ symbol: lines[i], last, changePercent: parseNumber(pct) })
    }
  }

  // Usable means: we know WHAT is on screen and WHERE it is trading. Without
  // both, the assistant must ask rather than analyse.
  reading.usable = !!(reading.symbol && (reading.ohlc || reading.price !== undefined))
  return reading
}

/** Is this page a chart we know how to read? */
export function isChartUrl(url: string): boolean {
  return /(?:^|\.)(?:tradingview\.com|.*\.tradingview\.com)/i.test(safeHost(url))
}

function safeHost(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

/**
 * A one-line statement of what was read, for the top of the answer. The user
 * must always be able to see WHICH instrument and WHICH timeframe an analysis
 * is based on — that is what was missing when the assistant analysed "gold"
 * in the abstract.
 */
export function describeReading(reading: ChartReading): string {
  if (!reading.usable) return 'No readable chart on the active tab'
  const parts = [reading.symbol]
  if (reading.name) parts.push(`(${reading.name})`)
  if (reading.exchange) parts.push(`· ${reading.exchange}`)
  if (reading.interval) parts.push(`· ${reading.interval}`)
  if (reading.price !== undefined) parts.push(`· last ${reading.price}`)
  return parts.filter(Boolean).join(' ')
}
