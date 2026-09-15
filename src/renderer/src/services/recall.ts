import {
  type Box, type Scheduled,
  initialSchedule, gradeSchedule, dueKeys, nextDueAt, MAX_BOX,
} from '../../../shared/leitner'

/**
 * Recall — spaced repetition for the whole web.
 *
 * The browser already keeps every page you have read (Rewind) and already
 * knows how to schedule a review (the Bible Lab's Leitner boxes). Nothing
 * joined them, so reading two hundred articles and retaining none of them —
 * the actual failure mode of research browsing — went unaddressed.
 *
 * Highlight a sentence on any page and it enters a review queue. A small daily
 * card asks you to recall it, and the source page is one click away. The
 * scheduling is shared/leitner, unchanged, so a highlight and a verse are
 * treated exactly alike.
 *
 * Pure functions over a plain record. The store and the UI are elsewhere.
 */

export interface RecallItem {
  id: string
  /** The highlighted text — the thing to remember. */
  text: string
  /** Where it came from, so a review can always be checked against the source. */
  url: string
  title: string
  /** Optional cue the user typed: the question this text is the answer to. */
  prompt?: string
  createdAt: number
  schedule: Scheduled
}

export type RecallBook = Record<string, RecallItem>

/** Highlights longer than this are excerpts, not something to memorise. */
export const MAX_TEXT = 600

/**
 * Normalised text, used to spot the same passage highlighted twice.
 *
 * Whitespace only: two selections of the same sentence differ by the line
 * breaks the page happened to have, and treating those as different items
 * fills the queue with duplicates that all fail or pass together.
 */
export function textKey(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Whether a selection is worth remembering at all. */
export function isWorthRemembering(text: string): boolean {
  const t = String(text || '').trim()
  // Two characters is a click that grazed a word, not a highlight.
  return t.length >= 3 && t.length <= MAX_TEXT
}

export function findDuplicate(items: RecallBook, text: string): RecallItem | null {
  const key = textKey(text)
  if (!key) return null
  return Object.values(items || {}).find(i => textKey(i.text) === key) || null
}

/**
 * Add a highlight, or return the book unchanged when it is already there.
 *
 * Re-highlighting something is a signal that it matters, but resetting its
 * schedule would punish the user for it — an item they have promoted to box 4
 * would drop back to daily drilling. The existing schedule wins.
 */
export function addItem(
  items: RecallBook,
  input: { text: string; url: string; title?: string; prompt?: string },
  now: number,
  id = `rc-${now}-${Math.random().toString(36).slice(2, 8)}`,
): { items: RecallBook; item: RecallItem | null; duplicate: boolean } {
  if (!isWorthRemembering(input.text)) return { items, item: null, duplicate: false }

  const existing = findDuplicate(items, input.text)
  if (existing) return { items, item: existing, duplicate: true }

  const item: RecallItem = {
    id,
    text: input.text.trim(),
    url: input.url || '',
    title: input.title || input.url || '',
    prompt: input.prompt?.trim() || undefined,
    createdAt: now,
    schedule: initialSchedule(now),
  }
  return { items: { ...items, [id]: item }, item, duplicate: false }
}

export function removeItem(items: RecallBook, id: string): RecallBook {
  if (!items[id]) return items
  const next = { ...items }
  delete next[id]
  return next
}

/** Apply one review result. */
export function review(items: RecallBook, id: string, correct: boolean, now: number): RecallBook {
  const item = items[id]
  if (!item) return items
  return { ...items, [id]: { ...item, schedule: gradeSchedule(item.schedule, correct, now) } }
}

/** The review queue, soonest-overdue first. */
export function dueItems(items: RecallBook, now: number): RecallItem[] {
  const schedules: Record<string, Scheduled> = {}
  for (const [id, item] of Object.entries(items || {})) schedules[id] = item.schedule
  return dueKeys(schedules, now).map(id => items[id]).filter(Boolean)
}

/** Everything, best-known first — the browsing list rather than the queue. */
export function allItems(items: RecallBook): RecallItem[] {
  return Object.values(items || {}).sort((a, b) =>
    (b.schedule?.box ?? 0) - (a.schedule?.box ?? 0) || b.createdAt - a.createdAt)
}

export function whenNextDue(items: RecallBook): number | null {
  const schedules: Record<string, Scheduled> = {}
  for (const [id, item] of Object.entries(items || {})) schedules[id] = item.schedule
  return nextDueAt(schedules)
}

export interface RecallStats {
  total: number
  due: number
  mastered: number
  byBox: Record<Box, number>
}

export function stats(items: RecallBook, now: number): RecallStats {
  const byBox = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Box, number>
  let due = 0
  let mastered = 0
  for (const item of Object.values(items || {})) {
    const box = (item.schedule?.box ?? 1) as Box
    byBox[box] = (byBox[box] || 0) + 1
    if (box === MAX_BOX) mastered++
    if ((item.schedule?.dueAt ?? 0) <= now) due++
  }
  return { total: Object.keys(items || {}).length, due, mastered, byBox }
}

/** Items whose source page is a given URL — shown when you revisit it. */
export function itemsForUrl(items: RecallBook, url: string): RecallItem[] {
  const target = String(url || '').split('#')[0].replace(/\/+$/, '').toLowerCase()
  if (!target) return []
  return Object.values(items || {}).filter(i =>
    String(i.url || '').split('#')[0].replace(/\/+$/, '').toLowerCase() === target)
}

/**
 * When an item comes back, in words.
 *
 * Reusing the downloads' formatWhen here would be wrong in a way that reads as
 * a bug: that helper describes the past ("2 d ago"), and a due date is almost
 * always in the future.
 */
export function formatDue(dueAt: number, now: number): string {
  const ms = dueAt - now
  if (ms <= 0) return 'now'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `in ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours} hr`
  const days = Math.round(hours / 24)
  return days === 1 ? 'tomorrow' : `in ${days} days`
}
