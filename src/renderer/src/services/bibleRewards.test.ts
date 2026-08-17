import { describe, it, expect } from 'vitest'
import {
  BADGES, COURSE_BADGE_IDS, currentStreak, evaluateBadges, isUnlocked, newlyEarned,
  qualifyingBadges, recordDay, shiftDay, unlockedStyles, type RewardFacts,
} from './bibleRewards'

const NO_FACTS: RewardFacts = {
  masteredVerses: 0, totalVerses: 0, streakCurrent: 0, streakBest: 0,
  lessonsCompleted: 0, coursesCompleted: [],
}

describe('streaks', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreak(['2026-08-14', '2026-08-15', '2026-08-16'], '2026-08-16')).toBe(3)
  })

  it('breaks on a gap', () => {
    expect(currentStreak(['2026-08-10', '2026-08-15', '2026-08-16'], '2026-08-16')).toBe(2)
  })

  it('still counts a streak that ends yesterday — today is not over yet', () => {
    expect(currentStreak(['2026-08-14', '2026-08-15'], '2026-08-16')).toBe(2)
  })

  it('is zero once a whole day has been missed', () => {
    expect(currentStreak(['2026-08-13', '2026-08-14'], '2026-08-16')).toBe(0)
    expect(currentStreak([], '2026-08-16')).toBe(0)
  })

  it('crosses month and year boundaries', () => {
    expect(currentStreak(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01')).toBe(3)
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('recordDay', () => {
  it('marks the day and raises the best when the streak grows', () => {
    let s = recordDay(undefined, '2026-08-14')
    s = recordDay(s, '2026-08-15')
    s = recordDay(s, '2026-08-16')
    expect(s.days).toEqual(['2026-08-14', '2026-08-15', '2026-08-16'])
    expect(s.best).toBe(3)
  })

  it('is idempotent — meditating twice is not two days', () => {
    const once = recordDay(undefined, '2026-08-16')
    const twice = recordDay(once, '2026-08-16')
    expect(twice.days).toEqual(['2026-08-16'])
    expect(twice.best).toBe(1)
  })

  it('never lowers the best after a break', () => {
    let s = { days: ['2026-08-01', '2026-08-02', '2026-08-03'], best: 3 }
    s = recordDay(s, '2026-08-20')
    expect(currentStreak(s.days, '2026-08-20')).toBe(1)
    expect(s.best).toBe(3)
  })
})

describe('badges fire at their threshold and not before', () => {
  it('awards nothing for an empty slate', () => {
    expect(qualifyingBadges(NO_FACTS)).toEqual([])
  })

  it('fires exactly at the mastered-verse thresholds', () => {
    expect(qualifyingBadges({ ...NO_FACTS, masteredVerses: 24 })).not.toContain('verses-25')
    expect(qualifyingBadges({ ...NO_FACTS, masteredVerses: 25 })).toContain('verses-25')
    expect(qualifyingBadges({ ...NO_FACTS, masteredVerses: 25 })).toContain('verses-10')
    expect(qualifyingBadges({ ...NO_FACTS, masteredVerses: 25 })).not.toContain('verses-50')
  })

  it('fires exactly at the streak thresholds, judged on the best ever', () => {
    expect(qualifyingBadges({ ...NO_FACTS, streakBest: 6 })).not.toContain('streak-7')
    expect(qualifyingBadges({ ...NO_FACTS, streakBest: 7 })).toContain('streak-7')
  })

  it('awards a course badge per finished course, and one for finishing them all', () => {
    const two = qualifyingBadges({ ...NO_FACTS, coursesCompleted: ['parables', 'psalms'] })
    expect(two).toContain('course-parables')
    expect(two).not.toContain('all-courses')
    // Driven off the badge list, so shipping a new course raises the bar for
    // "every course" instead of leaving it already cleared.
    const all = qualifyingBadges({ ...NO_FACTS, coursesCompleted: [...COURSE_BADGE_IDS] })
    expect(all).toContain('all-courses')
    const allButOne = qualifyingBadges({ ...NO_FACTS, coursesCompleted: COURSE_BADGE_IDS.slice(1) })
    expect(allButOne).not.toContain('all-courses')
  })

  it('ignores a course id that has no badge', () => {
    expect(qualifyingBadges({ ...NO_FACTS, coursesCompleted: ['nonsense'] })).toEqual([])
  })
})

describe('badges are never taken back', () => {
  it('keeps an earned badge after the facts fall below its threshold', () => {
    const earned = evaluateBadges([], { ...NO_FACTS, masteredVerses: 25, totalVerses: 30 })
    expect(earned).toContain('verses-25')
    const later = evaluateBadges(earned, { ...NO_FACTS, masteredVerses: 3, totalVerses: 30 })
    expect(later).toContain('verses-25')
  })

  it('reports only what is newly earned, for the one that gets celebrated', () => {
    const before = evaluateBadges([], { ...NO_FACTS, totalVerses: 1 })
    const after = evaluateBadges(before, { ...NO_FACTS, totalVerses: 12, masteredVerses: 10 })
    expect(newlyEarned(before, after).map(b => b.id)).toEqual(['verses-10'])
  })

  it('keeps a stable display order', () => {
    const order = BADGES.map(b => b.id)
    const earned = evaluateBadges(['verses-25', 'first-verse'], NO_FACTS)
    expect(earned).toEqual(order.filter(id => earned.includes(id)))
  })
})

describe('unlocks', () => {
  it('gates a style until its badge is held', () => {
    expect(isUnlocked('paper', 'linen', [])).toBe(false)
    expect(isUnlocked('paper', 'linen', ['streak-7'])).toBe(true)
  })

  it('lists papers and covers separately', () => {
    const u = unlockedStyles(['streak-7', 'verses-25', 'all-courses'])
    expect(u.papers).toEqual(['linen', 'midnight'])
    expect(u.covers).toEqual(['midnight'])
  })

  it('unlocks nothing for a badge that carries no reward', () => {
    expect(unlockedStyles(['first-verse'])).toEqual({ papers: [], covers: [] })
  })

  it('every unlockable value is reachable from exactly one badge', () => {
    const values = BADGES.filter(b => b.unlock).map(b => `${b.unlock!.kind}:${b.unlock!.value}`)
    expect(new Set(values).size).toBe(values.length)
  })
})
