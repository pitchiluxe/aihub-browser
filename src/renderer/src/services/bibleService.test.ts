import { describe, it, expect } from 'vitest'
import { getBooks, getChapter, refKey, parseRef, formatRef } from './bibleService'

describe('bibleService references', () => {
  it('builds a reference key', () => {
    expect(refKey('JHN', 3, 16)).toBe('JHN.3.16')
  })

  it('parses a reference key', () => {
    expect(parseRef('JHN.3.16')).toEqual({ bookId: 'JHN', chapter: 3, verse: 16 })
  })

  it('returns null for malformed keys', () => {
    expect(parseRef('nonsense')).toBeNull()
    expect(parseRef('JHN.3')).toBeNull()
    expect(parseRef('ZZZ.3.16')).toBeNull()
  })

  it('formats a reference for display', () => {
    expect(formatRef('JHN.3.16')).toBe('John 3:16')
    expect(formatRef('1CO.13.4')).toBe('1 Corinthians 13:4')
  })
})

describe('bibleService data', () => {
  it('exposes 66 books', () => {
    expect(getBooks()).toHaveLength(66)
  })

  it('loads a chapter', async () => {
    const ch = await getChapter('JHN', 3)
    expect(ch.find(v => v.v === 16)?.t).toContain('For God so loved the world')
  })

  it('returns an empty array for an out-of-range chapter', async () => {
    expect(await getChapter('JHN', 999)).toEqual([])
  })
})
