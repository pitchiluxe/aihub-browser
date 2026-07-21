import { describe, it, expect } from 'vitest'
import { normalizeBook } from './normalize-bible.mjs'

describe('normalizeBook', () => {
  it('groups verses into chapters and trims whitespace', () => {
    const tokens = [
      { type: 'paragraph start' },
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 1, value: 'In the beginning.  ' },
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 2, value: 'The same was.  ' },
      { type: 'paragraph text', chapterNumber: 2, verseNumber: 1, value: 'Second chapter.  ' },
    ]
    const out = normalizeBook(tokens)
    expect(out.chapters).toHaveLength(2)
    expect(out.chapters[0]).toEqual([{ v: 1, t: 'In the beginning.' }, { v: 2, t: 'The same was.' }])
    expect(out.chapters[1]).toEqual([{ v: 1, t: 'Second chapter.' }])
  })

  it('joins fragments that share a verse number', () => {
    const tokens = [
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 1, value: 'First half ' },
      { type: 'line text',      chapterNumber: 1, verseNumber: 1, value: 'second half.' },
    ]
    expect(normalizeBook(tokens).chapters[0]).toEqual([{ v: 1, t: 'First half second half.' }])
  })

  it('ignores structural tokens that carry no verse number', () => {
    const tokens = [
      { type: 'paragraph start' },
      { type: 'chapter', chapterNumber: 1 },
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 1, value: 'Only verse.' },
      { type: 'paragraph end' },
    ]
    expect(normalizeBook(tokens).chapters[0]).toEqual([{ v: 1, t: 'Only verse.' }])
  })

  it('collapses internal whitespace runs', () => {
    const tokens = [
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 1, value: 'Spaced   out\n  text.' },
    ]
    expect(normalizeBook(tokens).chapters[0][0].t).toBe('Spaced out text.')
  })
})
