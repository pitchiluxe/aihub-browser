import { DEFAULT_BLOCKLIST } from './adblockList'

/**
 * AIHub Browser — the session's single request filter.
 *
 * Electron allows exactly ONE onBeforeRequest listener per session: registering
 * a second silently replaces the first, and passing null removes whatever is
 * there. Focus mode used to own that slot outright, so any other blocking
 * feature would have cancelled it (and been cancelled by it) depending on which
 * ran last. Every blocking decision therefore goes through the one evaluator
 * here, and features contribute rules instead of listeners.
 *
 * Order matters: focus-mode redirects win over ad-blocking cancels, because a
 * user who blocked a whole site should see the block page, not a silently
 * failed request.
 */

export interface BlockDecision {
  /** Cancel the request outright. */
  cancel?: boolean
  /** Send the request somewhere else (focus mode's block page). */
  redirectURL?: string
}

export interface RequestInfo {
  url: string
  /** Chromium resource type: 'mainFrame' | 'subFrame' | 'script' | 'image' | … */
  resourceType: string
  /** Which tab the request belongs to, for per-tab counters. Optional. */
  webContentsId?: number
}

/** Hostname of a URL, lowercased and stripped of a leading "www.". */
export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

/**
 * True when `host` is `domain` or a subdomain of it. Compares label by label so
 * "notevil.com" never matches "evil.com" the way a bare endsWith would.
 */
export function isSameOrSubdomain(host: string, domain: string): boolean {
  if (!host || !domain) return false
  if (host === domain) return true
  return host.endsWith('.' + domain)
}

/** First blocklist entry that covers this host, walking up parent domains. */
export function matchBlocklist(host: string, blocklist: ReadonlySet<string>): string | null {
  if (!host) return null
  const labels = host.split('.')
  // Walk widening suffixes: a.b.tracker.com → a.b.tracker.com, b.tracker.com, …
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.')
    if (blocklist.has(candidate)) return candidate
  }
  return null
}

export interface AdblockConfig {
  enabled: boolean
  /** Sites (registrable domains) where the user turned blocking off. */
  allowlist: string[]
  /** Extra domains the user added by hand. */
  custom: string[]
}

export const DEFAULT_ADBLOCK_CONFIG: AdblockConfig = { enabled: true, allowlist: [], custom: [] }

/**
 * Decide a single request. Pure — no Electron, no I/O — so the whole matrix is
 * unit-testable and the hot path stays free of surprises.
 *
 * `pageHost` is the host of the tab's top-level document: a request is only
 * judged in the context of the page that made it, which is what makes the
 * per-site allowlist meaningful.
 */
export function decideRequest(
  info: RequestInfo,
  config: AdblockConfig,
  focusBlocked: string[] | null,
  pageHost: string,
  focusBlockPage: string,
  blocklist: ReadonlySet<string> = DEFAULT_BLOCKLIST,
): BlockDecision {
  const host = hostOf(info.url)
  if (!host) return {}

  // 1. Focus mode — only ever redirects a top-level navigation, never a
  //    subresource, so a blocked site's own assets can't loop the block page.
  if (focusBlocked && focusBlocked.length && info.resourceType === 'mainFrame') {
    const blockPageHost = hostOf(focusBlockPage)
    if (host !== blockPageHost && focusBlocked.some(d => isSameOrSubdomain(host, d))) {
      return { redirectURL: `${focusBlockPage}?site=${encodeURIComponent(host)}` }
    }
  }

  if (!config.enabled) return {}

  // 2. Never cancel a top-level navigation. If a user deliberately opens an ad
  //    or analytics URL, blocking it produces a dead tab with no explanation.
  if (info.resourceType === 'mainFrame') return {}

  // 3. Per-site off switch.
  if (pageHost && config.allowlist.some(d => isSameOrSubdomain(pageHost, d))) return {}

  // 4. A page is allowed to talk to its own domain even if that domain is on
  //    the list — otherwise visiting google-analytics.com or a publisher that
  //    serves from an ad domain breaks entirely.
  if (pageHost && (isSameOrSubdomain(host, pageHost) || isSameOrSubdomain(pageHost, host))) return {}

  if (matchBlocklist(host, blocklist)) return { cancel: true }
  for (const domain of config.custom) {
    if (isSameOrSubdomain(host, domain.toLowerCase())) return { cancel: true }
  }
  return {}
}

/** Running totals, for the shield badge. */
export interface BlockStats {
  total: number
  perTab: Record<number, number>
  topDomains: Record<string, number>
}

export function emptyStats(): BlockStats {
  return { total: 0, perTab: {}, topDomains: {} }
}

export function recordBlock(stats: BlockStats, host: string, webContentsId?: number): BlockStats {
  stats.total++
  if (webContentsId !== undefined) stats.perTab[webContentsId] = (stats.perTab[webContentsId] || 0) + 1
  if (host) stats.topDomains[host] = (stats.topDomains[host] || 0) + 1
  return stats
}
