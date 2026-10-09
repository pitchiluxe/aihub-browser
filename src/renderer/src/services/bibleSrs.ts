// Spaced repetition for verse memorisation.
//
// The scheduling itself lives in shared/leitner — the same five boxes now drive
// Recall, which reviews highlights from any page. This module is the Bible's
// vocabulary on top of it: verse references, the Lab's lists, and the stats the
// rewards read. Box level IS the mastery level, so the scheduler and the
// rewards cannot disagree about how well a verse is known.

import {
  type Box, type Scheduled,
  DAY_MS, BOX_INTERVAL_DAYS, MAX_BOX, isBox, nextReviewAt,
  initialSchedule, gradeSchedule, dueKeys, nextDueAt as sharedNextDueAt,
} from '../../../shared/leitner'

export type { Box }
export { DAY_MS, BOX_INTERVAL_DAYS, MAX_BOX, isBox, nextReviewAt }

export interface VerseProgress extends Scheduled {
  box: Box
  /** Epoch ms. The verse is due for review at or after this instant. */
  dueAt: number
  lastResult?: 'pass' | 'fail'
  /** Total drills answered, pass or fail. Shown as "seen N times". */
  reviews?: number
}

export type VerseBook = Record<string, VerseProgress>


/**
 * A verse the reader has just added to the Lab.
 *
 * Due immediately rather than tomorrow: someone who just chose a verse to learn
 * expects to be able to drill it now, and box 1's interval only starts meaning
 * something after the first pass.
 */
export function initialProgress(now: number): VerseProgress {
  return initialSchedule(now)
}

/**
 * Apply one drill result.
 *
 * A pass promotes exactly one box — never two, however easy it looked — so the
 * intervals are actually served. A miss drops straight back to box 1: a verse
 * you could not recall is not "slightly less known", it is unlearned, and the
 * gentle-demotion variants all end up re-showing it too late.
 */
export function grade(current: VerseProgress | undefined, correct: boolean, now: number): VerseProgress {
  return gradeSchedule(current, correct, now)
}

/**
 * Which verses want reviewing right now, soonest-overdue first.
 *
 * Ties break on the reference so a queue built twice in the same millisecond
 * is in the same order both times — a drill session that silently reshuffles
 * underneath someone is worse than one that is slightly stale.
 */
export function dueVerses(verses: VerseBook, now: number): string[] {
  return dueKeys(verses, now)
}

/** Everything in the Lab, most recently due first — the "all verses" list. */
export function allVerses(verses: VerseBook): string[] {
  return Object.keys(verses || {}).sort((a, b) => {
    const pa = verses[a], pb = verses[b]
    return (pb?.box ?? 0) - (pa?.box ?? 0) || a.localeCompare(b)
  })
}

/** When the next verse comes back, or null when the Lab is empty. */
export function nextDueAt(verses: VerseBook): number | null {
  return sharedNextDueAt(verses)
}

export interface LabStats {
  total: number
  due: number
  mastered: number
  byBox: Record<Box, number>
}

export function labStats(verses: VerseBook, now: number): LabStats {
  const byBox: Record<Box, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let due = 0
  const entries = Object.values(verses || {})
  for (const p of entries) {
    if (!p) continue
    if (isBox(p.box)) byBox[p.box]++
    if (typeof p.dueAt === 'number' && p.dueAt <= now) due++
  }
  return { total: entries.length, due, mastered: byBox[5], byBox }
}
