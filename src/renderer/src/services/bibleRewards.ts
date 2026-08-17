// Streaks, badges and what they unlock.
//
// There are no points, no XP bar and no level number. There is nobody to
// compete with in a single-user app, and a score for its own sake cheapens the
// subject. What is left is the three things that actually mean something: how
// many days in a row you have shown up, how many verses you genuinely know,
// and how far through a course you are — each of which points back into the
// app rather than at a scoreboard.

export interface StreakState {
  /** `YYYY-MM-DD` days the reader meditated, oldest-first, de-duplicated. */
  days: string[]
  best: number
}

export const EMPTY_STREAK: StreakState = { days: [], best: 0 }

const DAY_MS = 86_400_000

function toUTC(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

/** `YYYY-MM-DD` for a day offset from another, in the same calendar terms. */
export function shiftDay(day: string, deltaDays: number): string {
  const t = new Date(toUTC(day) + deltaDays * DAY_MS)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * Consecutive days ending today — or yesterday.
 *
 * Yesterday still counts, because a streak that dies at midnight punishes
 * someone for not having opened the app yet on a day that is barely a minute
 * old. It only breaks once a whole day has been missed.
 */
export function currentStreak(days: string[], today: string): number {
  const set = new Set(days || [])
  let cursor = set.has(today) ? today : shiftDay(today, -1)
  if (!set.has(cursor)) return 0
  let n = 0
  while (set.has(cursor)) { n++; cursor = shiftDay(cursor, -1) }
  return n
}

/** Mark a day done. Idempotent — meditating twice is not a two-day streak. */
export function recordDay(state: StreakState | undefined, today: string): StreakState {
  const days = Array.from(new Set([...(state?.days || []), today])).sort()
  // Bounded: a year of history is far more than the streak logic ever reads,
  // and this file is written on every meditation.
  const trimmed = days.slice(-400)
  const current = currentStreak(trimmed, today)
  return { days: trimmed, best: Math.max(state?.best || 0, current) }
}

// ── Badges ──────────────────────────────────────────────────────────────────

export type UnlockKind = 'paper' | 'cover'

export interface Badge {
  id: string
  name: string
  /** What earns it, in the reader's words. */
  requirement: string
  /** A reader style this badge makes available in Settings → Bible. */
  unlock?: { kind: UnlockKind; value: string; label: string }
}

/** What the reader has actually done — everything a badge can be judged on. */
export interface RewardFacts {
  /** Verses sitting in box 5: known, not merely seen. */
  masteredVerses: number
  /** Every verse in the Lab, whatever its box. */
  totalVerses: number
  streakCurrent: number
  streakBest: number
  lessonsCompleted: number
  /** Course ids finished end to end. */
  coursesCompleted: string[]
}

export const BADGES: Badge[] = [
  { id: 'first-verse',  name: 'First verse',      requirement: 'Add a verse to the Lab' },
  { id: 'streak-3',     name: 'Three days',       requirement: 'Meditate three days running' },
  {
    id: 'streak-7', name: 'A full week', requirement: 'Meditate seven days running',
    unlock: { kind: 'paper', value: 'linen', label: 'Linen paper' },
  },
  { id: 'streak-30',    name: 'A month of mornings', requirement: 'Meditate thirty days running',
    unlock: { kind: 'cover', value: 'forest', label: 'Forest-green binding' } },
  { id: 'verses-10',    name: 'Ten by heart',     requirement: 'Master ten verses' },
  {
    id: 'verses-25', name: 'Twenty-five by heart', requirement: 'Master twenty-five verses',
    unlock: { kind: 'paper', value: 'midnight', label: 'Midnight paper' },
  },
  { id: 'verses-50',    name: 'Fifty by heart',   requirement: 'Master fifty verses' },
  { id: 'verses-100',   name: 'A hundred by heart', requirement: 'Master a hundred verses' },
  { id: 'first-lesson', name: 'First lesson',     requirement: 'Finish a lesson' },
  { id: 'course-life-of-christ', name: 'Life of Christ', requirement: 'Finish the Life of Christ course' },
  { id: 'course-parables',       name: 'The Parables',   requirement: 'Finish The Parables course' },
  { id: 'course-psalms',         name: 'Psalms for Hard Days', requirement: 'Finish Psalms for Hard Days' },
  {
    id: 'all-courses', name: 'Every course', requirement: 'Finish all three courses',
    unlock: { kind: 'cover', value: 'midnight', label: 'Midnight-blue binding' },
  },
]

const BY_ID = new Map(BADGES.map(b => [b.id, b]))

export function getBadge(id: string): Badge | undefined {
  return BY_ID.get(id)
}

/** Which badges the facts alone justify, ignoring what was earned before. */
export function qualifyingBadges(facts: RewardFacts): string[] {
  const out: string[] = []
  if (facts.totalVerses >= 1) out.push('first-verse')
  if (facts.streakBest >= 3) out.push('streak-3')
  if (facts.streakBest >= 7) out.push('streak-7')
  if (facts.streakBest >= 30) out.push('streak-30')
  if (facts.masteredVerses >= 10) out.push('verses-10')
  if (facts.masteredVerses >= 25) out.push('verses-25')
  if (facts.masteredVerses >= 50) out.push('verses-50')
  if (facts.masteredVerses >= 100) out.push('verses-100')
  if (facts.lessonsCompleted >= 1) out.push('first-lesson')
  for (const id of facts.coursesCompleted) {
    const badge = `course-${id}`
    if (BY_ID.has(badge)) out.push(badge)
  }
  if (['life-of-christ', 'parables', 'psalms'].every(c => facts.coursesCompleted.includes(c))) {
    out.push('all-courses')
  }
  return out
}

/**
 * The reader's badges after this update.
 *
 * Earned is earned. A badge is never taken back — forgetting a verse next month
 * does not mean you never learned it, and an achievement that can evaporate is
 * a punishment wearing a medal.
 */
export function evaluateBadges(earned: string[] | undefined, facts: RewardFacts): string[] {
  const set = new Set(earned || [])
  for (const id of qualifyingBadges(facts)) set.add(id)
  // Stable order: the BADGES list order, so the wall doesn't reshuffle.
  return BADGES.filter(b => set.has(b.id)).map(b => b.id)
}

/** Badges earned by this update that were not held before — what to celebrate. */
export function newlyEarned(before: string[] | undefined, after: string[]): Badge[] {
  const had = new Set(before || [])
  return after.filter(id => !had.has(id)).map(id => BY_ID.get(id)).filter((b): b is Badge => !!b)
}

export interface Unlocks { papers: string[]; covers: string[] }

/** Reader styles the badge wall has opened up. */
export function unlockedStyles(earned: string[] | undefined): Unlocks {
  const set = new Set(earned || [])
  const papers: string[] = []
  const covers: string[] = []
  for (const b of BADGES) {
    if (!b.unlock || !set.has(b.id)) continue
    if (b.unlock.kind === 'paper') papers.push(b.unlock.value)
    else covers.push(b.unlock.value)
  }
  return { papers, covers }
}

/** Whether a style value may be offered in Settings yet. */
export function isUnlocked(kind: UnlockKind, value: string, earned: string[] | undefined): boolean {
  const u = unlockedStyles(earned)
  return (kind === 'paper' ? u.papers : u.covers).includes(value)
}
