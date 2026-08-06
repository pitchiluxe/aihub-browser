import { describe, it, expect } from 'vitest'
import { extractTradePlans, mergeBracket } from './tradePlanBlocks'

/** The user's actual broken answer, verbatim. */
const REAL_ANSWER = `Let's continue with the trading advice.

The bias is range, but momentum is with the buyers. The analysis suggests that price is above both the 20 and 50 EMA and up 5.3% over the last 10 bars. However, structure has not confirmed a higher high yet.

For the long side, the entry zone is between 4260.3 and 4268.13, with a stop at 4220.98 and targets at 4304.03 (session high).

[trade-plan] { "symbol": "XAUUSD", "interval": "1D", "bias": "range", "direction": "long", "price": 4263.14, "bar": { "open": 4247.07, "high": 4304.03, "low": 4245.51, "close": 4263.15 }, "entry": { "from": 4260.3, "to": 4268.13 }, "stop": 4220.98, "targets": [ { "price": 4304.03, "label": "Session high", "rr": 0.92 } ], "invalidation": "Back below 4247.07 and the idea is wrong", "note": "Read from the 1D bar on your chart" } [trade-plan] { "symbol": "XAUUSD", "interval": "1D", "bias": "range", "direction": "short", "price": 4263.14, "bar": { "open": 4247.07, "high": 4304.03, "low": 4245.51, "close": 4263.15 }, "entry": { "from": 4247.07, "to": 4254.9 }, "stop": 4294.22, "targets": [ { "price": 4203.08, "label": "T1 · Swing high", "rr": 1.11 }, { "price": 4165.97, "label": "T2 · Swing high", "rr": 1.97 }, { "price": 4120, "label": "T3 · Swing high", "rr": 3.03 } ], "invalidation": "Back above 4247.07 and the idea is wrong", "note": "Read from the 1D bar on your chart" }

Please confirm before proceeding with either trade side.`

describe('the exact answer the user complained about', () => {
  const { text, plans } = extractTradePlans(REAL_ANSWER)
  const cards = mergeBracket(plans)

  it('shows no raw JSON in the prose any more', () => {
    expect(text).not.toContain('{')
    expect(text).not.toContain('trade-plan')
    expect(text).not.toContain('"targets"')
    // Numbers the model wrote in its own sentences are fine — and wanted.
    expect(text).toContain('4260.3')
  })

  it('keeps the readable analysis', () => {
    expect(text).toContain('momentum is with the buyers')
    expect(text).toContain('Please confirm')
  })

  it('renders as ONE bracket card with both sides', () => {
    expect(cards).toHaveLength(1)
    expect(cards[0].direction).toBe('bracket')
    expect(cards[0].scenarios.map((s: any) => s.direction)).toEqual(['long', 'short'])
  })

  it('carries the real numbers into the card', () => {
    const [long, short] = cards[0].scenarios
    expect(long.entry).toEqual({ from: 4260.3, to: 4268.13 })
    expect(long.stop).toBe(4220.98)
    expect(short.targets).toHaveLength(3)
    expect(short.stop).toBe(4294.22)
  })

  it('knows the short pays more — the sentence the coach must say', () => {
    const [long, short] = cards[0].scenarios
    expect(long.bestRr).toBeCloseTo(0.92, 2)
    expect(short.bestRr).toBeCloseTo(3.03, 2)
    expect(short.bestRr).toBeGreaterThan(long.bestRr)
  })
})
