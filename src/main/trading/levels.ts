/**
 * AIHub Browser — the arithmetic behind a trade plan.
 *
 * This module exists because of a specific failure: asked to analyse a gold
 * chart, the assistant produced a neat table of "Mon Mar 6" candles with open,
 * high, low and close values — all invented, none read from anywhere, and
 * dated five months in the past. Plausible-looking fabricated prices are the
 * most dangerous thing a trading assistant can produce.
 *
 * So levels are COMPUTED here from real candles, and the model is given the
 * numbers rather than asked to imagine them. Everything is pure: no network,
 * no clock, no Electron — feed it candles, get levels back, and the behaviour
 * is verifiable.
 *
 * "Institutional levels" is a loose phrase; what desks actually watch, and
 * what this computes, is: the prior session's high/low/close, the current
 * day/week open, overnight and session extremes, recent swing pivots that
 * price has already reacted to, and round numbers. Those are the places
 * resting orders cluster.
 */

export interface Candle {
  /** Epoch ms of the bar's open. */
  t: number
  o: number
  h: number
  l: number
  c: number
  v?: number
}

export type Bias = 'bullish' | 'bearish' | 'range'

export interface Level {
  price: number
  label: string
  /** Why a desk would care about this price. */
  kind: 'prior-high' | 'prior-low' | 'prior-close' | 'open' | 'swing-high' | 'swing-low' | 'round' | 'session-high' | 'session-low'
  /** 1 (minor) to 3 (major) — how much attention it deserves. */
  weight: 1 | 2 | 3
}

// ── Basic series maths ─────────────────────────────────────────────────────

export function ema(values: number[], period: number): number[] {
  if (!values.length || period <= 0) return []
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values[0]
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

/**
 * Average True Range — the honest unit for stops. A stop measured in ATR
 * adapts to what the instrument is actually doing; a stop measured in "20
 * points" is a guess that is too tight in London and too wide at 3am.
 */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0
  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].c
    trs.push(Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - prevClose),
      Math.abs(candles[i].l - prevClose),
    ))
  }
  const window = trs.slice(-period)
  if (!window.length) return 0
  return window.reduce((sum, v) => sum + v, 0) / window.length
}

/** Sensible price precision for display, inferred from the instrument's scale. */
export function digitsFor(price: number): number {
  const abs = Math.abs(price)
  if (abs >= 1000) return 2
  if (abs >= 100) return 2
  if (abs >= 10) return 3
  if (abs >= 1) return 4
  return 5
}

export function roundTo(price: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(price * factor) / factor
}

// ── Structure ──────────────────────────────────────────────────────────────

export interface Swing { index: number; price: number; kind: 'high' | 'low' }

/**
 * Swing pivots: a bar whose high is the highest of the `strength` bars either
 * side (and the mirror for lows). These are the points price has already
 * turned at, which is what makes them levels rather than lines on a chart.
 */
export function swingPoints(candles: Candle[], strength = 2): Swing[] {
  const out: Swing[] = []
  for (let i = strength; i < candles.length - strength; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue
      if (candles[j].h >= candles[i].h) isHigh = false
      if (candles[j].l <= candles[i].l) isLow = false
    }
    if (isHigh) out.push({ index: i, price: candles[i].h, kind: 'high' })
    if (isLow) out.push({ index: i, price: candles[i].l, kind: 'low' })
  }
  return out
}

/**
 * Trend from market structure, not from an indicator's opinion: higher highs
 * AND higher lows is an uptrend; the mirror is a downtrend; anything else is a
 * range, and saying "range" is far more useful to a trader than forcing a
 * direction the chart does not support.
 */
export function structureBias(candles: Candle[], strength = 2): Bias {
  const swings = swingPoints(candles, strength)
  const highs = swings.filter(s => s.kind === 'high').slice(-3)
  const lows = swings.filter(s => s.kind === 'low').slice(-3)
  if (highs.length < 2 || lows.length < 2) return 'range'

  const higherHighs = highs[highs.length - 1].price > highs[highs.length - 2].price
  const higherLows = lows[lows.length - 1].price > lows[lows.length - 2].price
  const lowerHighs = highs[highs.length - 1].price < highs[highs.length - 2].price
  const lowerLows = lows[lows.length - 1].price < lows[lows.length - 2].price

  if (higherHighs && higherLows) return 'bullish'
  if (lowerHighs && lowerLows) return 'bearish'
  return 'range'
}

// ── Levels ─────────────────────────────────────────────────────────────────

