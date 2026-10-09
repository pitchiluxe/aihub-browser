/**
 * AIHub Browser — a second look before you type a password.
 *
 * Phishing works because a domain that is wrong by one character looks right
 * to a person reading quickly. Blocklists answer this by knowing which sites
 * are bad, which means they are always a step behind whoever registered a
 * domain this morning.
 *
 * This browser has something a blocklist does not: a record of the sites the
 * user actually signs into. That turns the question around. Instead of "is
 * this site known to be bad", ask "does this site look like one of yours
 * without being it" — which catches a domain nobody has ever reported,
 * because the comparison is against the user's own history rather than
 * against the internet's.
 *
 * The output is a notice, never a block. False positives are inevitable when
 * comparing strings, and a browser that refuses to load a legitimate site the
 * user was trying to reach is worse than the risk it is managing.
 *
 * Pure functions. No network, no storage, no page access.
 */

export type GuardLevel = 'none' | 'notice' | 'warn'

export interface GuardVerdict {
  level: GuardLevel
  /** One sentence, written for the person about to type a password. */
  message: string
  /** The known domain this one resembles, when that is why we spoke up. */
  resembles?: string
}

/**
 * The registrable part of a hostname — roughly eTLD+1.
 *
 * A real public-suffix list is thousands of entries that go stale; this covers
 * the two-level suffixes people actually meet (co.uk, com.au, …) and treats
 * everything else as the last two labels. Being slightly wrong here makes the
 * comparison noisier, never unsafe: the worst case is comparing subdomains.
 */
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'co.za', 'co.jp', 'or.jp', 'ne.jp', 'co.kr',
  'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.tw',
  'co.in', 'com.sg', 'com.hk', 'com.my', 'co.il',
])

export function registrableDomain(input: string): string {
  let host = String(input || '').trim().toLowerCase()
  if (!host) return ''
  // Accept a full URL or a bare hostname.
  if (host.includes('://')) {
    try { host = new URL(host).hostname } catch { return '' }
  }
  host = host.replace(/^www\./, '').replace(/\.+$/, '').split('/')[0].split(':')[0]
  if (!host || !host.includes('.')) return host

  const parts = host.split('.')
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  if (TWO_LEVEL_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.')
  return lastTwo
}

/** A domain encoded to hide what it really says. */
export function isPunycode(domain: string): boolean {
  return /(^|\.)xn--/i.test(String(domain || ''))
}

/**
 * Fold the characters that exist to be mistaken for each other.
 *
 * The point is not to normalise text; it is to make paypa1.com and paypal.com
 * compare equal, so a substitution that a reader's eye slides over cannot slip
 * past a string comparison either.
 */
export function foldLookalikes(domain: string): string {
  return String(domain || '').toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[1l|]/g, 'l')
    .replace(/[0o]/g, 'o')
    .replace(/5/g, 's')
    .replace(/3/g, 'e')
    .replace(/-/g, '')
}

/**
 * Edit distance, counting a swap of two neighbours as one edit.
 *
 * Damerau rather than plain Levenshtein specifically because of typosquatting:
 * "gihtub" is one slip of the fingers from "github" and scores 2 under plain
 * Levenshtein, which puts the most common typo of all outside a sane
 * threshold. Capped, since anything past the cap is "not similar" anyway.
 */
export function editDistance(a: string, b: string, cap = 4): number {
  const s = String(a || ''), t = String(b || '')
  if (s === t) return 0
  if (Math.abs(s.length - t.length) > cap) return cap + 1

  // Three rows: the two previous ones are needed for the transposition case.
  let twoBack: number[] = []
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i)
  for (let i = 1; i <= s.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        v = Math.min(v, twoBack[j - 2] + 1)
      }
      row[j] = v
      if (v < best) best = v
    }
    if (best > cap) return cap + 1
    twoBack = prev
    prev = row
  }
  return prev[t.length]
}

/**
 * Whether `candidate` is pretending to be `known`.
 *
 * Two ways to be a lookalike: the characters fold onto each other exactly
 * (paypa1 → paypal), or the names are one small edit apart. A domain that
 * merely *contains* a known name is treated as suspicious only when the known
 * name is a whole label, so "paypal.evil.com" is caught but "mypaypalclub" is
 * not compared at all — the latter is how ordinary fan sites and forums are
 * named.
 */
export function isLookalike(candidate: string, known: string): boolean {
  const a = registrableDomain(candidate)
  const b = registrableDomain(known)
  if (!a || !b || a === b) return false

  // Short names collide by accident; one edit away from "x.co" is meaningless.
  const aName = a.split('.')[0]
  const bName = b.split('.')[0]
  if (bName.length < 5) return false

  if (foldLookalikes(a) === foldLookalikes(b)) return true
  if (foldLookalikes(aName) === foldLookalikes(bName)) return true

  const d = editDistance(aName, bName, 2)
  if (d > 0 && d <= (bName.length >= 8 ? 2 : 1)) return true

  // The known brand appears as a whole label of a different domain:
  // login.paypal.evil.com, paypal-secure.example.net. Split the HOSTNAME, not
  // the URL — leaving the scheme on turns the first label into "https://paypal"
  // and the check silently never fires.
  let host = String(candidate || '').trim().toLowerCase()
  if (host.includes('://')) { try { host = new URL(host).hostname } catch { host = '' } }
  const labels = host.split(/[.\-]/).filter(Boolean)
  if (labels.includes(bName)) return true

  return false
}

/**
 * Assess a page that is asking for a password.
 *
 * `knownDomains` is the set the user has actually used — from their own
 * history. An empty set means we know nothing about this person's habits yet
 * and should stay quiet rather than warn about everything.
 */
export function assessLogin(url: string, knownDomains: string[]): GuardVerdict {
  const domain = registrableDomain(url)
  if (!domain) return { level: 'none', message: '' }

  const known = new Set((knownDomains || []).map(registrableDomain).filter(Boolean))

  // A site the user genuinely uses is the normal case and gets no interruption.
  if (known.has(domain)) return { level: 'none', message: '' }

  if (isPunycode(domain)) {
    return {
      level: 'warn',
      message: 'This address is written in an encoded alphabet, which is almost only ever used to imitate another site.',
    }
  }

  for (const candidate of known) {
    if (isLookalike(url, candidate)) {
      return {
        level: 'warn',
        message: `This looks like ${candidate}, but it is not. You have signed in at ${candidate} before — never here.`,
        resembles: candidate,
      }
    }
  }

  if (!known.size) return { level: 'none', message: '' }

  return {
    level: 'notice',
    message: 'You have never signed in here before. Check the address bar before typing a password.',
  }
}

/**
 * The script that decides whether a page is asking for a password.
 *
 * A visible password input is the trigger, because that is the moment the
 * question matters. Hidden inputs are skipped: many sites keep one parked in
 * the DOM for their password manager, and warning on those would fire on
 * pages that are not asking for anything. Never throws.
 */
export function buildPasswordFieldScript(): string {
  return `(function(){
  try{
    var inputs=document.querySelectorAll('input[type=password]');
    for(var i=0;i<inputs.length;i++){
      var el=inputs[i];
      var r=el.getBoundingClientRect();
      var st=window.getComputedStyle(el);
      if(r.width>0 && r.height>0 && st.visibility!=='hidden' && st.display!=='none') return 'yes';
    }
    return 'no';
  }catch(e){ return 'no'; }
})()`
}
