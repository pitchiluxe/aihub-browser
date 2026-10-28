import { describe, it, expect } from 'vitest'
import { plural, translator } from './bibleLang'
import { BADGES, badgeText, FRENCH_BADGE_IDS } from './bibleRewards'
import { dayText, FRENCH_COURSE_IDS, FRENCH_PLAN_IDS, getPlans, getShippedCourses, localCourse, passageLabel, planText } from './bibleCourses'
import { MONTH_THEMES, monthName, monthlyPlan, themeFor } from './bibleMonthlyPlan'
import { MONTH_WORDS_FR } from './bibleMonthlyPlanFr'

describe('one language at a time', () => {
  it('picks the side of the pair for the language', () => {
    expect(translator('en')('Read it', 'Lire')).toBe('Read it')
    expect(translator('fr')('Read it', 'Lire')).toBe('Lire')
  })

  it('counts the French way — 0 and 1 are singular', () => {
    expect(plural('fr', 1, ['day', 'days'], ['jour', 'jours'])).toBe('1 jour')
    expect(plural('fr', 0, ['day', 'days'], ['jour', 'jours'])).toBe('0 jour')
    expect(plural('en', 0, ['day', 'days'], ['jour', 'jours'])).toBe('0 days')
  })
})

describe('nothing English left in French data', () => {
  it('every badge has French', () => {
    expect([...FRENCH_BADGE_IDS].sort()).toEqual(BADGES.map(b => b.id).sort())
    for (const b of BADGES) {
      const fr = badgeText(b, 'fr')
      expect(fr.name, b.id).not.toBe(b.name)
      if (b.unlock) expect(fr.unlock, b.id).toBeTruthy()
    }
  })

  it('every shipped course and lesson has French', () => {
    const shipped = getShippedCourses()
    expect([...FRENCH_COURSE_IDS].sort()).toEqual(shipped.map(c => c.id).sort())
    for (const c of shipped) {
      const fr = localCourse(c, 'fr')
      expect(fr.title, c.id).not.toBe(c.title)
      fr.lessons.forEach((l, i) => {
        expect(l.teaching, `${c.id}/${l.id}`).toHaveLength(c.lessons[i].teaching.length)
        expect(l.teaching[0], `${c.id}/${l.id}`).not.toBe(c.lessons[i].teaching[0])
        // Same scripture in both languages: only the words around it change.
        expect(l.passages).toEqual(c.lessons[i].passages)
        expect(l.memory).toEqual(c.lessons[i].memory)
      })
    }
  })

  it('leaves the English course untouched in English', () => {
    const c = getShippedCourses()[0]
    expect(localCourse(c, 'en')).toBe(c)
  })

  it('every reading plan has French', () => {
    expect([...FRENCH_PLAN_IDS].sort()).toEqual(getPlans().map(p => p.id).sort())
    for (const p of getPlans()) expect(planText(p, 'fr').title).not.toBe(p.title)
  })

  it('every month has French words, all five weeks of them', () => {
    for (const theme of MONTH_THEMES) {
      const fr = MONTH_WORDS_FR[theme.month]
      expect(fr, `month ${theme.month}`).toBeTruthy()
      expect(fr.weeks).toHaveLength(5)
      const local = themeFor(theme.month, 'fr')
      expect(local.title).toBe(fr.title)
      expect(local.readings).toEqual(theme.readings) // same scripture, other words
      expect(local.verses).toEqual(theme.verses)
    }
  })

  it('French month plans carry French week encouragements', () => {
    const plan = monthlyPlan(2026, 11, 'fr')
    expect(plan.theme.title).toBe('Un cœur reconnaissant')
    expect(plan.days[0].focus).toBe(MONTH_WORDS_FR[11].weeks[0])
  })

  it('names the month in French, lower case', () => {
    expect(monthName(11, 'fr')).toBe('novembre')
    expect(monthName(11, 'en')).toBe('November')
  })
})

describe('labels', () => {
  it('says Jour for Day in French', () => {
    expect(dayText('Day 3', 'fr')).toBe('Jour 3')
    expect(dayText('Day 3', 'en')).toBe('Day 3')
  })

  it('builds passage labels from book names, not the stored English', () => {
    const range = { bookId: 'LUK', chapter: 2, from: 1, to: 20, label: 'Luke 2:1–20' }
    expect(passageLabel(range, 'en')).toBe('Luke 2:1–20')
    const whole = { bookId: 'JHN', chapter: 1, from: 1, to: 51, label: 'John 1' }
    expect(passageLabel(whole, 'en')).toBe('John 1')
    const verse = { bookId: 'JHN', chapter: 3, from: 16, to: 16, label: 'John 3:16' }
    expect(passageLabel(verse, 'en')).toBe('John 3:16')
  })

  it('names a single psalm in the singular, in both languages', () => {
    const ps = { bookId: 'PSA', chapter: 23, from: 1, to: 6, label: 'Psalms 23' }
    expect(passageLabel(ps, 'en')).toBe('Psalm 23')
    expect(passageLabel(ps, 'fr')).toBe('Psaume 23')
  })
})
