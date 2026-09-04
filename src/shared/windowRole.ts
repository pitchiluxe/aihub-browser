/**
 * AIHub Browser — which window am I?
 *
 * Every window runs the same renderer, and until now every window also behaved
 * as though it were the only one. Two things follow from that, and both were
 * bugs:
 *
 *  - Detaching a tab opened a new window, which then restored the whole last
 *    session on top of the one page it was given. Moving a single tab out
 *    produced a full copy of every tab the user had open.
 *  - That same window then saved ITS tab list as the session a moment later,
 *    so the real window's tabs were overwritten by the detached window's
 *    single page and were gone at the next launch. The first bug was visible
 *    immediately; the second one only showed up the following morning, which
 *    makes it the worse of the two.
 *
 * A window opened by detaching is addressed with ?initialUrl=…, and the launch
 * window never is. That is the whole distinction, kept here as a pure function
 * so both call sites ask the same question in the same way.
 */

/**
 * Was this window opened to hold one specific page?
 *
 * True for a detached tab and for "Open Link in New Window": both are windows
 * whose contents were decided by the person who opened them, so neither should
 * inherit or overwrite the saved session.
 */
export function isSecondaryWindow(search: string): boolean {
  return initialUrlFrom(search) !== null
}

/**
 * The page a secondary window was opened for, or null.
 *
 * Only http(s) is accepted. The value arrives in a URL this process constructed
 * for itself, but it is still a string from the address bar of a renderer, and
 * a file:// or javascript: value navigating the new window would be a nasty way
 * to find that out.
 */
export function initialUrlFrom(search: string): string | null {
  let raw = ''
  try { raw = new URLSearchParams(search || '').get('initialUrl') || '' } catch { return null }
  const value = raw.trim()
  if (!value) return null
  return /^https?:\/\//i.test(value) ? value : null
}

/**
 * Whether this window should restore, and keep saving, the shared session.
 *
 * Phrased as a single question with one answer, because the restore and the
 * save have to agree: a window that restores the session but does not save it
 * loses the user's own changes, and one that saves without restoring wipes
 * everything else.
 */
export function ownsSession(search: string): boolean {
  return !isSecondaryWindow(search)
}
