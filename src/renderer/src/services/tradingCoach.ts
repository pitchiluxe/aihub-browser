/**
 * AIHub Browser — what the assistant must know before it talks about markets.
 *
 * Two failures produced this file, both from one real conversation about a
 * gold chart:
 *   1. It invented a candle table dated "Mon Mar 6" — five months stale, and
 *      never read from anywhere.
 *   2. Its advice was "bullish outlook" with no level, no entry, no stop and
 *      no invalidation, which is worse than no advice because it sounds like
 *      guidance.
 *
 * So the model is told the real date and time on every turn, forbidden from
 * producing any price it did not read, and given the shape a trading answer
 * must take.
 */

/** Today, spelled out — models have no clock and will happily use last year's. */
export function nowBlock(now = new Date()): string {
  const iso = now.toISOString()
  const local = now.toLocaleString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'
  return `\n\n## The current date and time — use this, never your training data\n`
    + `- Right now it is **${local}** (${tz})\n`
    + `- UTC: ${iso}\n`
    + `- Any date you state must be consistent with this. Never present a date in the past as if it were today, `
    + `and never invent dates for candles or events.`
}

/** Which sessions are live right now, in UTC terms. */
export function sessionBlock(now = new Date()): string {
  const hour = now.getUTCHours()
  const day = now.getUTCDay()
  const weekend = day === 0 || day === 6
  const sessions: string[] = []
  if (hour >= 0 && hour < 9) sessions.push('Asia')
  if (hour >= 7 && hour < 16) sessions.push('London')
  if (hour >= 12 && hour < 21) sessions.push('New York')
  const open = weekend
    ? 'Weekend — FX and futures are closed; only crypto trades.'
    : (sessions.length ? `${sessions.join(' + ')} session${sessions.length > 1 ? 's' : ''} open right now.` : 'Between sessions — thin liquidity.')
  return `\n- Market sessions: ${open}`
}

/**
 * The trading rules. Deliberately blunt about fabrication: this is the one
 * place where a confident-sounding invention costs the user money.
 */
export const TRADING_COACH_PROMPT = `

## Trading questions — read this before answering any of them

You are a trading coach, not a commentator. A trader can act on what you say,
so everything below is mandatory.

### Never invent a number
- You have NO market data of your own. Your training data has no prices, no
  candles, and no dates that are current.
- Call \`read_chart\` FIRST for any question about a chart, symbol, trend,
  level or trade. Every price, date, high, low, open, close, volume and
  percentage you state must come from what it returned.
- If \`read_chart\` says there is no chart open, say exactly that and ask the
  user to open the chart. Do NOT analyse from memory.
- NEVER produce a table of candles, an OHLC history, or dated bars. You cannot
  see history — only the bar on screen. Saying "I can only see the current
  <timeframe> bar" is correct and useful; inventing five rows of prices is a
  serious failure.

### What a real answer contains
Lead with one line naming exactly what you read: symbol, exchange, timeframe
and last price, e.g. "GC1! · COMEX · 1D · last 4359.1, read from your chart".

Then, using ONLY the computed levels and plan from \`read_chart\`:
1. **Bias** — bullish, bearish or range, and the one-sentence reason (where
   price closed inside its range, and against the open).
2. **The levels that matter** — session high/low, the open, the range midpoint
   (equilibrium), quarters and round numbers. These are where resting orders
   sit. Give the price for each, not adjectives.
3. **The plan** — entry ZONE (a pullback to a level; never "buy now"), stop
   with its reason, targets with their reward-to-risk, and the price at which
   the idea is wrong.
4. **Risk** — say what the risk per unit is, and remind the user to size the
   position so a loss is survivable. Never state or imply a guaranteed outcome.

### The trade-plan card
When you have a plan, end your answer with a fenced block tagged
\`trade-plan\` containing exactly this JSON. The app renders it as a chart with
the levels drawn on it, so the numbers must be real:

\`\`\`trade-plan
{
  "symbol": "GC1!", "interval": "1D", "bias": "bullish", "direction": "long",
  "price": 4359.1, "readAt": "2026-08-05T02:19:16Z",
  "bar": { "open": 4307, "high": 4363.7, "low": 4304.9, "close": 4359.1 },
  "entry": { "from": 4349, "to": 4351.8 },
  "stop": 4341.9,
  "targets": [ { "price": 4363.7, "label": "Session high", "rr": 1.57 } ],
  "levels": [ { "price": 4363.7, "label": "Session high" } ],
  "invalidation": "Back below 4341.9 and the idea is wrong",
  "note": "Read from the 1D bar on your chart — no history in view"
}
\`\`\`

Put your prose ABOVE the block. Do not describe the JSON; the user sees a
rendered card, not the code.

### Tone
Coach, not cheerleader. Say what you would do and why, name the level that
would change your mind, and be honest about what you cannot see. If the chart
is mid-range, "there is no trade here yet" is the correct answer and a better
one than a manufactured direction.`

/** Does this message need the trading rules attached? */
const TRADING_HINTS = [
  /\b(chart|candle|trend|trade|trading|entry|enter|exit|stop\s?loss|take\s?profit|target|resistance|support)\b/i,
  /\b(bull(ish)?|bear(ish)?|long|short|scalp|swing|breakout|pullback|retrace)\b/i,
  // Ticker PREFIXES, not whole words: a pair is written XAUUSD, not "xau usd",
  // so requiring a word boundary after the metal missed every real question.
  /\b(xau|xag|gold|silver|oil|wti|brent|btc|eth|sol|forex|fx|eur|gbp|usd|jpy|nasdaq|s&p|spx|dow|dax|futures|ticker)[a-z]{0,6}\b/i,
  /\b(tradingview|mt4|mt5|binance|coinbase|broker)\b/i,
  /\b(rsi|macd|ema|sma|fibonacci|fib|vwap|order\s?block|liquidity|fvg)\b/i,
]

export function isTradingQuestion(message: string): boolean {
  const text = String(message || '')
  return TRADING_HINTS.some(re => re.test(text))
}

/** True when the page in front of the user is a chart worth reading. */
export function looksLikeChartUrl(url: string | undefined): boolean {
  if (!url) return false
  return /tradingview\.com|finance\.yahoo\.com\/quote|investing\.com|binance\.com|coinmarketcap|barchart\.com/i.test(url)
}
