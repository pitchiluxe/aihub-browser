import { describe, it, expect } from 'vitest'
import { createNavigationWarmup } from './navigationWarmup'

describe('navigation warming budget', () => {
  it('rejects unsafe schemes, credentials, and malformed payloads', () => {
    const accept = createNavigationWarmup()
    for (const value of [null, {}, 'file:///secret', 'javascript:alert(1)', 'https://user:pass@example.com', 'broken']) {
      expect(accept(value)).toBeNull()
    }
    expect(accept('https://example.com/path?q=private')).toBe('https://example.com')
  })
  it('deduplicates origins and bounds traffic over time', () => {
    let time = 0
    const accept = createNavigationWarmup(() => time)
    expect(accept('https://a.test/')).toBe('https://a.test')
    expect(accept('https://b.test/')).toBeNull()
    time = 1000
    expect(accept('https://a.test/other')).toBeNull()
    for (let i = 1; i < 8; i++) {
      time += 1000
      expect(accept(`https://host${i}.test`)).not.toBeNull()
    }
    time += 1000
    expect(accept('https://overflow.test')).toBeNull()
    time = 40_000
    expect(accept('https://overflow.test')).toBe('https://overflow.test')
  })
})
