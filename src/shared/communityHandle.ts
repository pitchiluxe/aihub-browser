import { MAX_HANDLE_CHARS, MIN_HANDLE_CHARS } from './community'

/**
 * Display-name rules for the community.
 *
 * Uniqueness is deliberately NOT required. Two people may both be "Grace";
 * they are told apart by a short id suffix in the UI. Telling someone their own
 * name is taken is a bad first interaction, and in a faith community it is a
 * common one — several Graces is the expected case, not the edge case.
 *
 * What IS enforced is impersonation and rendering safety. The characters
 * rejected below are the standard tools for making one name look like another:
 * zero-width joiners that hide a suffix, bidirectional overrides that reverse
 * display order, and control characters that break the layout outright.
 */

/** Reserved words. Rejected as substrings, not just exact matches — "aihub
 *  support" is the impersonation attempt, not "support" on its own. */
const RESERVED = [
  'admin', 'administrator', 'moderator', 'mod team', 'aihub', 'support',
  'staff', 'official', 'system',
]

// Written as escapes on purpose: every character in this class is invisible,
// so spelled literally the class would look empty and the next reader would
// delete it as dead code.
//   \u0000-\u001F  C0 controls
//   \u007F-\u009F  DEL and the C1 controls
//   \u200B-\u200F  zero-width space and joiners, LTR/RTL marks
//   \u202A-\u202E  bidi embedding and override
//   \u2066-\u2069  bidi isolates
//   \uFEFF        byte-order mark, used as an invisible space
const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/

/** True when a string carries any character that renders as nothing. Exported
 *  so callers and tests can assert the property without restating the class —
 *  a second copy of a regex full of invisibles is a copy nobody can proofread. */
export function containsInvisible(s: string): boolean {
  return INVISIBLE_RE.test(String(s ?? ''))
}

export interface HandleResult {
  ok: boolean
  /** The value to store. Only meaningful when ok. */
  value: string
  /** Shown inline under the field. Only meaningful when not ok. */
  error?: string
}

/**
 * Normalize and validate a proposed handle.
 *
 * Normalization runs first and its output is what gets measured, so a name
 * that is 24 characters only because of combining marks or full-width forms
 * is judged on what it actually renders as.
 */
export function validateHandle(raw: string): HandleResult {
  const normalized = String(raw ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return { ok: false, value: '', error: 'Pick a name others will see.' }
  }
  if (INVISIBLE_RE.test(normalized)) {
    return { ok: false, value: '', error: 'That name contains hidden characters. Use ordinary letters.' }
  }
  // Count by code points: an emoji or an accented letter is one character to
  // the person typing it, and String.length disagrees.
  const length = [...normalized].length
  if (length < MIN_HANDLE_CHARS) {
    return { ok: false, value: '', error: `At least ${MIN_HANDLE_CHARS} characters.` }
  }
  if (length > MAX_HANDLE_CHARS) {
    return { ok: false, value: '', error: `At most ${MAX_HANDLE_CHARS} characters.` }
  }
  const lowered = normalized.toLowerCase()
  if (RESERVED.some(word => lowered.includes(word))) {
    return { ok: false, value: '', error: 'That name is reserved. Pick another.' }
  }
  return { ok: true, value: normalized }
}

/**
 * The short suffix that separates two members with the same handle.
 *
 * Four characters of the member id, which is plenty inside one room and short
 * enough to read as part of a name rather than as a serial number.
 */
export function handleSuffix(memberId: string): string {
  return String(memberId ?? '').replace(/-/g, '').slice(0, 4).toLowerCase()
}

/** How a member is addressed in the UI: "Grace.a3f1". */
export function displayName(handle: string, memberId: string): string {
  const suffix = handleSuffix(memberId)
  return suffix ? `${handle}·${suffix}` : handle
}
