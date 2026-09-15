/**
 * Who the Community Owner is, and what counts as being them.
 *
 * The address below is the authoritative identity for community ownership. It
 * is compared against an address Google returned from a token exchange, never
 * against something a user typed — typing an address proves nothing, and a
 * check that accepted typed input would be a login form with no password.
 *
 * Ownership is scoped to the community. It grants nothing anywhere else in the
 * browser, and the app has no other administrator concept for it to collide
 * with.
 */

export const COMMUNITY_OWNER_EMAIL = 'erickomari243@gmail.com'

/** Google's two spellings of the same mailbox. */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * Fold an address to the one string that identifies its mailbox.
 *
 * Returns '' for anything that is not a single well-formed address, so a
 * malformed value can never compare equal to a malformed constant. Every
 * caller therefore only has to check the result is truthy *and* equal.
 *
 * Gmail ignores dots and everything after a '+' in the local part, so folding
 * them is matching Google's own idea of identity. Doing the same anywhere else
 * would be wrong in the dangerous direction — plenty of mail servers treat
 * `a.b@` and `ab@` as two different people, and merging them would hand one
 * person's identity to another.
 */
export function normalizeEmail(input: string): string {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return ''

  const parts = trimmed.split('@')
  if (parts.length !== 2) return ''

  let [local, domain] = parts
  if (!local || !domain) return ''
  // A domain with no dot is not a domain, and one with a leading or trailing
  // dot is the shape used to slip past a sloppy suffix check.
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return ''
  if (/\s/.test(trimmed)) return ''

  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com'
    const plus = local.indexOf('+')
    if (plus !== -1) local = local.slice(0, plus)
    local = local.replaceAll('.', '')
  }

  if (!local) return ''
  return `${local}@${domain}`
}

/**
 * Is this the owner's address?
 *
 * Equality after normalisation, never a substring or a prefix test. The tests
 * pin the addresses a looser check would wrongly accept: `x-erickomari243@…`,
 * `…@gmail.com.evil.com`, `…@gmail.commercial.net`.
 */
export function isOwnerEmail(email: string): boolean {
  const normalized = normalizeEmail(email)
  return !!normalized && normalized === normalizeEmail(COMMUNITY_OWNER_EMAIL)
}