/** Group candles by calendar day in UTC. */
export function groupByDay(candles: Candle[]): Map<string, Candle[]> {
  const byDay = new Map<string, Candle[]>()
  for (const candle of candles) {
    const key = new Date(candle.t).toISOString().slice(0, 10)
    const list = byDay.get(key)
    if (list) list.push(candle)
    else byDay.set(key, [candle])
  }
  return byDay
}

export function sessionStats(candles: Candle[]): { high: number; low: number; open: number; close: number } | null {
  if (!candles.length) return null
  return {
    high: Math.max(...candles.map(c => c.h)),
    low: Math.min(...candles.map(c => c.l)),
    open: candles[0].o,
    close: candles[candles.length - 1].c,
  }
}

/** The round numbers around price — where stop clusters and option strikes sit. */
export function roundNumbers(price: number, step: number, count = 2): number[] {
  if (!(step > 0)) return []
  const base = Math.round(price / step) * step
  const out: number[] = []
  for (let i = -count; i <= count; i++) {
    const value = base + i * step
    if (value > 0) out.push(roundTo(value, digitsFor(price)))
  }
  return out
}

/** A sane round-number step for the instrument's price scale. */
export function roundStepFor(price: number): number {
  const abs = Math.abs(price)
  if (abs >= 10000) return 500
  if (abs >= 1000) return 50
  if (abs >= 100) return 10
  if (abs >= 10) return 1
  if (abs >= 1) return 0.05
  return 0.005
}

export interface LevelSet {
  levels: Level[]
  atr: number
  bias: Bias
  price: number
  digits: number
}

/**
 * Everything worth marking on the chart, computed from real bars.
 * `intraday` supplies the finer session structure; `daily` gives the prior-day
 * and weekly references a desk actually quotes.
 */
export function buildLevels(intraday: Candle[], daily: Candle[]): LevelSet {
  const price = intraday.length ? intraday[intraday.length - 1].c : (daily.length ? daily[daily.length - 1].c : 0)
  const digits = digitsFor(price)
  const levels: Level[] = []
  const add = (p: number | undefined, label: string, kind: Level['kind'], weight: Level['weight']) => {
    if (typeof p === 'number' && isFinite(p) && p > 0) levels.push({ price: roundTo(p, digits), label, kind, weight })
  }

  // Prior completed day — the single most quoted reference on any desk.
  if (daily.length >= 2) {
    const prior = daily[daily.length - 2]
    add(prior.h, 'Prior day high', 'prior-high', 3)
    add(prior.l, 'Prior day low', 'prior-low', 3)
    add(prior.c, 'Prior day close', 'prior-close', 2)
  }
  if (daily.length >= 1) {
    add(daily[daily.length - 1].o, "Today's open", 'open', 2)
  }

  // Today's range so far, from intraday bars.
  const days = [...groupByDay(intraday).entries()].sort((a, b) => a[0].localeCompare(b[0]))
  if (days.length) {
    const today = sessionStats(days[days.length - 1][1])
    if (today) {
      add(today.high, 'Session high', 'session-high', 2)
      add(today.low, 'Session low', 'session-low', 2)
    }
  }

  // Swing pivots price has already reacted to, nearest first.
  const swings = swingPoints(intraday, 2)
  const recentHighs = swings.filter(s => s.kind === 'high').slice(-3)
  const recentLows = swings.filter(s => s.kind === 'low').slice(-3)
  for (const swing of recentHighs) add(swing.price, 'Swing high', 'swing-high', 1)
  for (const swing of recentLows) add(swing.price, 'Swing low', 'swing-low', 1)

  for (const value of roundNumbers(price, roundStepFor(price), 1)) {
    add(value, 'Round number', 'round', 1)
  }

  // Collapse levels that land on effectively the same price — three lines a
  // tick apart is noise, and the strongest reason should win.
  const tolerance = Math.max(atr(intraday, 14) * 0.15, price * 0.0002)
  const merged: Level[] = []
  for (const level of [...levels].sort((a, b) => b.weight - a.weight)) {
    if (merged.some(kept => Math.abs(kept.price - level.price) <= tolerance)) continue
    merged.push(level)
  }

  return {
    levels: merged.sort((a, b) => b.price - a.price),
    atr: roundTo(atr(intraday, 14), digits),
    bias: structureBias(intraday),
    price: roundTo(price, digits),
    digits,
  }
}

// ── The plan ───────────────────────────────────────────────────────────────

export interface TradePlan {
  bias: Bias
  direction: 'long' | 'short' | 'none'
  entry: { from: number; to: number; rationale: string } | null
  stop: { price: number; rationale: string } | null
  targets: { price: number; label: string; rr: number }[]
  invalidation: string
  riskPerUnit: number
}

