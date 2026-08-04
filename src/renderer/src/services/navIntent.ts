import type { Bookmark, Tab } from '../store/browserStore'

// "Open X" resolution for the AI assistant.
//
// This used to be a two-way substring test inside AIAssistant ("does the title
// contain the query OR the query contain the title, same for the domain…"),
// which mis-fires badly on a real bookmark list: "netflix" contains "x", so
// "open netflix" opened x.com, and any bookmark with an unparseable URL matched
// every query — landing on whichever bookmark happens to be first (the pinned
// Bible). Matching is now scored and word-aware: a target only wins on a whole
// identifier, and the highest-confidence match wins rather than the first one.

export type PageType = NonNullable<Tab['pageType']>

export interface NavTarget {
  url: string
  title: string
  pageType: PageType
}

// The app's own pages. `aihub://<page>` is not a real URL — it must be opened as
// a React page (pageType), never handed to a BrowserView, or the tab loads
// nothing at all.
const IN_APP_PAGES = [
  'settings', 'history', 'downloads', 'wifi', 'vpn', 'research', 'agents',
  'extensions', 'mail', 'notes', 'manual', 'rewind', 'watch', 'bible',
] as const

export function pageTypeForUrl(url: string | undefined): PageType {
  if (!url || !url.startsWith('aihub://')) return 'browser'
  const page = url.slice('aihub://'.length).replace(/\/+$/, '').toLowerCase()
  return (IN_APP_PAGES as readonly string[]).includes(page) ? (page as PageType) : 'browser'
}

// Spoken names for the built-in pages. Matched on the whole (normalised) query
// only, so "open bible" opens the reader while "open biblegateway" does not.
const BUILT_IN_APPS: { pageType: PageType; title: string; aliases: string[] }[] = [
  { pageType: 'bible',      title: 'Bible',      aliases: ['bible', 'holy bible', 'bible reader', 'scripture', 'scriptures', 'kjv'] },
  { pageType: 'mail',       title: 'Mail',       aliases: ['mail', 'email', 'e-mail', 'inbox', 'gmail'] },
  { pageType: 'notes',      title: 'Notes',      aliases: ['notes', 'note', 'notepad', 'my notes'] },
  { pageType: 'settings',   title: 'Settings',   aliases: ['settings', 'preferences', 'options'] },
  { pageType: 'history',    title: 'History',    aliases: ['history', 'browsing history'] },
  { pageType: 'downloads',  title: 'Downloads',  aliases: ['downloads', 'download manager'] },
  { pageType: 'extensions', title: 'Extensions', aliases: ['extensions', 'add-ons', 'addons'] },
  { pageType: 'research',   title: 'Research',   aliases: ['research', 'research mode'] },
  { pageType: 'agents',     title: 'Agents',     aliases: ['agents', 'agent'] },
  { pageType: 'watch',      title: 'Watch',      aliases: ['watch', 'watches', 'watchlist'] },
  { pageType: 'rewind',     title: 'Rewind',     aliases: ['rewind'] },
  { pageType: 'manual',     title: 'Manual',     aliases: ['manual', 'user manual', 'help', 'docs'] },
  { pageType: 'wifi',       title: 'Free WiFi',  aliases: ['wifi', 'wi-fi', 'free wifi'] },
  { pageType: 'vpn',        title: 'VPN',        aliases: ['vpn', 'proxy'] },
]

// Last-resort destinations so a site the user never bookmarked (or has since
// deleted) still opens instead of falling through to the model.
const KNOWN_SITES: Record<string, string> = {
  youtube:   'https://www.youtube.com',
  google:    'https://www.google.com',
  gmail:     'https://mail.google.com',
  netflix:   'https://www.netflix.com',
  facebook:  'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  twitter:   'https://www.x.com',
  x:         'https://www.x.com',
  reddit:    'https://www.reddit.com',
  amazon:    'https://www.amazon.com',
  github:    'https://github.com',
  linkedin:  'https://www.linkedin.com',
  tiktok:    'https://www.tiktok.com',
  twitch:    'https://www.twitch.tv',
  wikipedia: 'https://www.wikipedia.org',
  chatgpt:   'https://chatgpt.com',
  claude:    'https://claude.ai',
  spotify:   'https://open.spotify.com',
  ebay:      'https://www.ebay.com',
  maps:      'https://maps.google.com',
}

const OPEN_PATTERNS = [
  /^(?:hey\s+)?(?:can|could|would)\s+you\s+(?:please\s+)?(?:open\s+up|open|go\s+to|navigate\s+to|take\s+me\s+to|show\s+me|visit|launch|pull\s+up|bring\s+up)\s+(.+)$/i,
  /^(?:hey\s+)?(?:please\s+)?(?:open\s+up|open|go\s+to|goto|navigate\s+to|take\s+me\s+to|show\s+me|visit|launch|pull\s+up|bring\s+up)\s+(.+)$/i,
]

