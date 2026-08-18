import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Guards for the kids editions, written after every one of these failed
// silently in a build that compiled, typechecked and shipped.
//
// None of this is reachable by the type system: the text lives in JSON, the
// illustrations are resolved by a build-time glob, and a missing file shows up
// as a blank page or a grey box rather than an error.

const HERE = dirname(fileURLToPath(import.meta.url))
const ART = join(HERE, '../../assets/illustrations')
const EDITIONS = ['web-kids', 'lsg-kids'] as const

type Verse = { v: number; t: string; img?: string }
type Book = { id: string; name: string; chapters: Verse[][] }
type Meta = { id: string; name: string; slug: string; chapters: number }

const readIndex = (edition: string): { books: Meta[] } =>
  JSON.parse(readFileSync(join(HERE, edition, 'index.json'), 'utf8'))

const readBook = (edition: string, slug: string): Book =>
  JSON.parse(readFileSync(join(HERE, edition, `${slug}.json`), 'utf8'))

const artOnDisk = new Set(
  readdirSync(ART).filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, '')),
)

describe.each(EDITIONS)('kids edition — %s', edition => {
  const index = readIndex(edition)

  it('lists at least one book', () => {
    expect(index.books.length).toBeGreaterThan(0)
  })

  it('lists only books whose asset file exists', () => {
    // An index entry with no file behind it puts a dead option in the reader's
    // book picker: choosing it throws instead of turning a page.
    const files = new Set(
      readdirSync(join(HERE, edition))
        .filter(f => f.endsWith('.json') && f !== 'index.json')
        .map(f => f.replace(/\.json$/, '')),
    )
    for (const b of index.books) expect(files.has(b.slug)).toBe(true)
  })

  it('states each book’s real chapter count', () => {
    // The chapter picker is built from this number. Overstating it offers
    // chapters that render as empty pages.
    for (const b of index.books) {
      expect(readBook(edition, b.slug).chapters.length).toBe(b.chapters)
    }
  })

  it('has no empty chapters and no empty verses', () => {
    for (const b of index.books) {
      const book = readBook(edition, b.slug)
      expect(book.chapters.length).toBeGreaterThan(0)
      book.chapters.forEach((ch, i) => {
        expect(ch.length, `${b.slug} chapter ${i + 1} is empty`).toBeGreaterThan(0)
        for (const verse of ch) expect(verse.t.trim().length).toBeGreaterThan(0)
      })
    }
  })

  it('numbers verses from 1 without gaps', () => {
    for (const b of index.books) {
      for (const ch of readBook(edition, b.slug).chapters) {
        expect(ch.map(v => v.v)).toEqual(ch.map((_, i) => i + 1))
      }
    }
  })

  it('only references illustrations that exist on disk', () => {
    // A missing id is not an error at runtime — the reader just shows a grey
    // box where the picture should be, which is exactly how it shipped once.
    const missing: string[] = []
    for (const b of index.books) {
      for (const ch of readBook(edition, b.slug).chapters) {
        for (const verse of ch) {
          if (verse.img && !artOnDisk.has(verse.img)) missing.push(`${b.slug}: ${verse.img}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe('the kids editions line up with each other', () => {
  it('carries the same books, chapters and verses in both languages', () => {
    const en = readIndex('web-kids')
    const fr = readIndex('lsg-kids')
    expect(fr.books.map(b => b.id)).toEqual(en.books.map(b => b.id))

    for (const b of en.books) {
      const bookEn = readBook('web-kids', b.slug)
      const bookFr = readBook('lsg-kids', b.slug)
      expect(bookFr.chapters.length).toBe(bookEn.chapters.length)
      bookEn.chapters.forEach((ch, i) => {
        expect(bookFr.chapters[i].map(v => v.v)).toEqual(ch.map(v => v.v))
      })
    }
  })

  it('shows the same picture at the same verse in both languages', () => {
    // The illustrations are shared files with no words in them, so a verse
    // that is illustrated in English must be illustrated in French too.
    for (const b of readIndex('web-kids').books) {
      const en = readBook('web-kids', b.slug)
      const fr = readBook('lsg-kids', b.slug)
      en.chapters.forEach((ch, i) => {
        expect(fr.chapters[i].map(v => v.img ?? null)).toEqual(ch.map(v => v.img ?? null))
      })
    }
  })

  it('never numbers a chapter beyond the canonical book', () => {
    // Kids chapters retell the chapter of the same number, which is what keeps
    // a saved verse or highlight landing on the same story across versions.
    const canonical: Record<string, number> = { GEN: 50, MAT: 28, JHN: 21 }
    for (const b of readIndex('web-kids').books) {
      expect(canonical[b.id]).toBeDefined()
      expect(b.chapters).toBeLessThanOrEqual(canonical[b.id])
    }
  })
})

describe('the illustrations themselves', () => {
  it('contain no text, so one file serves both languages', () => {
    // A caption baked into the artwork is wrong in whichever language it is
    // not written in. The first set shipped with English captions.
    const withText: string[] = []
    for (const id of artOnDisk) {
      const svg = readFileSync(join(ART, `${id}.svg`), 'utf8')
      if (/<text[\s>]/.test(svg)) withText.push(id)
    }
    expect(withText).toEqual([])
  })

  it('are all used by at least one verse', () => {
    const used = new Set<string>()
    for (const edition of EDITIONS) {
      for (const b of readIndex(edition).books) {
        for (const ch of readBook(edition, b.slug).chapters) {
          for (const verse of ch) if (verse.img) used.add(verse.img)
        }
      }
    }
    const orphans = [...artOnDisk].filter(id => !used.has(id))
    expect(orphans).toEqual([])
  })
})
