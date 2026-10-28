import { describe, it, expect } from 'vitest'
import { getBookMeta, parseRef } from './bibleService'
import { dayLabel, daysInMonth, MONTH_THEMES, monthlyPlan, themeChapters } from './bibleMonthlyPlan'

describe('the month themes', () => {
  it('covers all twelve months, in order', () => {
    expect(MONTH_THEMES.map(t => t.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('only points at books and chapters that exist', () => {
    for (const theme of MONTH_THEMES) {
      for (const r of theme.readings) {
        const meta = getBookMeta(r.bookId)
        expect(meta, `${theme.title}: ${r.bookId}`).toBeTruthy()
        expect(r.from).toBeGreaterThanOrEqual(1)
        expect(r.to).toBeGreaterThanOrEqual(r.from)
        expect(r.to, `${theme.title}: ${r.bookId} ${r.to}`).toBeLessThanOrEqual(meta!.chapters)
      }
    }
  })

  it('gives every month a real verse to carry', () => {
    for (const theme of MONTH_THEMES) {
      expect(theme.verses.length).toBeGreaterThan(0)
      for (const ref of theme.verses) expect(parseRef(ref), `${theme.title}: ${ref}`).not.toBeNull()
    }
  })
})

describe('spreading a month across its days', () => {
  // A leap year and a common year, so February is checked at both lengths.
  for (const year of [2027, 2028]) {
    for (let month = 1; month <= 12; month++) {
      it(`${year}-${month}: one entry per day, none empty, every chapter once`, () => {
        const plan = monthlyPlan(year, month)
        expect(plan.days).toHaveLength(daysInMonth(year, month))
        for (const d of plan.days) expect(d.passages.length, `day ${d.date}`).toBeGreaterThan(0)
        const read = plan.days.flatMap(d => d.passages.map(p => `${p.bookId}.${p.chapter}`))
        const expected = themeChapters(plan.theme).map(c => `${c.bookId}.${c.chapter}`)
        expect(read).toEqual(expected)
      })
    }
  }

  it('reads Proverbs by the date in May', () => {
    const may = monthlyPlan(2027, 5)
    expect(may.days.every(d => d.passages[0].chapter === d.date)).toBe(true)
  })

  it('lands the nativity on Christmas Day', () => {
    const christmas = monthlyPlan(2026, 12).days[24]
    expect(christmas.passages.map(p => `${p.bookId}.${p.chapter}`)).toEqual(['LUK.2'])
  })

  it('keeps a different progress key for the same month in another year', () => {
    expect(monthlyPlan(2026, 11).id).toBe('month-2026-11')
    expect(monthlyPlan(2027, 11).id).not.toBe(monthlyPlan(2026, 11).id)
  })
})

describe('day labels', () => {
  it('joins consecutive chapters into a range', () => {
    expect(dayLabel([{ bookId: 'GEN', chapter: 1 }, { bookId: 'GEN', chapter: 2 }])).toBe('Genesis 1–2')
  })

  it('names a single psalm in the singular', () => {
    expect(dayLabel([{ bookId: 'PSA', chapter: 95 }])).toBe('Psalm 95')
  })

  it('separates books', () => {
    expect(dayLabel([{ bookId: 'RUT', chapter: 4 }, { bookId: 'HOS', chapter: 1 }])).toBe('Ruth 4 · Hosea 1')
  })
})
