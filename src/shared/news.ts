/**
 * AIHub News — the shapes and pure rules shared by the main-process news
 * service and the newsroom page.
 *
 * Nothing here touches the network: feed parsing, de-duplication and the
 * cross-outlet "coverage" count are plain functions so they can be tested
 * against captured feed text.
 */

export type DeskId =
  | 'top' | 'politics' | 'africa' | 'americas' | 'europe' | 'asia' | 'middleeast'
  | 'business' | 'tech' | 'science' | 'health' | 'sports' | 'lifestyle' | 'food' | 'culture'

export interface NewsStory {
  id: string
  title: string
  url: string
  source: string
  summary: string
  image: string
  /** The publisher's host (reuters.com), for its logo when there is no photo. */
  site: string
  publishedAt: number
  /** How many distinct outlets in this desk carried the same story (≥1). */
  coverage: number
  /** The other outlets that carried it, for the "also reported by" line. */
  alsoBy: string[]
}

export interface DeskResult {
  ok: boolean
  stories: NewsStory[]
  fetchedAt: number
  /** Outlets that answered, out of those asked. */
  sources: { name: string; ok: boolean }[]
  error?: string
  /** Served from the saved copy because no newsroom answered just now. */
  stale?: boolean
}

export interface Recipe {
  id: string
  name: string
  category: string
  area: string
  instructions: string
  image: string
  youtubeId: string
  source: string
  ingredients: { name: string; measure: string }[]
}

export interface FeedSource { name: string; url: string }

const gnews = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`

/**
 * Bing News search as RSS. Its items carry an HD-capable thumbnail and the
 * real article link, so it is the picture source for stories the text-only
 * feeds (Google News, NPR, Al Jazeera) cover too. It answers unevenly, so it
 * is only ever an extra outlet on a desk, never the only one.
 */
const bing = (q: string) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`

const DESK_BING: Record<DeskId, string> = {
  top: 'world news', politics: 'election results', africa: 'Africa news', americas: 'Americas news',
  europe: 'Europe news', asia: 'Asia news', middleeast: 'Middle East news', business: 'business news',
  tech: 'technology news', science: 'science news', health: 'health news', sports: 'sports news',
  lifestyle: 'lifestyle', food: 'restaurants food', culture: 'entertainment news',
}

/** Every outlet a desk reads: its newsrooms plus the Bing picture source. */
export function deskFeeds(id: DeskId): FeedSource[] {
  return [...DESK_FEEDS[id], { name: 'Bing News', url: bing(DESK_BING[id]) }]
}

/**
 * Each desk reads several independent newsrooms. A story the BBC, the
 * Guardian and Al Jazeera all carry is far less likely to be wrong than one
 * outlet's scoop, and the page says so with the coverage count.
 */
