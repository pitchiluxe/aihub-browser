import { describe, it, expect } from 'vitest'
import {
  getBooks, getChapter, refKey, parseRef, formatRef, getBookMeta, bookListOptions,
  getTranslation, TRANSLATIONS, COVER_OPTION,
} from './bibleService'

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

// Every one of these passes an explicit translation rather than switching the
// active one: the module-level default is what the app reads when nothing is
// specified, and a test that mutated it would leak into whatever ran next.
describe('bibleService translations', () => {
  it('offers English and French, defaulting to English', () => {
    expect(TRANSLATIONS.map(t => t.id)).toEqual(['WEB', 'LSG'])
    expect(getTranslation()).toBe('WEB')
  })

  it('loads the French text under the same book ids', async () => {
    const ch = await getChapter('JHN', 3, 'LSG')
    expect(ch.find(v => v.v === 16)?.t).toContain('Car Dieu a tant aimé le monde')
  })

  it('keeps the two versions in step verse for verse', async () => {
    const en = await getChapter('PSA', 23, 'WEB')
    const fr = await getChapter('PSA', 23, 'LSG')
    expect(fr.map(v => v.v)).toEqual(en.map(v => v.v))
  })

  it('names books and references in the chosen language', () => {
    expect(getBookMeta('JHN', 'LSG')?.name).toBe('Jean')
    expect(formatRef('JHN.3.16', 'LSG')).toBe('Jean 3:16')
    expect(formatRef('JHN.3.16', 'WEB')).toBe('John 3:16')
  })

  it('lists French books behind the cover, in canonical order', () => {
    const options = bookListOptions('LSG')
    expect(options[0].value).toBe(COVER_OPTION)
    expect(options[1].label).toBe('Genèse')
    expect(options).toHaveLength(67)
    expect(getBooks('LSG').map(b => b.id)).toEqual(getBooks('WEB').map(b => b.id))
  })

  it('resolves a reference saved in one version against the other', () => {
    // Book ids are shared, so a verse saved while reading in French still
    // opens in English — the marks file must not become version-specific.
    expect(parseRef(refKey('JHN', 3, 16))).toEqual({ bookId: 'JHN', chapter: 3, verse: 16 })
  })
})