/** Nearest level strictly below / above a price. */
export function nearestBelow(levels: Level[], price: number): Level | null {
  return levels.filter(l => l.price < price).sort((a, b) => b.price - a.price)[0] || null
}
export function nearestAbove(levels: Level[], price: number): Level | null {
  return levels.filter(l => l.price > price).sort((a, b) => a.price - b.price)[0] || null
}

/**
 * Turn levels into an actionable plan: where to enter, where the idea is
 * wrong, and what it pays if it works.
 *
 * The entry is a PULLBACK zone toward the nearest level in the trade's
 * favour, never "buy here at market" — chasing is the most expensive habit a
 * new trader has, and a plan that says "enter now" teaches it. The stop sits
 * beyond that level by a fraction of ATR, so normal noise does not touch it.
 */
export function buildTradePlan(levelSet: LevelSet, options?: { minRR?: number }): TradePlan {
  const { levels, price, atr: atrValue, bias, digits } = levelSet
  const minRR = options?.minRR ?? 1.5
  const buffer = Math.max(atrValue * 0.35, price * 0.0004)

  if (bias === 'range' || !atrValue || !levels.length) {
    return {
      bias,
      direction: 'none',
      entry: null,
      stop: null,
      targets: [],
      invalidation: 'No trend structure right now — price is ranging. Wait for a clean break and retest before committing.',
      riskPerUnit: 0,
    }
  }

  const long = bias === 'bullish'
  const support = nearestBelow(levels, price)
  const resistance = nearestAbove(levels, price)

  // Enter on a return to the level behind the move, not at the current print.
  const anchor = long ? support : resistance
  if (!anchor) {
    return {
      bias, direction: 'none', entry: null, stop: null, targets: [],
      invalidation: 'No usable level between price and the stop — nothing to lean the trade against.',
      riskPerUnit: 0,
    }
  }

  const entryFrom = roundTo(long ? anchor.price : anchor.price - buffer * 0.5, digits)
  const entryTo = roundTo(long ? anchor.price + buffer * 0.5 : anchor.price, digits)
  const entryMid = (entryFrom + entryTo) / 2
  const stopPrice = roundTo(long ? anchor.price - buffer : anchor.price + buffer, digits)
  const risk = Math.abs(entryMid - stopPrice)

  const targetLevels = (long
    ? levels.filter(l => l.price > entryTo).sort((a, b) => a.price - b.price)
    : levels.filter(l => l.price < entryFrom).sort((a, b) => b.price - a.price)
  ).slice(0, 3)

  const targets = targetLevels.map((level, index) => ({
    price: level.price,
    label: `${index + 1}. ${level.label}`,
    rr: risk > 0 ? roundTo(Math.abs(level.price - entryMid) / risk, 2) : 0,
  })).filter(t => t.rr > 0)

  // A plan whose best target does not pay for its risk is not a plan.
  if (!targets.length || targets[targets.length - 1].rr < minRR) {
    return {
      bias,
      direction: 'none',
      entry: null,
      stop: null,
      targets,
      invalidation: `The nearest levels do not pay ${minRR}R for the risk this setup needs. Wait for price to reach a level worth trading from.`,
      riskPerUnit: roundTo(risk, digits),
    }
  }

  return {
    bias,
    direction: long ? 'long' : 'short',
    entry: {
      from: Math.min(entryFrom, entryTo),
      to: Math.max(entryFrom, entryTo),
      rationale: `Pullback into ${anchor.label.toLowerCase()} at ${anchor.price}, in line with ${bias} structure`,
    },
    stop: {
      price: stopPrice,
      rationale: `${roundTo(buffer, digits)} beyond ${anchor.label.toLowerCase()} (about 0.35 ATR) — below normal noise`,
    },
    targets,
    invalidation: long
      ? `A close below ${stopPrice} breaks the higher-low structure. The long idea is wrong there, not "wrong eventually".`
      : `A close above ${stopPrice} breaks the lower-high structure. The short idea is wrong there.`,
    riskPerUnit: roundTo(risk, digits),
  }
}

/** Position size from account risk — the only number that keeps a trader alive. */
export function positionSize(accountBalance: number, riskPercent: number, riskPerUnit: number): number {
  if (!(accountBalance > 0) || !(riskPercent > 0) || !(riskPerUnit > 0)) return 0
  return Math.floor((accountBalance * (riskPercent / 100)) / riskPerUnit * 100) / 100
}
