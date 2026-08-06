import { describe, it, expect } from 'vitest'
import { nowBlock, sessionBlock, isTradingQuestion, looksLikeChartUrl, TRADING_COACH_PROMPT } from './tradingCoach'

describe('nowBlock — the fix for "Mon Mar 6" answers in August', () => {
  const block = nowBlock(new Date(Date.UTC(2026, 7, 5, 14, 30)))

  it('states the real date in full', () => {
    expect(block).toContain('2026')
    expect(block).toMatch(/August/i)
  })

  it('carries a machine-readable UTC timestamp too', () => {
    expect(block).toContain('2026-08-05T14:30')
  })

  it('forbids inventing dates in as many words', () => {
    expect(block).toMatch(/never invent dates/i)
  })
})

describe('sessionBlock', () => {
  it('knows London and New York overlap in the afternoon', () => {
    const block = sessionBlock(new Date(Date.UTC(2026, 7, 5, 14, 0)))
    expect(block).toContain('London')
    expect(block).toContain('New York')
  })

  it('knows the Asian session', () => {
    expect(sessionBlock(new Date(Date.UTC(2026, 7, 5, 2, 0)))).toContain('Asia')
  })

  it('says plainly that the weekend is closed', () => {
    // 2026-08-08 is a Saturday.
    expect(sessionBlock(new Date(Date.UTC(2026, 7, 8, 12, 0)))).toMatch(/weekend/i)
  })
})

describe('isTradingQuestion', () => {
  it('catches the questions a trader actually asks', () => {
    for (const q of [
      'is the trend bullish for the rest of the week?',
      'what do you think about this chart',
      'where should I enter XAUUSD',
      'give me a stop loss and target for gold',
      'analyse the RSI on this tradingview chart',
      'should I long or short btc here',
    ]) {
      expect(isTradingQuestion(q), q).toBe(true)
    }
  })

  it('leaves ordinary questions alone, so the prompt stays small', () => {
    for (const q of [
      'summarize this page',
      'what is the capital of Kenya',
      'write me a python script',
      'find my resume',
    ]) {
      expect(isTradingQuestion(q), q).toBe(false)
    }
  })

  it('is safe on empty input', () => {
    expect(isTradingQuestion('')).toBe(false)
    expect(isTradingQuestion(undefined as any)).toBe(false)
  })
})

describe('looksLikeChartUrl', () => {
  it('recognises the sites charts live on', () => {
    expect(looksLikeChartUrl('https://www.tradingview.com/chart/?symbol=GC1!')).toBe(true)
    expect(looksLikeChartUrl('https://finance.yahoo.com/quote/AAPL')).toBe(true)
  })
  it('is false for everything else', () => {
    expect(looksLikeChartUrl('https://news.ycombinator.com')).toBe(false)
    expect(looksLikeChartUrl(undefined)).toBe(false)
  })
})

describe('TRADING_COACH_PROMPT', () => {
  it('bans invented candle tables explicitly — the exact failure it exists for', () => {
    expect(TRADING_COACH_PROMPT).toMatch(/NEVER produce a table of candles/i)
    expect(TRADING_COACH_PROMPT).toMatch(/no prices, no\s*\n?\s*candles/i)
  })

  it('does not claim the assistant is blind to history — read_chart now returns it', () => {
    expect(TRADING_COACH_PROMPT).not.toMatch(/You cannot\s+see history/i)
    expect(TRADING_COACH_PROMPT).toMatch(/real history/i)
  })

  it('requires read_chart before any market answer', () => {
    expect(TRADING_COACH_PROMPT).toMatch(/read_chart` FIRST/i)
  })

  it('demands entry, stop, targets and invalidation — not just a direction', () => {
    for (const word of ['entry', 'stop', 'targets', 'invalid']) {
      expect(TRADING_COACH_PROMPT.toLowerCase()).toContain(word)
    }
  })

  it('forbids chasing by requiring a pullback zone', () => {
    expect(TRADING_COACH_PROMPT).toMatch(/never "buy now"/i)
  })

  it('requires both sides of a bracket instead of "wait and see"', () => {
    expect(TRADING_COACH_PROMPT).toMatch(/never answer only "wait and see"/i)
    expect(TRADING_COACH_PROMPT).toMatch(/if\/then/i)
  })

  it('requires calling out a setup that does not pay for its risk', () => {
    expect(TRADING_COACH_PROMPT).toMatch(/less than 1R is not worth the risk/i)
  })

  it('documents the trade-plan card the app renders', () => {
    expect(TRADING_COACH_PROMPT).toContain('trade-plan')
    expect(TRADING_COACH_PROMPT).toMatch(/"targets"/)
  })

  it('no longer ships an example note claiming there is no history', () => {
    // The model copied this verbatim into real answers, where it was false.
    expect(TRADING_COACH_PROMPT).not.toMatch(/no history in view/i)
  })

  it('tells the model to emit one block per bracket side', () => {
    expect(TRADING_COACH_PROMPT).toMatch(/ONE block per side/i)
  })

  it('forbids inventing or altering the numbers read_chart returned', () => {
    expect(TRADING_COACH_PROMPT).toMatch(/do not add a target it did not give you/i)
  })
})
