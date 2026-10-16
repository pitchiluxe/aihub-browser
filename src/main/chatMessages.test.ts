import { describe, it, expect } from 'vitest'
import { sanitizeChatMessages, fitMessagesToBudget, withLocalSystem } from './chatMessages'

describe('withLocalSystem', () => {
  const msgs = [{ role: 'system', content: 'FULL MANUAL' }, { role: 'user', content: 'q' }]

  it('replaces only the system message', () => {
    expect(withLocalSystem(msgs, 'compact')).toEqual([{ role: 'system', content: 'compact' }, { role: 'user', content: 'q' }])
    expect(msgs[0].content).toBe('FULL MANUAL')
  })

  it('leaves messages alone without a usable compact prompt or system message', () => {
    expect(withLocalSystem(msgs, undefined)).toBe(msgs)
    expect(withLocalSystem(msgs, '  ')).toBe(msgs)
    expect(withLocalSystem(msgs, { evil: true })).toBe(msgs)
    const noSys = [{ role: 'user', content: 'q' }]
    expect(withLocalSystem(noSys, 'compact')).toBe(noSys)
  })
})

describe('sanitizeChatMessages', () => {
  it('drops messages with no content — OpenRouter rejects the whole request for one', () => {
    const out = sanitizeChatMessages([
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'q2' },
    ])
    expect(out.map(m => m.content)).toEqual(['sys', 'hi', 'q\n\nq2'])
  })

  it('keeps an image-only turn', () => {
    const out = sanitizeChatMessages([{ role: 'user', content: '', images: ['data:x'] }])
    expect(out).toHaveLength(1)
  })

  it('merges consecutive same-role turns but never merges system into anything', () => {
    const out = sanitizeChatMessages([
      { role: 'system', content: 'a' },
      { role: 'system', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'user', content: 'd', images: ['i'] },
    ])
    expect(out).toEqual([
      { role: 'system', content: 'a' },
      { role: 'system', content: 'b' },
      { role: 'user', content: 'c\n\nd', images: ['i'] },
    ])
  })

  it('does not mutate its input', () => {
    const input = [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]
    sanitizeChatMessages(input)
    expect(input[0].content).toBe('a')
  })
})

describe('fitMessagesToBudget', () => {
  const big = (n: number) => 'x'.repeat(n)

  it('returns the input untouched when it already fits', () => {
    const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]
    expect(fitMessagesToBudget(msgs, 1000)).toBe(msgs)
  })

  it('drops the oldest middle turns first, keeping the system prompt and the latest turn', () => {
    const out = fitMessagesToBudget([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: big(500) },
      { role: 'assistant', content: big(500) },
      { role: 'user', content: 'LATEST' },
    ], 700)
    expect(out[0].content).toBe('SYS')
    expect(out[out.length - 1].content).toBe('LATEST')
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(700)
  })

  it('shrinks the largest message when dropping turns is not enough', () => {
    const out = fitMessagesToBudget([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: big(5000) },
    ], 1000)
    expect(out[0].content).toBe('SYS')
    expect(out[1].content.length).toBeLessThanOrEqual(1000)
    expect(out[1].content).toContain('trimmed')
  })
})
