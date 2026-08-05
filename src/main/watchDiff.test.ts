import { describe, it, expect } from 'vitest'
import { normalizeForCompare, contentHash, hasChanged, describeChange, containsKeyword } from './watchDiff'

describe('normalizeForCompare', () => {
  it('neutralises clocks, dates and relative times', () => {
    const a = normalizeForCompare('Updated 2026-08-05T07:15:00Z at 07:15 — 3 minutes ago')
    const b = normalizeForCompare('Updated 2026-08-06T09:44:10Z at 09:44 — 41 minutes ago')
    expect(a).toBe(b)
  })

  it('neutralises view counts and opaque tokens', () => {
    const a = normalizeForCompare('1,204,553 views csrf=aG9sZHRoaXN0b2tlbnZhbHVlMTIzNDU2')
    const b = normalizeForCompare('1,204,987 views csrf=b3RoZXJ0b2tlbnZhbHVlOTg3NjU0MzIx')
    expect(a).toBe(b)
  })

  it('collapses whitespace so a reflow is not a change', () => {
    expect(normalizeForCompare('Price:    £10\n\n\n  In stock')).toBe('Price: £10\nIn stock')
  })

  it('keeps the words that actually carry the meaning', () => {
    expect(normalizeForCompare('Senior Engineer — London')).toContain('Senior Engineer')
  })
})

describe('contentHash / hasChanged', () => {
  const page = (price: string, time: string) => `Widget\nPrice: ${price}\nUpdated ${time}\n1,204,553 views`

  it('treats the first check as a baseline, never a change', () => {
    expect(hasChanged(undefined, page('£10', '07:15'))).toBe(false)
  })

  it('ignores a page whose only movement is its own clock and counters', () => {
    const first = contentHash(page('£10', '07:15'))
    expect(hasChanged(first, page('£10', '11:48'))).toBe(false)
  })

  it('reports a real content change', () => {
    const first = contentHash(page('£10', '07:15'))
    expect(hasChanged(first, page('£8', '07:15'))).toBe(true)
  })

  it('is stable across calls', () => {
    expect(contentHash('same text')).toBe(contentHash('same text'))
    expect(contentHash('same text')).not.toBe(contentHash('other text'))
  })

  it('handles empty pages without throwing', () => {
    expect(() => contentHash('')).not.toThrow()
    expect(hasChanged(contentHash(''), '')).toBe(false)
  })
})

describe('describeChange', () => {
  it('quotes the line that appeared', () => {
    const before = 'Open roles\nSenior Engineer — London'
    const after = 'Open roles\nSenior Engineer — London\nStaff Engineer — Remote (Europe)'
    expect(describeChange(before, after)).toBe('Staff Engineer — Remote (Europe)')
  })

  it('ignores lines that only differ by a timestamp', () => {
    expect(describeChange('Updated 3 minutes ago on this page', 'Updated 9 minutes ago on this page'))
      .toBe('This page changed since you last looked')
  })

  it('falls back to a neutral sentence when something was only removed', () => {
    expect(describeChange('Line one here\nLine two here', 'Line one here'))
      .toBe('This page changed since you last looked')
  })

  it('truncates a very long added line', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i % 7}`).join(' ')
    const out = describeChange('before text here', `before text here\n${long}`, 60)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('…')).toBe(true)
  })

  it('skips noise-length lines', () => {
    expect(describeChange('body text here', 'body text here\nok')).toBe('This page changed since you last looked')
  })
})

describe('containsKeyword', () => {
  it('matches case-insensitively', () => {
    expect(containsKeyword('Now In Stock', 'in stock')).toBe(true)
    expect(containsKeyword('Sold out', 'in stock')).toBe(false)
  })
  it('is false for an empty keyword rather than always true', () => {
    expect(containsKeyword('anything', '')).toBe(false)
    expect(containsKeyword('anything', '   ')).toBe(false)
  })
})
