import { describe, it, expect } from 'vitest'
import {
  BOX_INTERVAL_DAYS, DAY_MS, dueVerses, grade, initialProgress, labStats,
  nextDueAt, nextReviewAt, type VerseBook,
} from './bibleSrs'

const NOW = Date.UTC(2026, 7, 16, 9, 0, 0)

describe('grade — promotion and demotion', () => {
  it('promotes exactly one box on a pass, never two', () => {
    const first = grade(initialProgress(NOW), true, NOW)
    expect(first.box).toBe(2)
    const second = grade(first, true, NOW)
    expect(second.box).toBe(3)
  })

  it('stops at box 5 rather than running off the end', () => {
    let p = initialProgress(NOW)
    for (let i = 0; i < 10; i++) p = grade(p, true, NOW)
    expect(p.box).toBe(5)
  })

  it('drops straight to box 1 on a miss, from any height', () => {
    let p = initialProgress(NOW)
    for (let i = 0; i < 4; i++) p = grade(p, true, NOW)
    expect(p.box).toBe(5)
    expect(grade(p, false, NOW).box).toBe(1)
  })

  it('records the result and counts the review either way', () => {
    const pass = grade(initialProgress(NOW), true, NOW)
    expect(pass.lastResult).toBe('pass')
    expect(pass.reviews).toBe(1)
    const fail = grade(pass, false, NOW)
    expect(fail.lastResult).toBe('fail')
    expect(fail.reviews).toBe(2)
  })

  it('treats a missing or corrupt record as box 1 rather than throwing', () => {
    expect(grade(undefined, true, NOW).box).toBe(2)
    expect(grade({ box: 99 as any, dueAt: 0 }, true, NOW).box).toBe(2)
  })
})

describe('due dates', () => {
  it('schedules each box at its documented interval', () => {
    for (const box of [1, 2, 3, 4, 5] as const) {
      expect(nextReviewAt(box, NOW) - NOW).toBe(BOX_INTERVAL_DAYS[box] * DAY_MS)
    }
  })

  it('sets the new due date from the box the verse landed in', () => {
    const promoted = grade({ box: 1, dueAt: NOW }, true, NOW)
    expect(promoted.dueAt).toBe(NOW + 3 * DAY_MS)
    const demoted = grade({ box: 4, dueAt: NOW }, false, NOW)
    expect(demoted.dueAt).toBe(NOW + 1 * DAY_MS)
  })

  it('makes a newly added verse due immediately', () => {
    expect(initialProgress(NOW).dueAt).toBe(NOW)
  })
})

describe('dueVerses — what the Lab asks for now', () => {
  const verses: VerseBook = {
    'JHN.3.16': { box: 2, dueAt: NOW - 2 * DAY_MS },
    'PSA.23.1': { box: 1, dueAt: NOW - 5 * DAY_MS },
    'ROM.8.28': { box: 3, dueAt: NOW + DAY_MS },
    'PHP.4.13': { box: 5, dueAt: NOW },
  }

  it('returns only what is due at or before now', () => {
    expect(dueVerses(verses, NOW)).toEqual(['PSA.23.1', 'JHN.3.16', 'PHP.4.13'])
  })

  it('puts the most overdue first', () => {
    expect(dueVerses(verses, NOW)[0]).toBe('PSA.23.1')
  })

  it('orders identical due times the same way every time', () => {
    const tied: VerseBook = { 'B.1.1': { box: 1, dueAt: NOW }, 'A.1.1': { box: 1, dueAt: NOW } }
    expect(dueVerses(tied, NOW)).toEqual(dueVerses(tied, NOW))
    expect(dueVerses(tied, NOW)).toEqual(['A.1.1', 'B.1.1'])
  })

  it('is empty, not undefined, when nothing has been added', () => {
    expect(dueVerses({}, NOW)).toEqual([])
  })

  it('reports when the next verse comes back', () => {
    expect(nextDueAt(verses)).toBe(NOW - 5 * DAY_MS)
    expect(nextDueAt({})).toBeNull()
  })
})

describe('labStats', () => {
  it('counts the shelf, what is due, and what is actually known', () => {
    const verses: VerseBook = {
      a: { box: 5, dueAt: NOW - 1 },
      b: { box: 5, dueAt: NOW + DAY_MS },
      c: { box: 1, dueAt: NOW - 1 },
    }
    const s = labStats(verses, NOW)
    expect(s.total).toBe(3)
    expect(s.due).toBe(2)
    expect(s.mastered).toBe(2)
    expect(s.byBox[5]).toBe(2)
    expect(s.byBox[1]).toBe(1)
  })
})