export const DESK_FEEDS: Record<DeskId, FeedSource[]> = {
  top: [
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
    { name: 'Google News', url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en' },
  ],
  politics: [
    { name: 'Google News', url: gnews('election OR vote OR ballot when:3d') },
    { name: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/us-news/us-politics/rss' },
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/politics/rss.xml' },
  ],
  africa: [
    { name: 'BBC Africa', url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/world/africa/rss' },
    { name: 'Google News', url: gnews('Africa when:2d') },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  ],
  americas: [
    { name: 'BBC US & Canada', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml' },
    { name: 'BBC Latin America', url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/us-news/rss' },
    { name: 'NPR', url: 'https://feeds.npr.org/1003/rss.xml' },
  ],
  europe: [
    { name: 'BBC Europe', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/world/europe-news/rss' },
    { name: 'Google News', url: gnews('Europe when:2d') },
  ],
  asia: [
    { name: 'BBC Asia', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/world/asia-pacific/rss' },
    { name: 'Google News', url: gnews('Asia when:2d') },
  ],
  middleeast: [
    { name: 'BBC Middle East', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/world/middleeast/rss' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  ],
  business: [
    { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/business/rss' },
    { name: 'NPR Business', url: 'https://feeds.npr.org/1006/rss.xml' },
  ],
  tech: [
    { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/technology/rss' },
    { name: 'NPR Tech', url: 'https://feeds.npr.org/1019/rss.xml' },
  ],
  science: [
    { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/science/rss' },
    { name: 'NPR Science', url: 'https://feeds.npr.org/1007/rss.xml' },
  ],
  health: [
    { name: 'BBC Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
    { name: 'NPR Health', url: 'https://feeds.npr.org/1128/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/society/health/rss' },
  ],
  sports: [
    { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/sport/rss' },
    { name: 'Google News', url: gnews('sports when:1d') },
  ],
  lifestyle: [
    { name: 'The Guardian', url: 'https://www.theguardian.com/lifeandstyle/rss' },
    { name: 'Google News', url: gnews('lifestyle wellness travel when:3d') },
    { name: 'BBC Culture', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
  ],
  food: [
    { name: 'The Guardian', url: 'https://www.theguardian.com/food/rss' },
    { name: 'Google News', url: gnews('restaurant opening OR best restaurants when:7d') },
    { name: 'Google News', url: gnews('food chef recipe when:3d') },
  ],
  culture: [
    { name: 'BBC Entertainment', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/culture/rss' },
    { name: 'NPR Arts', url: 'https://feeds.npr.org/1008/rss.xml' },
  ],
}

export interface CountryDesk { code: string; name: string; flag: string; query: string }

/** The country desk: a Google News search per country, plus its own feed where one is useful. */
export const COUNTRIES: CountryDesk[] = [
  { code: 'us', name: 'United States', flag: '🇺🇸', query: '"United States" OR Washington OR Congress OR "White House"' },
  { code: 'cd', name: 'DR Congo', flag: '🇨🇩', query: '"DR Congo" OR "Democratic Republic of Congo" OR Kinshasa OR Goma OR Tshisekedi' },
  { code: 'gb', name: 'United Kingdom', flag: '🇬🇧', query: 'UK OR Britain OR London OR Westminster' },
  { code: 'fr', name: 'France', flag: '🇫🇷', query: 'France OR Paris OR Macron' },
  { code: 'de', name: 'Germany', flag: '🇩🇪', query: 'Germany OR Berlin OR Bundestag' },
  { code: 'ua', name: 'Ukraine', flag: '🇺🇦', query: 'Ukraine OR Kyiv OR Zelensky' },
  { code: 'ru', name: 'Russia', flag: '🇷🇺', query: 'Russia OR Kremlin OR Moscow' },
  { code: 'il', name: 'Israel & Palestine', flag: '🕊️', query: 'Israel OR Gaza OR "West Bank" OR Palestinian' },
  { code: 'ng', name: 'Nigeria', flag: '🇳🇬', query: 'Nigeria OR Lagos OR Abuja' },
  { code: 'ke', name: 'Kenya', flag: '🇰🇪', query: 'Kenya OR Nairobi' },
  { code: 'za', name: 'South Africa', flag: '🇿🇦', query: '"South Africa" OR Johannesburg OR Ramaphosa' },
  { code: 'rw', name: 'Rwanda', flag: '🇷🇼', query: 'Rwanda OR Kigali' },
  { code: 'eg', name: 'Egypt', flag: '🇪🇬', query: 'Egypt OR Cairo' },
  { code: 'cn', name: 'China', flag: '🇨🇳', query: 'China OR Beijing OR "Xi Jinping"' },
  { code: 'in', name: 'India', flag: '🇮🇳', query: 'India OR "New Delhi" OR Modi' },
  { code: 'jp', name: 'Japan', flag: '🇯🇵', query: 'Japan OR Tokyo' },
  { code: 'br', name: 'Brazil', flag: '🇧🇷', query: 'Brazil OR Brasilia OR Lula' },
  { code: 'mx', name: 'Mexico', flag: '🇲🇽', query: 'Mexico OR "Mexico City"' },
  { code: 'ca', name: 'Canada', flag: '🇨🇦', query: 'Canada OR Ottawa' },
  { code: 'au', name: 'Australia', flag: '🇦🇺', query: 'Australia OR Canberra OR Sydney' },
]

/**
 * The names a country desk listens for, from its search query:
 * '"DR Congo" OR Kinshasa' → ['DR Congo', 'Kinshasa'].
 */
export function countryTerms(query: string): string[] {
  const terms: string[] = []
  const re = /"([^"]+)"|([^\s()"]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query))) {
    const t = (m[1] || m[2] || '').trim()
    if (t && t !== 'OR' && t !== 'AND') terms.push(t)
  }
  return terms
}

/** Whether a story names any of the terms, as whole words. */
export function mentionsAny(s: Pick<RawStory, 'title' | 'summary'>, terms: string[]): boolean {
  if (!terms.length) return false
  const text = `${s.title} ${s.summary}`
  return terms.some(t => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(text)
  })
}

/**
 * The big newsrooms a country desk also reads, keeping only the stories that
 * name the country. These carry photographs, which the search feeds mostly
 * do not, so a country page is not a wall of logos.
 */
export function countryNewsroomFeeds(): FeedSource[] {
  const seen = new Set<string>()
  const out: FeedSource[] = []
  for (const id of ['top', 'africa', 'americas', 'europe', 'asia', 'middleeast'] as DeskId[]) {
    for (const f of DESK_FEEDS[id]) {
      if (f.name === 'Google News' || seen.has(f.url)) continue
      seen.add(f.url)
      out.push(f)
    }
  }
  return out
}

/**
 * What a desk shows after a fetch: the fresh page when there is one;
 * otherwise the last saved page, marked stale; otherwise the failure.
 */
export function chooseDeskResult(fresh: DeskResult, saved: DeskResult | undefined): DeskResult {
  if (fresh.ok) return fresh
  if (saved?.stories?.length) return { ...saved, ok: true, stale: true, sources: fresh.sources }
  return fresh
}

export function countryFeeds(c: CountryDesk): FeedSource[] {
  return [
    { name: 'Google News', url: gnews(`(${c.query}) when:2d`) },
    // Two Bing searches: it answers unevenly, and it is where the pictures are.
    { name: 'Bing News', url: bing(c.name) },
    { name: 'Bing News', url: bing(`${c.name} news today`) },
  ]
}

// ── Feed parsing ────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', eacute: 'é', bull: '•',
}

export function decodeEntities(s: string): string {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

function unCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

/** Plain text from a fragment that may hold escaped or raw HTML. */
export function toPlainText(s: string): string {
  let t = unCdata(String(s || ''))
  // Feeds escape their HTML once (&lt;p&gt;); decode, then strip tags.
  if (/&lt;\/?[a-z]/i.test(t)) t = decodeEntities(t)
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  t = t.replace(/<[^>]+>/g, ' ')
  return decodeEntities(t).replace(/\s+/g, ' ').trim()
}

function tag(block: string, name: string): string {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')
  const m = block.match(re)
  return m ? unCdata(m[1]).trim() : ''
}

function attr(block: string, tagName: string, attrName: string): string {
  const re = new RegExp(`<${tagName}\\b[^>]*\\b${attrName}\\s*=\\s*["']([^"']+)["'][^>]*>`, 'i')
  const m = block.match(re)
  return m ? decodeEntities(m[1]) : ''
}

/**
 * The sharpest version of a feed thumbnail that its host will serve:
 * BBC's image service takes the width in the path (240 → 976), Bing's
 * thumbnail service takes it as parameters. Other hosts sign their URLs, so
 * those are left alone.
 */
export function hdImage(url: string): string {
  let u = String(url || '')
  u = u.replace(/^(https:\/\/ichef\.bbci\.co\.uk\/(?:ace|news)\/(?:standard|ws)\/)\d+\//i, '$1976/')
  if (/^https?:\/\/(?:www\.)?bing\.com\/th\b/i.test(u) || u.startsWith('/th?')) {
    if (u.startsWith('/')) u = `https://www.bing.com${u}`
    u = u.replace(/^http:/i, 'https:').replace(/&(?:w|h|c)=[^&]*/g, '')
    u += '&w=1280&h=720&c=14'
  }
  return u
}

function imageOf(block: string): string {
  // Bing News carries its thumbnail in its own namespace.
  const bingImage = tag(block, 'News:Image')
  if (bingImage) return hdImage(decodeEntities(bingImage))
  // Largest media:content wins over a thumbnail when a feed offers several.
  const contents = [...block.matchAll(/<media:content\b[^>]*>/gi)].map(m => m[0])
  let best = ''
  let bestWidth = -1
  for (const c of contents) {
    const url = (c.match(/\burl\s*=\s*["']([^"']+)["']/i) || [])[1]
    if (!url) continue
    const medium = (c.match(/\bmedium\s*=\s*["']([^"']+)["']/i) || [])[1]
    const type = (c.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1]
    if ((medium && medium !== 'image') || (type && !type.startsWith('image'))) continue
    const width = Number((c.match(/\bwidth\s*=\s*["'](\d+)["']/i) || [])[1] || 0)
    if (width > bestWidth) { best = url; bestWidth = width }
  }
  if (best) return decodeEntities(best)
  const thumb = attr(block, 'media:thumbnail', 'url')
  if (thumb) return thumb
  const enclosure = block.match(/<enclosure\b[^>]*type\s*=\s*["']image[^"']*["'][^>]*>/i)
  if (enclosure) {
    const url = (enclosure[0].match(/\burl\s*=\s*["']([^"']+)["']/i) || [])[1]
    if (url) return decodeEntities(url)
  }
  const raw = decodeEntities(unCdata(tag(block, 'description') || tag(block, 'content:encoded')))
  const img = raw.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
  return img ? img[1] : ''
}

export interface RawStory { title: string; url: string; source: string; summary: string; image: string; site: string; publishedAt: number }

/** Bing News wraps every link in a click-tracker; the article is its url= parameter. */
function unwrapLink(url: string): string {
  try {
    const u = new URL(url)
    if (/(^|\.)bing\.com$/i.test(u.hostname) && /apiclick/i.test(u.pathname)) {
      const target = u.searchParams.get('url') || ''
      if (/^https?:\/\//i.test(target)) return target
    }
  } catch { /* keep as is */ }
  return url
}

function hostOfUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

/** RSS 2.0 <item> and Atom <entry> both. Malformed items are skipped, never thrown. */
export function parseFeed(xml: string, fallbackSource: string): RawStory[] {
  const out: RawStory[] = []
  const blocks = String(xml || '').match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || []
  for (const block of blocks) {
    try {
      let title = toPlainText(tag(block, 'title'))
      let url = tag(block, 'link')
      if (!url || url.includes('<')) url = attr(block, 'link', 'href')
      url = unwrapLink(decodeEntities(url).trim())
      if (!title || !/^https?:\/\//i.test(url)) continue
      // Google News names the outlet in <source> and repeats it after " - ";
      // Bing names it in News:Source.
      let source = toPlainText(tag(block, 'source')) || toPlainText(tag(block, 'News:Source')).replace(/ on MSN$/i, '') || fallbackSource
      // The publisher's own host: Google News links all point at Google, so
      // its <source url="…"> is the honest answer there.
      const site = hostOfUrl(attr(block, 'source', 'url')) || (/news\.google\.com$/i.test(hostOfUrl(url)) ? '' : hostOfUrl(url))
      if (source !== fallbackSource && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim()
      const rawSummary = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content')
      let summary = toPlainText(rawSummary)
      // A Google News "summary" is just the headline again as a link list.
      if (summary.startsWith(title.slice(0, 40))) summary = ''
      if (summary.length > 320) summary = summary.slice(0, 317).replace(/\s+\S*$/, '') + '…'
      const dateText = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date')
      const ts = Date.parse(dateText)
      // The page renders this in the app window: only plain https images.
      // A file:, UNC or other scheme from a hostile feed must never reach <img>.
      const image = hdImage(imageOf(block).trim())
      out.push({ title, url, source, summary, image: /^https:\/\//i.test(image) ? image : '', site, publishedAt: Number.isFinite(ts) ? ts : 0 })
    } catch { /* one broken item never costs the feed */ }
  }
  return out
}

/**
 * An article page's share picture: og:image, then twitter:image, from the
 * page's <head>. Relative URLs resolve against the page; anything that is not
 * https is refused, as for feed images.
 */
export function extractShareImage(html: string, pageUrl: string): string {
  const head = String(html || '').slice(0, 400_000)
  const metas = head.match(/<meta\b[^>]*>/gi) || []
  const pick = (names: string[]) => {
    for (const m of metas) {
      const key = (m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase()
      if (!key || !names.includes(key)) continue
      const content = (m.match(/\bcontent\s*=\s*["']([^"']+)["']/i) || [])[1]
      if (content) return decodeEntities(content.trim())
    }
    return ''
  }
  const raw = pick(['og:image:secure_url', 'og:image', 'og:image:url']) || pick(['twitter:image', 'twitter:image:src'])
  if (!raw) return ''
  try {
    const abs = new URL(raw, pageUrl).toString()
    return /^https:\/\//i.test(abs) ? hdImage(abs) : ''
  } catch { return '' }
}

/** Whether a story link can be opened to look for its share picture. */
export function canResolveImage(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (u.port && u.port !== '80' && u.port !== '443') return false
    // "localhost." is localhost: drop the root dot before any suffix check.
    const h = u.hostname.toLowerCase().replace(/\.+$/, '')
    // Google News links open a Google page with Google's logo, not the article's.
    if (/(^|\.)news\.google\.com$/.test(h)) return false
    // Never let a feed aim the main process at this machine or a private network.
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false
    if (/^\d+(\.\d+){3}$/.test(h) || h.includes(':') || h.startsWith('[')) return false
    return h.includes('.')
  } catch { return false }
}

/**
 * Whether a resolved address is on the public internet. The hostname check
 * above cannot see where a name points, so the main process resolves every
 * hop and refuses any answer that lands on this machine or a private
 * network: loopback, RFC 1918, link-local, CGNAT, unspecified, multicast,
 * reserved, unique-local and site-local IPv6, and IPv4-mapped forms of all.
 */
export function isPublicAddress(ip: string): boolean {
  let a = String(ip || '').trim().toLowerCase()
  if (!a) return false
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1)
  const zone = a.indexOf('%')
  if (zone !== -1) a = a.slice(0, zone)
  // IPv4-mapped / -translated IPv6 carries an IPv4 inside it.
  const mapped = a.match(/^(?:::ffff:(?:0:)?|::)(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) a = mapped[1]
  const v4 = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [p, q] = [Number(v4[1]), Number(v4[2])]
    if ([1, 2, 3, 4].some(i => Number(v4[i]) > 255)) return false
    if (p === 0 || p === 10 || p === 127) return false
    if (p === 100 && q >= 64 && q <= 127) return false // CGNAT
    if (p === 169 && q === 254) return false // link-local
    if (p === 172 && q >= 16 && q <= 31) return false
    if (p === 192 && q === 168) return false
    if (p === 192 && q === 0 && Number(v4[3]) === 0) return false // IETF protocol assignments
    if (p === 198 && (q === 18 || q === 19)) return false // benchmarking
    if (p >= 224) return false // multicast and reserved
    return true
  }
  if (!a.includes(':')) return false
  // Expand the first group of an IPv6 address to classify it.
  if (a === '::' || a === '::1') return false
  const first = parseInt(a.split(':')[0] || '0', 16)
  if (!Number.isFinite(first)) return false
  if ((first & 0xfe00) === 0xfc00) return false // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return false // fec0::/10 site-local
  if ((first & 0xff00) === 0xff00) return false // multicast
  if (first === 0) return false // ::/16 reserved (incl. unmapped embeddings)
  if (first === 0x64 && a.startsWith('64:ff9b:')) return false // NAT64 to anywhere
  if (first === 0x2002) return false // 6to4 can embed private IPv4
  return true
}

// ── Merging outlets ─────────────────────────────────────────────────────────

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'was', 'as', 'at', 'by', 'with', 'from', 'after', 'over', 'its', 'it', 'be', 'has', 'have', 'says', 'say', 'new', 'how', 'why', 'what', 'live', 'latest', 'news'])

export function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w)),
  )
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.min(a.size, b.size)
}

function hashId(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}

/**
 * One list from many outlets: duplicates folded together, each surviving
 * story carrying how many outlets reported it. Ranked by a mix of coverage
 * and freshness, so the story everyone is covering leads, but yesterday's
 * consensus does not bury this hour's news.
 */
export function mergeStories(raw: RawStory[], now = Date.now(), limit = 80): NewsStory[] {
  const clusters: { lead: RawStory; tokens: Set<string>; outlets: Set<string>; image: string; summary: string }[] = []
  const sorted = [...raw].sort((a, b) => b.publishedAt - a.publishedAt)
  for (const s of sorted) {
    if (s.publishedAt && now - s.publishedAt > 5 * 86_400_000) continue
    const tokens = titleTokens(s.title)
    const match = clusters.find(c => c.lead.url === s.url || (tokens.size >= 3 && similarity(c.tokens, tokens) >= 0.6))
    if (match) {
      match.outlets.add(s.source)
      // Any outlet's photo serves the story — a Google News headline often
      // borrows the picture Bing or the BBC carried for the same event.
      if (!match.image && s.image) match.image = s.image
      if (!match.summary && s.summary) match.summary = s.summary
      continue
    }
    clusters.push({ lead: s, tokens, outlets: new Set([s.source]), image: s.image, summary: s.summary })
  }
  const score = (c: typeof clusters[number]) => {
    const ageH = c.lead.publishedAt ? (now - c.lead.publishedAt) / 3_600_000 : 24
    // A photograph is worth about one more outlet: pictured stories rise to
    // the front of the page, while a story everyone covers still leads.
    return c.outlets.size * 2 + (c.image ? 2 : 0) - ageH / 6
  }
  return clusters
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit)
    .map(c => ({
      id: hashId(c.lead.url),
      title: c.lead.title,
      url: c.lead.url,
      source: c.lead.source,
      summary: c.summary,
      image: c.image,
      site: c.lead.site,
      publishedAt: c.lead.publishedAt,
      coverage: c.outlets.size,
      alsoBy: [...c.outlets].filter(o => o !== c.lead.source).slice(0, 4),
    }))
}

// ── Recipes (TheMealDB) ─────────────────────────────────────────────────────

export function youtubeIdOf(url: string): string {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : ''
}

export function normalizeMeal(meal: any): Recipe | null {
  if (!meal || typeof meal !== 'object' || !meal.idMeal || !meal.strMeal) return null
  const ingredients: Recipe['ingredients'] = []
  for (let i = 1; i <= 20; i++) {
    const name = String(meal[`strIngredient${i}`] || '').trim()
    if (!name) continue
    ingredients.push({ name, measure: String(meal[`strMeasure${i}`] || '').trim() })
  }
  return {
    id: String(meal.idMeal),
    name: String(meal.strMeal),
    category: String(meal.strCategory || ''),
    area: String(meal.strArea || ''),
    instructions: String(meal.strInstructions || '').replace(/\r\n/g, '\n').trim(),
    image: /^https:\/\//.test(meal.strMealThumb || '') ? meal.strMealThumb : '',
    youtubeId: youtubeIdOf(meal.strYoutube || ''),
    source: /^https?:\/\//.test(meal.strSource || '') ? meal.strSource : '',
    ingredients,
  }
}
