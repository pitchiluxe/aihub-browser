import { describe, it, expect } from 'vitest'
import { extractTradePlans, looksLikeTradePlan, mergeBracket } from './tradePlanBlocks'

const LONG = {
  symbol: 'XAUUSD', interval: '1D', bias: 'range', direction: 'long', price: 4263.14,
  entry: { from: 4260.3, to: 4268.13 }, stop: 4220.98,
  targets: [{ price: 4304.03, label: 'Session high', rr: 0.92 }],
}
const SHORT = {
  symbol: 'XAUUSD', interval: '1D', bias: 'range', direction: 'short', price: 4263.14,
  entry: { from: 4247.07, to: 4254.9 }, stop: 4294.22,
  targets: [
    { price: 4203.08, label: 'T1', rr: 1.11 },
    { price: 4165.97, label: 'T2', rr: 1.97 },
    { price: 4120, label: 'T3', rr: 3.03 },
  ],
}

describe('looksLikeTradePlan', () => {
  it('accepts a real plan', () => {
    expect(looksLikeTradePlan(LONG)).toBe(true)
  })
  it('rejects other JSON the model might emit', () => {
    expect(looksLikeTradePlan({ tool: 'read_chart' })).toBe(false)
    expect(looksLikeTradePlan({ symbol: 'XAUUSD' })).toBe(false)   // identity but no numbers
    expect(looksLikeTradePlan([LONG])).toBe(false)
    expect(looksLikeTradePlan(null)).toBe(false)
  })
})

describe('extractTradePlans — the fenced form the prompt asks for', () => {
  it('pulls the plan out and leaves the prose', () => {
    const md = 'Here is the setup.\n\n```trade-plan\n' + JSON.stringify(LONG) + '\n```\n\nGood luck.'
    const { text, plans } = extractTradePlans(md)
    expect(plans).toHaveLength(1)
    expect(plans[0].symbol).toBe('XAUUSD')
    expect(text).toContain('Here is the setup.')
    expect(text).not.toContain('trade-plan')
    expect(text).not.toContain('4260.3')
  })
})

describe('extractTradePlans — what the local model ACTUALLY emitted', () => {
  // Verbatim shape from the user's failing screenshot.
  const md = `Let's continue with the trading advice.

The bias is range, but momentum is with the buyers.

[trade-plan] ${JSON.stringify(LONG)} [trade-plan] ${JSON.stringify(SHORT)}

Please confirm before proceeding.`

  it('finds BOTH plans despite the bracket wrapper', () => {
    const { plans } = extractTradePlans(md)
    expect(plans).toHaveLength(2)
    expect(plans[0].direction).toBe('long')
    expect(plans[1].direction).toBe('short')
  })

  it('leaves no raw JSON in the prose — the actual complaint', () => {
    const { text } = extractTradePlans(md)
    expect(text).not.toContain('{')
    expect(text).not.toContain('trade-plan')
    expect(text).toContain('momentum is with the buyers')
    expect(text).toContain('Please confirm')
  })
})

describe('extractTradePlans — other shapes seen in the wild', () => {
  it('handles <trade-plan> and (trade-plan)', () => {
    expect(extractTradePlans(`<trade-plan> ${JSON.stringify(LONG)}`).plans).toHaveLength(1)
    expect(extractTradePlans(`(trade-plan): ${JSON.stringify(LONG)}`).plans).toHaveLength(1)
  })

  it('handles a bare object with no wrapper at all', () => {
    const { text, plans } = extractTradePlans(`Setup below.\n${JSON.stringify(LONG)}\nThanks.`)
    expect(plans).toHaveLength(1)
    expect(text).not.toContain('{')
  })

  it('leaves ordinary code blocks and JSON examples alone', () => {
    const md = 'Here is some code:\n\n```json\n{"hello":"world"}\n```\n'
    const { text, plans } = extractTradePlans(md)
    expect(plans).toHaveLength(0)
    expect(text).toContain('hello')
  })

  it('survives malformed JSON without eating the answer', () => {
    const md = 'Analysis.\n\n```trade-plan\n{ broken json\n```\n'
    const { text, plans } = extractTradePlans(md)
    expect(plans).toHaveLength(0)
    expect(text).toContain('Analysis.')
  })

  it('is safe on empty input', () => {
    expect(extractTradePlans('')).toEqual({ text: '', plans: [] })
    expect(extractTradePlans(undefined as any).plans).toEqual([])
  })
})

describe('mergeBracket — two sides of one decision', () => {
  it('merges a long and a short into a single bracket card', () => {
    const merged = mergeBracket([LONG, SHORT])
    expect(merged).toHaveLength(1)
    expect(merged[0].direction).toBe('bracket')
    expect(merged[0].scenarios).toHaveLength(2)
  })

  it('carries each side’s best reward-to-risk, so they can be compared', () => {
    const [card] = mergeBracket([LONG, SHORT])
    const long = card.scenarios.find((s: any) => s.direction === 'long')
    const short = card.scenarios.find((s: any) => s.direction === 'short')
    expect(long.bestRr).toBeCloseTo(0.92, 2)
    expect(short.bestRr).toBeCloseTo(3.03, 2)
  })

  it('drops the top-level entry/stop so the card cannot show one side twice', () => {
    const [card] = mergeBracket([LONG, SHORT])
    expect(card.entry).toBeUndefined()
    expect(card.stop).toBeUndefined()
    expect(card.targets).toBeUndefined()
  })

  it('leaves a single plan exactly as it was', () => {
    expect(mergeBracket([LONG])).toEqual([LONG])
    expect(mergeBracket([])).toEqual([])
  })

  it('does not merge two plans in the same direction', () => {
    expect(mergeBracket([LONG, { ...LONG }])).toHaveLength(2)
  })
})
