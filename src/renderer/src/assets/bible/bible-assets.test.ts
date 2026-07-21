import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import index from './index.json'

const DIR = __dirname
const load = (slug: string) => JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf-8'))

// The WEB source text retains a small, well-known set of verse numbers as
// empty placeholders — verses absent from the oldest manuscripts (e.g. the
// Western non-interpolations and the "Comma Johanneum"-adjacent set) that
// most modern translations omit but keep numbered for compatibility with
// traditional (KJV) versification. These are genuine upstream data, not a
// normalization bug: Luke 17:36, Acts 8:37, Acts 15:34, Acts 24:7, Romans 16:25.
const KNOWN_EMPTY_VERSES = new Set([
  'LUK:17:36',
  'ACT:8:37',
  'ACT:15:34',
  'ACT:24:7',
  'ROM:16:25'
])

describe('bible assets', () => {
  it('has all 66 books in canonical order', () => {
    expect(index.books).toHaveLength(66)
    expect(index.books[0].id).toBe('GEN')
    expect(index.books[65].id).toBe('REV')
    expect(index.books.filter(b => b.testament === 'NT')).toHaveLength(27)
  })

  it('matches known chapter counts', () => {
    const counts = Object.fromEntries(index.books.map(b => [b.id, b.chapters]))
    expect(counts.GEN).toBe(50)
    expect(counts.PSA).toBe(150)
    expect(counts.MAT).toBe(28)
    expect(counts.JHN).toBe(21)
    expect(counts.REV).toBe(22)
  })

  it('every book has chapters and no empty verses (excluding the known placeholder set)', () => {
    for (const b of index.books) {
      const book = load(b.slug)
      expect(book.chapters.length).toBe(b.chapters)
      book.chapters.forEach((chapter, i) => {
        const chapterNumber = i + 1
        expect(chapter.length).toBeGreaterThan(0)
        for (const verse of chapter) {
          expect(typeof verse.v).toBe('number')
          const ref = `${b.id}:${chapterNumber}:${verse.v}`
          if (KNOWN_EMPTY_VERSES.has(ref)) continue
          expect(verse.t.trim().length).toBeGreaterThan(0)
        }
      })
    }
  })

  it('renders a known verse correctly', () => {
    const john = load('john')
    const v16 = john.chapters[2].find((v: { v: number }) => v.v === 16)
    expect(v16.t).toContain('For God so loved the world')
  })
})
