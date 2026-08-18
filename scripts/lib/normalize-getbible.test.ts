import { describe, it, expect } from 'vitest'
import { normalizeGetBibleBook } from './normalize-getbible.mjs'

describe('normalizeGetBibleBook', () => {
  it('groups verses into chapters and trims the padding upstream leaves', () => {
    const payload = {
      chapters: [
        { chapter: 1, verses: [
          { chapter: 1, verse: 1, text: 'Au commencement, Dieu créa les cieux et la terre. ' },
          { chapter: 1, verse: 2, text: 'La terre était informe. ' },
        ] },
        { chapter: 2, verses: [{ chapter: 2, verse: 1, text: 'Ainsi furent achevés les cieux. ' }] },
      ],
    }
    const out = normalizeGetBibleBook(payload)
    expect(out.chapters).toHaveLength(2)
    expect(out.chapters[0]).toEqual([
      { v: 1, t: 'Au commencement, Dieu créa les cieux et la terre.' },
      { v: 2, t: 'La terre était informe.' },
    ])
    expect(out.chapters[1]).toEqual([{ v: 1, t: 'Ainsi furent achevés les cieux.' }])
  })

  it('collapses internal whitespace runs', () => {
    const payload = { chapters: [{ chapter: 1, verses: [{ verse: 1, text: 'Espacé   ainsi\n  écrit.' }] }] }
    expect(normalizeGetBibleBook(payload).chapters[0][0].t).toBe('Espacé ainsi écrit.')
  })

  it('orders verses by number rather than trusting the payload order', () => {
    const payload = { chapters: [{ chapter: 1, verses: [
      { verse: 2, text: 'Second.' },
      { verse: 1, text: 'Premier.' },
    ] }] }
    expect(normalizeGetBibleBook(payload).chapters[0].map((v: { v: number }) => v.v)).toEqual([1, 2])
  })

  it('places chapters by their own number, so a gap stays a gap', () => {
    // A missing chapter must not shift every later one down by one — the build
    // script checks the count and fails, which it cannot do if the hole closes
    // itself silently.
    const payload = { chapters: [
      { chapter: 1, verses: [{ verse: 1, text: 'Un.' }] },
      { chapter: 3, verses: [{ verse: 1, text: 'Trois.' }] },
    ] }
    const out = normalizeGetBibleBook(payload)
    expect(out.chapters).toHaveLength(3)
    expect(out.chapters[1]).toBeUndefined()
    expect(out.chapters[2]).toEqual([{ v: 1, t: 'Trois.' }])
  })

  it('skips entries with no usable text or number', () => {
    const payload = { chapters: [
      { chapter: 'x', verses: [{ verse: 1, text: 'Ignoré.' }] },
      { chapter: 1, verses: [{ verse: 1, text: 'Gardé.' }, { verse: 2 }, { text: 'Sans numéro.' }] },
    ] }
    expect(normalizeGetBibleBook(payload).chapters[0]).toEqual([{ v: 1, t: 'Gardé.' }])
  })

  it('survives an empty payload', () => {
    expect(normalizeGetBibleBook(undefined).chapters).toEqual([])
    expect(normalizeGetBibleBook({}).chapters).toEqual([])
  })
})
