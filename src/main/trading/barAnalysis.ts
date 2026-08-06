import { digitsFor, roundTo, roundNumbers, roundStepFor, type Level, type Bias, type TradePlan } from './levels'
import type { ChartReading, Ohlc } from './chartReader'

/**
 * AIHub Browser — turning ONE real bar into a real plan.
 *
 * The chart page gives the current bar's open, high, low and close for the
 * timeframe on screen. That is less than a full history, and the honest
 * response to that limit is to compute only what one bar actually supports —
 * not to invent the rest.
 *
 * One bar genuinely supports a lot: the session's own high and low are where
 * stops sit, the open is what the day is measured against, the midpoint is
 * equilibrium, and where the close sits inside that range says who won the
 * session. Everything below comes from those. Nothing below needs history,
 * so nothing below can be fabricated.
 */

export interface BarAnalysis {
  bias: Bias
  /** 0 = closed on the low, 1 = closed on the high. */
  rangePosition: number
  range: number
  levels: Level[]
  plan: TradePlan
  digits: number
  /** Written for the user: why this bias, in one sentence. */
  reasoning: string
  /** What this analysis cannot see, stated plainly. */
  limits: string[]
}

/** Where the close sits inside the bar, 0..1. Half for a zero-range bar. */
export function rangePosition(bar: Ohlc): number {
  const range = bar.high - bar.low
  if (!(range > 0)) return 0.5
  return Math.min(1, Math.max(0, (bar.close - bar.low) / range))
}

/**
 * Bias from one bar: where it closed in its own range, confirmed by whether
 * it closed above or below its open. Both agreeing is a real signal; a strong
 * close against a red bar is not, and honestly reads as balanced.
 */
export function barBias(bar: Ohlc): Bias {
  const position = rangePosition(bar)
  const closedUp = bar.close > bar.open
  if (position >= 0.66 && closedUp) return 'bullish'
  if (position <= 0.34 && !closedUp) return 'bearish'
  return 'range'
}

export function buildBarLevels(bar: Ohlc, price: number): Level[] {
  const digits = digitsFor(price)
  const range = bar.high - bar.low
  const mid = bar.low + range / 2
  const levels: Level[] = [
    { price: roundTo(bar.high, digits), label: 'Session high', kind: 'session-high', weight: 3 },
    { price: roundTo(bar.low, digits), label: 'Session low', kind: 'session-low', weight: 3 },
    { price: roundTo(bar.open, digits), label: 'Session open', kind: 'open', weight: 2 },
    { price: roundTo(mid, digits), label: 'Range midpoint (equilibrium)', kind: 'prior-close', weight: 2 },
  ]

  // Quarter levels: where a session that is trending tends to pause.
  if (range > 0) {
    levels.push({ price: roundTo(bar.low + range * 0.25, digits), label: 'Lower quarter', kind: 'swing-low', weight: 1 })
    levels.push({ price: roundTo(bar.low + range * 0.75, digits), label: 'Upper quarter', kind: 'swing-high', weight: 1 })
  }

  for (const value of roundNumbers(price, roundStepFor(price), 1)) {
    levels.push({ price: value, label: 'Round number', kind: 'round', weight: 1 })
  }

  // Collapse near-identical prices, strongest reason winning.
  const tolerance = Math.max(range * 0.02, price * 0.0002)
  const merged: Level[] = []
  for (const level of [...levels].sort((a, b) => b.weight - a.weight)) {
    if (merged.some(kept => Math.abs(kept.price - level.price) <= tolerance)) continue
    merged.push(level)
  }
  return merged.sort((a, b) => b.price - a.price)
}

/**
 * The plan. Entry is always a pullback to a level, never "buy at market":
 * chasing is the habit that costs new traders the most, and a coach that says
 * "enter now" teaches it.
 */
