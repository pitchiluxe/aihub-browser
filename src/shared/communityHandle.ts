import { MAX_HANDLE_CHARS, MIN_HANDLE_CHARS } from './community'

/**
 * Display-name rules for the community.
 *
 * Handles are UNIQUE across the community. An earlier version allowed repeats
 * and separated them with a short id suffix; unique names were chosen instead,
 * so a name identifies exactly one person and nobody has to read a hex code to
 * know who they are talking to.
 *
 * The cost is a worse first interaction for common names — several Graces is
 * the expected case here, not the edge case — so the "taken" message has to
 * suggest rather than scold, and availability is checked while typing instead
 * of at submit.
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
 * Why the Join button is not available yet, or null when it is.
 *
 * Exists as a function rather than a chain of ternaries in the component
 * because the first version shipped a disabled button with no explanation: the
 * name field's placeholder read like a filled-in value, so the form looked
 * complete and the button looked broken. A disabled control that cannot say
 * what it is waiting for is a bug, and this is the piece a test can hold.
 */
export function joinBlocker(handle: string, accepted: boolean): string | null {
  if (!String(handle ?? '').trim()) return 'Type a name above to continue.'
  if (!validateHandle(handle).ok) return 'Choose a different name to continue.'
  if (!accepted) return 'Tick the box above to continue.'
  return null
}

/**
 * The key two handles are compared on to decide whether they are "the same".
 *
 * Comparing the raw strings would let "Grace", "grace" and "GRACE" all coexist,
 * which is uniqueness in the database and confusion in the room. NFKC also
 * folds full-width and compatibility forms, so the width of the characters
 * cannot be used to clone a name either.
 *
 * What this does NOT catch is cross-script homoglyphs — Cyrillic "а" renders
 * identically to Latin "a" and produces a different key. Full confusable
 * folding needs the Unicode confusables table and belongs with server-side
 * registration; until then that gap is covered by reporting and banning, not
 * by this function. Better to state the limit than to imply it is airtight.
 */
export function handleKey(handle: string): string {
  return String(handle ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
