import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { dayKey, spreadOverDays, verseForDay, verseList } from './dailyVerse'
import { parseRef } from './bibleService'

const BIBLE_DIR = join(process.cwd(), 'src/renderer/src/assets/bible')
const index = JSON.parse(readFileSync(join(BIBLE_DIR, 'index.json'), 'utf-8'))
const bookById = new Map<string, any>(index.books.map((b: any) => [b.id, b]))
const bookCache = new Map<string, any>()

function verseExists(ref: string): boolean {
  const parsed = parseRef(ref)
  if (!parsed) return false
  const meta = bookById.get(parsed.bookId)
  if (!meta) return false
  if (!bookCache.has(parsed.bookId)) {
    bookCache.set(parsed.bookId, JSON.parse(readFileSync(join(BIBLE_DIR, `${meta.slug}.json`), 'utf-8')))
  }
  const chapter = bookCache.get(parsed.bookId).chapters[parsed.chapter - 1]
  return Array.isArray(chapter) && chapter.some((v: any) => v.v === parsed.verse)
}

describe('verseForDay — the same day always gives the same verse', () => {
  it('is stable across calls, which is what survives a remount', () => {
    const d = new Date(2026, 7, 16)
    expect(verseForDay(d)).toBe(verseForDay(d))
    expect(verseForDay('2026-08-16')).toBe(verseForDay(new Date(2026, 7, 16)))
  })

  it('does not depend on the time of day', () => {
    expect(verseForDay(new Date(2026, 7, 16, 0, 1))).toBe(verseForDay(new Date(2026, 7, 16, 23, 59)))
  })

  it('changes when the date does', () => {
    expect(verseForDay('2026-08-16')).not.toBe(verseForDay('2026-08-17'))
  })

  it('always returns a reference from the curated list', () => {
    const list = new Set(verseList())
    for (let i = 0; i < 400; i++) {
      const d = new Date(2026, 0, 1)
      d.setDate(d.getDate() + i)
      expect(list.has(verseForDay(d))).toBe(true)
    }
  })
})

describe('the curated list', () => {
  const list = verseList()

  it('is long enough that a verse does not come round every fortnight', () => {
    expect(list.length).toBeGreaterThanOrEqual(200)
  })

  it('contains no duplicates', () => {
    expect(new Set(list).size).toBe(list.length)
  })

  it('spans both testaments', () => {
    const ot = new Set(index.books.filter((b: any) => b.testament === 'OT').map((b: any) => b.id))
    const fromOT = list.filter(r => ot.has(r.split('.')[0])).length
    expect(fromOT).toBeGreaterThan(40)
    expect(list.length - fromOT).toBeGreaterThan(40)
  })

  it('resolves every reference to a verse that actually exists', () => {
    const missing = list.filter(ref => !verseExists(ref))
    expect(missing).toEqual([])
  })
})

describe('spread', () => {
  it('does not repeat the same verse on consecutive days', () => {
    const days = spreadOverDays(new Date(2026, 0, 1), 120)
    for (let i = 1; i < days.length; i++) expect(days[i]).not.toBe(days[i - 1])
  })

  it('reaches a wide part of the list over a year, not one corner of it', () => {
    const days = spreadOverDays(new Date(2026, 0, 1), 365)
    expect(new Set(days).size).toBeGreaterThan(150)
  })
})

describe('dayKey', () => {
  it('formats the local calendar date, zero-padded', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