// Words that carry no target information, stripped from both ends.
const LEADING_FILLER  = /^(?:the|my|a|an|to)\s+/i
const TRAILING_FILLER = /\s+(?:for\s+me|please|now|real\s+quick|thanks|thank\s+you|in\s+a\s+new\s+tab|in\s+a\s+new\s+window|new\s+tab|app|application|website|web\s+site|site|page)$/i

/**
 * Pull the navigation target out of a chat message, or null when the message
 * isn't a navigation command. Anchored at the start so questions *about*
 * opening something ("how do I open X?") are left for the model to answer.
 */
export function parseOpenIntent(message: string): string | null {
  const msg = message.trim()
  // A navigation command is short. Anything long is prose that happens to
  // start with a verb, and guessing at it would hijack a real question.
  if (!msg || msg.length > 120 || /[\r\n]/.test(msg)) return null

  let query: string | null = null
  for (const pattern of OPEN_PATTERNS) {
    const m = msg.match(pattern)
    if (m) { query = m[1]; break }
  }
  if (!query) return null

  let q = query.toLowerCase().replace(/['"“”‘’]/g, '').replace(/[\s?!.,;:]+$/, '').trim()
  while (LEADING_FILLER.test(q))  q = q.replace(LEADING_FILLER, '').trim()
  while (TRAILING_FILLER.test(q)) q = q.replace(TRAILING_FILLER, '').trim()
  q = q.replace(/\s+/g, ' ').trim()

  return q ? q : null
}

const stripPunct = (s: string): string => s.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim()
const escapeRe   = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 0 = no match. Higher = more confident. Every rule below matches a whole
// identifier (exact value, or a word-boundary hit inside the title) — never a
// bare substring, which is what made short titles like "x" match everything.
const MIN_SCORE = 35
function scoreBookmark(b: Bookmark, q: string): number {
  const title = (b.title || '').toLowerCase().trim()
  if (title === q) return 100

  // aihub:// bookmarks are app pages, not sites: their "hostname" is the page
  // name and is handled by the alias table, so only their title counts here.
  let domain = ''
  if (/^https?:\/\//i.test(b.url)) {
    try { domain = new URL(b.url).hostname.replace(/^www\./, '').toLowerCase() } catch { domain = '' }
  }
  const root = domain.split('.')[0]

  if (domain && (domain === q || root === q)) return 95
  if (stripPunct(title) === stripPunct(q)) return 90

  if (q.length >= 3) {
    const word = new RegExp(`\\b${escapeRe(q)}\\b`, 'i')
    if (word.test(title)) return title.startsWith(q) ? 70 : 60
  }
  if (q.length >= 4 && root && root.startsWith(q)) return 45
  if (q.length >= 4 && domain && domain.includes(q)) return 35
  return 0
}

/**
 * Resolve "open X" to something openable: a built-in page, a bookmark, a
 * well-known site, or a bare domain. Returns null when nothing is confidently
 * a match, in which case the caller should let the AI answer normally.
 */
export function resolveNavTarget(message: string, bookmarks: Bookmark[]): NavTarget | null {
  const q = parseOpenIntent(message)
  if (!q) return null

  // 1. Built-in apps win on an exact spoken name — "open the bible" must open
  //    the reader inside the app, not a Bible website.
  const app = BUILT_IN_APPS.find(a => a.aliases.includes(q))
  if (app) return { url: `aihub://${app.pageType}`, title: app.title, pageType: app.pageType }

  // 2. Best-scoring bookmark. Ties break toward the built-in page and then the
  //    shorter (more specific) title, so ordering in the list never decides it.
  let best: { bm: Bookmark; score: number } | null = null
  for (const bm of bookmarks) {
    const score = scoreBookmark(bm, q)
    if (score < MIN_SCORE) continue
    if (!best || score > best.score) { best = { bm, score }; continue }
    if (score === best.score) {
      const builtIn = bm.url.startsWith('aihub://') && !best.bm.url.startsWith('aihub://')
      if (builtIn || bm.title.length < best.bm.title.length) best = { bm, score }
    }
  }
  if (best) return { url: best.bm.url, title: best.bm.title, pageType: pageTypeForUrl(best.bm.url) }

  // 3. A site everyone knows, even if it isn't bookmarked.
  const known = KNOWN_SITES[q.replace(/\s+/g, '')]
  if (known) {
    const name = q.replace(/\s+/g, '')
    return { url: known, title: name.charAt(0).toUpperCase() + name.slice(1), pageType: 'browser' }
  }

  // 4. Something the user typed as a domain ("open example.com").
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(q)) {
    return { url: `https://${q}`, title: q, pageType: 'browser' }
  }

  return null
}
