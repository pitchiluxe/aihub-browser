// Spaced repetition for verse memorisation — Leitner boxes, 1 to 5.
//
// The whole scheduler is five numbers and two rules, and that is deliberate.
// SM-2's per-item ease factors are invisible to the person doing the drilling
// and buy nothing at the scale one reader memorises verses; a fixed daily
// review of everything drills what is already known cold once the list passes
// roughly forty verses, which is how people quit.
//
// Box level IS the mastery level. The scheduler and the rewards read the same
// number, so they cannot disagree about how well a verse is known.

export type Box = 1 | 2 | 3 | 4 | 5

export interface VerseProgress {
  box: Box
  /** Epoch ms. The verse is due for review at or after this instant. */
  dueAt: number
  lastResult?: 'pass' | 'fail'
  /** Total drills answered, pass or fail. Shown as "seen N times". */
  reviews?: number
}

export type VerseBook = Record<string, VerseProgress>

export const DAY_MS = 86_400_000

/** Days until a verse in each box comes back. */
export const BOX_INTERVAL_DAYS: Record<Box, number> = {
  1: 1,
  2: 3,
  3: 7,
  4: 21,
  5: 60,
}

export const MAX_BOX: Box = 5

export function isBox(n: unknown): n is Box {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5
}

export function nextReviewAt(box: Box, now: number): number {
  return now + BOX_INTERVAL_DAYS[box] * DAY_MS
}

/**
 * A verse the reader has just added to the Lab.
 *
 * Due immediately rather than tomorrow: someone who just chose a verse to learn
 * expects to be able to drill it now, and box 1's interval only starts meaning
 * something after the first pass.
 */
export function initialProgress(now: number): VerseProgress {
  return { box: 1, dueAt: now, reviews: 0 }
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
  const box = isBox(current?.box) ? (current as VerseProgress).box : 1
  const reviews = (current?.reviews ?? 0) + 1
  const next: Box = correct ? (Math.min(MAX_BOX, box + 1) as Box) : 1
  return {
    box: next,
    dueAt: nextReviewAt(next, now),
    lastResult: correct ? 'pass' : 'fail',
    reviews,
  }
}

/**
 * Which verses want reviewing right now, soonest-overdue first.
 *
 * Ties break on the reference so a queue built twice in the same millisecond
 * is in the same order both times — a drill session that silently reshuffles
 * underneath someone is worse than one that is slightly stale.
 */
export function dueVerses(verses: VerseBook, now: number): string[] {
  return Object.entries(verses || {})
    .filter(([, p]) => p && typeof p.dueAt === 'number' && p.dueAt <= now)
    .sort((a, b) => a[1].dueAt - b[1].dueAt || a[0].localeCompare(b[0]))
    .map(([ref]) => ref)
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
  const times = Object.values(verses || {}).map(p => p?.dueAt).filter((t): t is number => typeof t === 'number')
  return times.length ? Math.min(...times) : null
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
