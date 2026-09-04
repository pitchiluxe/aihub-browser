/**
 * Leitner boxes — the scheduling half of spaced repetition, on its own.
 *
 * This was written for Bible verse memorisation and stayed there, typed to
 * verses, while the browser grew an archive of every page the user has read.
 * Those are the same problem: something worth keeping in your head, and a
 * question of when to ask about it again. So the five numbers and two rules
 * live here, and both callers — verses, and highlights from any web page —
 * schedule identically.
 *
 * Five boxes and nothing else, deliberately. SM-2's per-item ease factors are
 * invisible to the person doing the drilling and buy nothing at the scale one
 * person reviews things; a fixed daily review of everything drills what is
 * already known cold once the list passes about forty items, which is how
 * people quit. Box level IS the mastery level, so the scheduler and anything
 * that displays progress cannot disagree about how well something is known.
 */

export type Box = 1 | 2 | 3 | 4 | 5

export const DAY_MS = 86_400_000

/** Days until an item in each box comes back. */
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
 * The box an item moves to after one review.
 *
 * A pass promotes exactly one box — never two, however easy it looked — so the
 * intervals are actually served. A miss drops straight back to box 1: something
 * you could not recall is not "slightly less known", it is unlearned, and the
 * gentle-demotion variants all end up re-showing it too late.
 */
export function nextBox(current: Box, correct: boolean): Box {
  return correct ? (Math.min(MAX_BOX, current + 1) as Box) : 1
}

/** Anything with a due date can be queued by this module. */
export interface Scheduled {
  box: Box
  /** Epoch ms. Due for review at or after this instant. */
  dueAt: number
  lastResult?: 'pass' | 'fail'
  reviews?: number
}

/**
 * A freshly added item, due immediately rather than tomorrow: someone who just
 * chose something to learn expects to drill it now, and box 1's interval only
 * starts meaning something after the first pass.
 */
export function initialSchedule(now: number): Scheduled {
  return { box: 1, dueAt: now, reviews: 0 }
}

/** Apply one review result to a schedule. */
export function gradeSchedule(current: Scheduled | undefined, correct: boolean, now: number): Scheduled {
  const box = isBox(current?.box) ? (current as Scheduled).box : 1
  const next = nextBox(box, correct)
  return {
    box: next,
    dueAt: nextReviewAt(next, now),
    lastResult: correct ? 'pass' : 'fail',
    reviews: (current?.reviews ?? 0) + 1,
  }
}

/**
 * Which keys want reviewing now, soonest-overdue first.
 *
 * Ties break on the key so a queue built twice in the same millisecond comes
 * out in the same order both times — a session that silently reshuffles
 * underneath someone is worse than one that is slightly stale.
 */
export function dueKeys<T extends Scheduled>(items: Record<string, T>, now: number): string[] {
  return Object.entries(items || {})
    .filter(([, p]) => p && typeof p.dueAt === 'number' && p.dueAt <= now)
    .sort((a, b) => a[1].dueAt - b[1].dueAt || a[0].localeCompare(b[0]))
    .map(([key]) => key)
}

/** When the next item comes back, or null when there is nothing scheduled. */
export function nextDueAt<T extends Scheduled>(items: Record<string, T>): number | null {
  const times = Object.values(items || {}).map(p => p?.dueAt).filter((t): t is number => typeof t === 'number')
  return times.length ? Math.min(...times) : null
}
