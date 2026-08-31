import { describe, it, expect } from 'vitest'
import {
  textKey, isWorthRemembering, findDuplicate, addItem, removeItem, review,
  dueItems, allItems, whenNextDue, stats, itemsForUrl, formatDue, MAX_TEXT, type RecallBook,
} from './recall'
import { DAY_MS } from '../../../shared/leitner'

const NOW = Date.parse('2026-08-31T09:00:00Z')

const seed = (): RecallBook => {
  const a = addItem({}, { text: 'Fluid compute reuses instances', url: 'https://a.test/x', title: 'A' }, NOW, 'i1')
  const b = addItem(a.items, { text: 'MHTML is a single file', url: 'https://b.test/y', title: 'B' }, NOW, 'i2')
  return b.items
}

describe('textKey', () => {
  it('ignores the line breaks a page happened to have', () => {
    expect(textKey('one   two\nthree')).toBe(textKey('one two three'))
  })
  it('is case-insensitive', () => {
    expect(textKey('Hello')).toBe(textKey('hello'))
  })
})

describe('isWorthRemembering', () => {
  it('rejects a click that grazed a word', () => {
    expect(isWorthRemembering('a')).toBe(false)
    expect(isWorthRemembering('  ')).toBe(false)
  })
  it('accepts a real sentence', () => {
    expect(isWorthRemembering('Box level is the mastery level.')).toBe(true)
  })
  it('rejects an excerpt too long to memorise', () => {
    expect(isWorthRemembering('x'.repeat(MAX_TEXT + 1))).toBe(false)
    expect(isWorthRemembering('x'.repeat(MAX_TEXT))).toBe(true)
  })
})

describe('addItem', () => {
  it('adds a highlight due immediately', () => {
    const { items, item } = addItem({}, { text: 'Something true', url: 'https://a.test/', title: 'A' }, NOW, 'i1')
    expect(item?.id).toBe('i1')
    expect(items.i1.schedule.box).toBe(1)
    expect(items.i1.schedule.dueAt).toBe(NOW)
  })
  it('refuses a selection that is not worth remembering', () => {
    const { items, item } = addItem({}, { text: 'x', url: 'https://a.test/' }, NOW)
    expect(item).toBeNull()
    expect(Object.keys(items)).toHaveLength(0)
  })
  it('does not reset the schedule when the same passage is highlighted again', () => {
    let book = seed()
    book = review(book, 'i1', true, NOW)
    book = review(book, 'i1', true, NOW)
    const promoted = book.i1.schedule.box
    expect(promoted).toBe(3)

    const again = addItem(book, { text: 'fluid   compute reuses INSTANCES', url: 'https://a.test/x' }, NOW + 5000)
    expect(again.duplicate).toBe(true)
    expect(again.items.i1.schedule.box).toBe(3)
    expect(Object.keys(again.items)).toHaveLength(2)
  })
  it('keeps an optional prompt but drops an empty one', () => {
    const withCue = addItem({}, { text: 'Paris', url: 'u', prompt: '  Capital of France ' }, NOW, 'i1')
    expect(withCue.items.i1.prompt).toBe('Capital of France')
    const without = addItem({}, { text: 'Paris', url: 'u', prompt: '   ' }, NOW, 'i2')
    expect(without.items.i2.prompt).toBeUndefined()
  })
})

describe('findDuplicate / removeItem', () => {
  it('finds a passage regardless of spacing and case', () => {
    expect(findDuplicate(seed(), 'MHTML  is a SINGLE file')?.id).toBe('i2')
  })
  it('returns null for something new', () => {
    expect(findDuplicate(seed(), 'never seen')).toBeNull()
  })
  it('removes by id and leaves the rest alone', () => {
    const after = removeItem(seed(), 'i1')
    expect(Object.keys(after)).toEqual(['i2'])
  })
  it('is a no-op for an unknown id', () => {
    const book = seed()
    expect(removeItem(book, 'nope')).toBe(book)
  })
})

describe('review', () => {
  it('promotes one box on a pass and pushes the due date out', () => {
    const after = review(seed(), 'i1', true, NOW)
    expect(after.i1.schedule.box).toBe(2)
    expect(after.i1.schedule.dueAt).toBe(NOW + 3 * DAY_MS)
    expect(after.i1.schedule.reviews).toBe(1)
  })
  it('drops to box 1 on a miss, however well known it was', () => {
    let book = review(seed(), 'i1', true, NOW)
    book = review(book, 'i1', true, NOW)
    book = review(book, 'i1', false, NOW)
    expect(book.i1.schedule.box).toBe(1)
    expect(book.i1.schedule.dueAt).toBe(NOW + DAY_MS)
  })
  it('ignores an unknown id', () => {
    const book = seed()
    expect(review(book, 'nope', true, NOW)).toBe(book)
  })
})

describe('dueItems', () => {
  it('returns everything due, soonest-overdue first', () => {
    expect(dueItems(seed(), NOW).map(i => i.id)).toEqual(['i1', 'i2'])
  })
  it('drops what has been reviewed until its interval elapses', () => {
    const after = review(seed(), 'i1', true, NOW)
    expect(dueItems(after, NOW).map(i => i.id)).toEqual(['i2'])
    // i2 has been overdue since NOW, so it stays ahead of the item that was
    // just reviewed — the queue is ordered by how long something has waited.
    expect(dueItems(after, NOW + 3 * DAY_MS).map(i => i.id)).toEqual(['i2', 'i1'])
  })
  it('is empty when nothing is scheduled', () => {
    expect(dueItems({}, NOW)).toEqual([])
  })
})

describe('allItems / whenNextDue / stats', () => {
  it('lists best-known first', () => {
    const after = review(seed(), 'i2', true, NOW)
    expect(allItems(after).map(i => i.id)).toEqual(['i2', 'i1'])
  })
  it('reports when the queue next wakes up', () => {
    const after = review(review(seed(), 'i1', true, NOW), 'i2', true, NOW)
    expect(whenNextDue(after)).toBe(NOW + 3 * DAY_MS)
    expect(whenNextDue({})).toBeNull()
  })
  it('counts the queue, the boxes and what is mastered', () => {
    let book = seed()
    for (let i = 0; i < 4; i++) book = review(book, 'i1', true, NOW)
    const s = stats(book, NOW)
    expect(s.total).toBe(2)
    expect(s.mastered).toBe(1)
    expect(s.byBox[5]).toBe(1)
    expect(s.byBox[1]).toBe(1)
    expect(s.due).toBe(1)
  })
})

describe('itemsForUrl', () => {
  it('matches a page however its URL was written', () => {
    expect(itemsForUrl(seed(), 'https://A.test/x/').map(i => i.id)).toEqual(['i1'])
    expect(itemsForUrl(seed(), 'https://a.test/x#part2').map(i => i.id)).toEqual(['i1'])
  })
  it('is empty for a page with no highlights', () => {
    expect(itemsForUrl(seed(), 'https://elsewhere.test/')).toEqual([])
  })
})

describe('formatDue', () => {
  it('says now for anything already due', () => {
    expect(formatDue(NOW, NOW)).toBe('now')
    expect(formatDue(NOW - DAY_MS, NOW)).toBe('now')
  })
  it('describes the future rather than the past', () => {
    expect(formatDue(NOW + 30 * 60_000, NOW)).toBe('in 30 min')
    expect(formatDue(NOW + 5 * 3_600_000, NOW)).toBe('in 5 hr')
    expect(formatDue(NOW + DAY_MS, NOW)).toBe('tomorrow')
    expect(formatDue(NOW + 7 * DAY_MS, NOW)).toBe('in 7 days')
  })
})