export function buildBarPlan(bar: Ohlc, price: number, levels: Level[], bias: Bias): TradePlan {
  const digits = digitsFor(price)
  const range = bar.high - bar.low
  // One bar has no ATR, so the bar's own range is the volatility unit — which
  // is what a session trader uses anyway.
  const buffer = Math.max(range * 0.12, price * 0.0004)

  if (bias === 'range' || !(range > 0)) {
    return {
      bias, direction: 'none', entry: null, stop: null, targets: [],
      invalidation: `Price closed mid-range (${Math.round(rangePosition(bar) * 100)}% of the session range) — neither side is in control. `
        + `Wait for a break and retest of ${roundTo(bar.high, digits)} or ${roundTo(bar.low, digits)} before committing.`,
      riskPerUnit: 0,
    }
  }

  const long = bias === 'bullish'
  const below = levels.filter(l => l.price < price).sort((a, b) => b.price - a.price)
  const above = levels.filter(l => l.price > price).sort((a, b) => a.price - b.price)
  const anchor = long ? below[0] : above[0]

  if (!anchor) {
    return {
      bias, direction: 'none', entry: null, stop: null, targets: [],
      invalidation: 'Price is beyond every level this bar provides — there is nothing to lean a stop against. Let a new level form.',
      riskPerUnit: 0,
    }
  }

  const entryFrom = roundTo(long ? anchor.price : anchor.price - buffer * 0.4, digits)
  const entryTo = roundTo(long ? anchor.price + buffer * 0.4 : anchor.price, digits)
  const entryMid = (entryFrom + entryTo) / 2
  const stopPrice = roundTo(long ? anchor.price - buffer : anchor.price + buffer, digits)
  const risk = Math.abs(entryMid - stopPrice)

  const structural = (long ? above : below).slice(0, 2)
  const extension = long
    ? { price: roundTo(bar.high + range * 0.5, digits), label: 'Range extension (+50%)' }
    : { price: roundTo(bar.low - range * 0.5, digits), label: 'Range extension (−50%)' }

  // Order by distance from entry BEFORE numbering: the range extension can
  // fall nearer than a structural level, and a T3 that is closer than T2
  // would have the trader taking profit in the wrong order.
  const targets = [...structural.map(l => ({ price: l.price, label: l.label })), extension]
    .filter(t => (long ? t.price > entryTo : t.price < entryFrom))
    .sort((a, b) => (long ? a.price - b.price : b.price - a.price))
    .map((t, index) => ({
      price: t.price,
      label: `T${index + 1} · ${t.label}`,
      rr: risk > 0 ? roundTo(Math.abs(t.price - entryMid) / risk, 2) : 0,
    }))
    .filter(t => t.rr > 0)

  return {
    bias,
    direction: long ? 'long' : 'short',
    entry: {
      from: Math.min(entryFrom, entryTo),
      to: Math.max(entryFrom, entryTo),
      rationale: `Wait for a pullback into ${anchor.label.toLowerCase()} (${anchor.price}) — do not chase ${price}`,
    },
    stop: {
      price: stopPrice,
      rationale: `${roundTo(buffer, digits)} beyond ${anchor.label.toLowerCase()}, about 12% of today's range — outside normal noise`,
    },
    targets,
    invalidation: long
      ? `Trading back below ${stopPrice} says buyers lost the level the idea rests on. Out there, no argument.`
      : `Trading back above ${stopPrice} says sellers lost the level the idea rests on. Out there, no argument.`,
    riskPerUnit: roundTo(risk, digits),
  }
}

export function analyseReading(reading: ChartReading): BarAnalysis | null {
  const bar = reading.ohlc
  const price = reading.price ?? bar?.close
  if (price === undefined) return null

  // Some TradingView layouts hide the OHLC legend until the crosshair is over
  // a bar. Rather than inventing one, say what IS knowable from a live price:
  // the round numbers around it. Every other field stays empty, and the limits
  // say why — an honest partial answer beats a confident fabricated one.
  if (!bar) {
    const digits = digitsFor(price)
    const levels: Level[] = roundNumbers(price, roundStepFor(price), 2)
      .map(value => ({ price: value, label: 'Round number', kind: 'round' as const, weight: 1 as const }))
      .sort((a, b) => b.price - a.price)
    return {
      bias: 'range',
      rangePosition: 0.5,
      range: 0,
      levels,
      plan: {
        bias: 'range', direction: 'none', entry: null, stop: null, targets: [],
        invalidation: 'No bar data is visible on this chart, so there is no structure to trade against yet.',
        riskPerUnit: 0,
      },
      digits,
      reasoning: `Live price is ${roundTo(price, digits)}, but this chart layout is not showing the bar's open, high, low and close.`,
      limits: [
        'The OHLC legend is not visible on your chart, so no session high, low or open could be read.',
        'Hover the crosshair over a bar (or turn the OHLC legend on in TradingView settings) and ask again for a full plan.',
      ],
    }
  }

  const bias = barBias(bar)
  const levels = buildBarLevels(bar, price)
  const plan = buildBarPlan(bar, price, levels, bias)
  const position = rangePosition(bar)
  const digits = digitsFor(price)

  const reasoning = bias === 'bullish'
    ? `Closed at ${Math.round(position * 100)}% of the ${reading.interval || 'current'} range and above the open — buyers finished in control.`
    : bias === 'bearish'
      ? `Closed at ${Math.round(position * 100)}% of the ${reading.interval || 'current'} range and below the open — sellers finished in control.`
      : `Closed at ${Math.round(position * 100)}% of the ${reading.interval || 'current'} range — neither side finished in control.`

  const limits = [
    `Read from the ${reading.interval || 'current'} bar on your open chart, not from history — prior-day levels and swing structure are not in this view.`,
  ]
  if (!reading.watchlist.length) limits.push('No cross-market context (DXY, indices) was visible on the page.')

  return {
    bias,
    rangePosition: roundTo(position, 2),
    range: roundTo(bar.high - bar.low, digits),
    levels,
    plan,
    digits,
    reasoning,
    limits,
  }
}
