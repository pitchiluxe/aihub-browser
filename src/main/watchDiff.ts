/**
 * AIHub Browser — change detection for watched pages.
 *
 * Hashing a page's raw text sounds right and behaves badly: nearly every real
 * page carries something that changes on its own — a clock, a "2 minutes ago",
 * a view counter, a rotating ad slot, a fresh CSRF token. Watch a job board or
 * a price with a naive hash and it cries wolf every hour until you turn it off.
 *
 * So the text is normalised before hashing: the volatile shapes are replaced
 * with placeholders, leaving the words that carry actual meaning. What remains
 * is what a person would call "the page changed".
 */

/** Patterns whose value moves on its own and says nothing about the content. */
const VOLATILE: [RegExp, string][] = [
  // ISO timestamps and dates: 2026-08-05T07:15:00Z, 2026-08-05
  [/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/g, '«date»'],
  // Clock times, with or without am/pm
  [/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\b/gi, '«time»'],
  // Relative times: "3 minutes ago", "in 2 days", "just now"
  [/\b(?:in\s+)?\d+\s*(?:second|sec|minute|min|hour|hr|day|week|month|year)s?(?:\s+ago)?\b/gi, '«ago»'],
  [/\bjust now\b/gi, '«ago»'],
  // Long opaque tokens: csrf values, cache-busting ids, request ids
  [/\b[A-Za-z0-9_-]{24,}\b/g, '«token»'],
  // Hex / uuid-ish blobs
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '«uuid»'],
  // Big grouped numbers — view counts, follower counts
  [/\b\d{1,3}(?:,\d{3})+\b/g, '«count»'],
]

export function normalizeForCompare(text: string): string {
  let out = String(text || '')
  for (const [pattern, replacement] of VOLATILE) out = out.replace(pattern, replacement)
  return out
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Stable 32-bit hash of the normalised text. */
export function contentHash(text: string): string {
  const normalized = normalizeForCompare(text)
  let h = 0
  for (let i = 0; i < normalized.length; i++) h = (Math.imul(31, h) + normalized.charCodeAt(i)) | 0
  return String(h >>> 0)
}

export function hasChanged(previousHash: string | undefined, text: string): boolean {
  if (previousHash === undefined) return false   // first look is the baseline
  return contentHash(text) !== previousHash
}

/**
 * A one-line description of what appeared, for the notification body. Falls
 * back to a neutral sentence when the change is only a removal or a reshuffle —
 * better than quoting a line that is no longer there.
 */
export function describeChange(previousText: string, nextText: string, maxLength = 120): string {
  const before = new Set(normalizeForCompare(previousText).split('\n').map(l => l.trim()).filter(Boolean))
  const added = normalizeForCompare(nextText).split('\n')
    .map(l => l.trim())
    .filter(line => line.length > 12 && !before.has(line))

  if (!added.length) return 'This page changed since you last looked'
  const first = added[0].replace(/«\w+»/g, '…')
  return first.length > maxLength ? first.slice(0, maxLength - 1).trimEnd() + '…' : first
}

/** Does the page contain the keyword the user is waiting for? */
export function containsKeyword(text: string, keyword: string): boolean {
  const needle = String(keyword || '').trim().toLowerCase()
  if (!needle) return false
  return String(text || '').toLowerCase().includes(needle)
}
