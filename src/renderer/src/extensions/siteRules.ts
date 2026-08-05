/**
 * AIHub Browser — where an extension is allowed to run.
 *
 * Until now every enabled extension ran on every page, which is the behaviour
 * that makes people distrust extensions: a reading-mode tweak has no business
 * touching a banking site, and a dark-mode filter that fights a site's own
 * dark theme should be switchable off for that one site without losing it
 * everywhere. Chrome, Firefox and Safari all solve this the same way, and the
 * matching rules are worth getting exactly right — a pattern that matches too
 * broadly is a privacy problem, not a cosmetic one.
 */

export type SiteMode = 'all' | 'only' | 'except'

export interface SiteRules {
  mode: SiteMode
  /** Host patterns: "github.com", "*.github.com", "docs.github.com". */
  patterns: string[]
}

export const DEFAULT_SITE_RULES: SiteRules = { mode: 'all', patterns: [] }

/** Hostname of a page url, lowercased, "www." removed. '' when not a web url. */
export function hostOfUrl(url: string): string {
  try {
    const u = new URL(String(url || ''))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Normalise what the user typed into a bare host pattern: they will paste a
 * whole URL, include a scheme, or add a trailing slash, and all three should
 * mean the same site.
 */
export function normalizePattern(input: string): string {
  let value = String(input || '').trim().toLowerCase()
  if (!value) return ''
  value = value.replace(/^[a-z]+:\/\//, '')   // scheme
  value = value.split('/')[0]                  // path
  value = value.split('?')[0].split('#')[0]
  value = value.replace(/:\d+$/, '')           // port
  if (value.startsWith('www.')) value = value.slice(4)
  // Keep a leading wildcard, drop anything else exotic.
  if (value.startsWith('*.')) {
    const rest = value.slice(2)
    return /^[a-z0-9.-]+$/.test(rest) && rest.includes('.') ? `*.${rest}` : ''
  }
  return /^[a-z0-9.-]+$/.test(value) && value.includes('.') ? value : ''
}

/**
 * Does a host match one pattern?
 *
 * "github.com" matches the site and its subdomains — that is what a user means
 * by naming a site. "*.github.com" matches subdomains ONLY, for the rarer case
 * of excluding the apex. Comparison is label-wise, so "notgithub.com" can
 * never match "github.com".
 */
export function matchesPattern(host: string, pattern: string): boolean {
  const h = String(host || '').toLowerCase().replace(/^www\./, '')
  const p = normalizePattern(pattern)
  if (!h || !p) return false

  if (p.startsWith('*.')) {
    const domain = p.slice(2)
    return h.endsWith('.' + domain)
  }
  return h === p || h.endsWith('.' + p)
}

/** Should this extension run on this page? */
export function shouldRunOn(url: string, rules?: SiteRules | null): boolean {
  const host = hostOfUrl(url)
  // Never inject into anything that is not a real web page: the app's own
  // pages, about:blank, and the crash page are not sites.
  if (!host) return false

  const mode = rules?.mode || 'all'
  const patterns = (rules?.patterns || []).map(normalizePattern).filter(Boolean)

  if (mode === 'all') return true
  // A rule with no sites listed yet must not silently mean "everywhere" (for
  // 'only') or "nowhere" (for 'except') — both would surprise the user.
  if (!patterns.length) return mode === 'except'

  const hit = patterns.some(p => matchesPattern(host, p))
  return mode === 'only' ? hit : !hit
}

/** Human summary for the extension card. */
export function describeRules(rules?: SiteRules | null): string {
  const mode = rules?.mode || 'all'
  const patterns = (rules?.patterns || []).map(normalizePattern).filter(Boolean)
  if (mode === 'all') return 'Runs on every site'
  if (!patterns.length) {
    return mode === 'only' ? 'No sites chosen yet — add one to switch it on' : 'Runs on every site'
  }
  const list = patterns.slice(0, 3).join(', ') + (patterns.length > 3 ? ` +${patterns.length - 3} more` : '')
  return mode === 'only' ? `Only on ${list}` : `Everywhere except ${list}`
}

/** Add a site to the rules, normalising and de-duplicating. */
export function addSite(rules: SiteRules, input: string): SiteRules {
  const pattern = normalizePattern(input)
  if (!pattern || rules.patterns.some(p => normalizePattern(p) === pattern)) return rules
  return { ...rules, patterns: [...rules.patterns, pattern] }
}

export function removeSite(rules: SiteRules, pattern: string): SiteRules {
  const target = normalizePattern(pattern)
  return { ...rules, patterns: rules.patterns.filter(p => normalizePattern(p) !== target) }
}
