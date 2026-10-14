/**
 * Travel the World — where the facts, videos and recommendations come from.
 *
 *  Facts     – Wikidata (capital, population, currency, languages, driving side,
 *              the current head of state and government) and Wikipedia summaries
 *              and photos. Real, live data — not the model.
 *  Videos    – YouTube searches aimed at tourism (sights, drone footage, walking
 *              tours, food), filtered so news, politics and conflict footage stay out.
 *  Guide     – the AI model, grounded on the facts above, writes the travel guide:
 *              geography, economy, politics, best time to go, money, safety, hotels,
 *              Airbnb areas, car rental and must-sees. Every recommendation comes
 *              with a link to check it on a real booking or map site.
 */
import type { Country } from './countries'

// ── Facts ───────────────────────────────────────────────────────────────────

export interface CountryFacts {
  official: string
  capital: string[]
  population: number | null
  areaKm2: number | null
  region: string
  subregion: string
  currencies: { code: string; name: string; symbol: string }[]
  languages: string[]
  timezones: string[]
  driveSide: 'left' | 'right' | null
  callingCode: string
  mapUrl: string | null
}

type Row = Record<string, { value: string } | undefined>

/** Run a Wikidata SPARQL query (free, keyless, community-maintained) and return its rows. */
async function sparql(query: string, timeoutMs = 15000): Promise<Row[]> {
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Wikidata ${res.status}`)
  const j = await res.json()
  return Array.isArray(j?.results?.bindings) ? j.results.bindings : []
}

/** An English Wikipedia article's URL, spelled the way Wikidata stores sitelinks. */
export function wikiArticleIri(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2C/g, ',')}`
}

/**
 * Find the country by its English Wikipedia article — the same page the summary
 * comes from. Binding the article's IRI is an index lookup (~70 ms); matching
 * on schema:name scanned every sitelink (2–3 s, and timed out under load).
 */
const byArticle = (title: string) => `BIND(<${wikiArticleIri(title)}> AS ?ca) ?ca schema:about ?country .`

export function factsQuery(title: string): string {
  return `SELECT ?country (SAMPLE(?officialName) AS ?official) (GROUP_CONCAT(DISTINCT ?capitalLabel; separator="|") AS ?capitals)
 (MAX(?population) AS ?pop) (MAX(?areaM2) AS ?area) (GROUP_CONCAT(DISTINCT ?curr; separator="|") AS ?currencies)
 (GROUP_CONCAT(DISTINCT ?langLabel; separator="|") AS ?langs) (SAMPLE(?driveLabel) AS ?drive) (SAMPLE(?cc) AS ?calling)
 (GROUP_CONCAT(DISTINCT ?tzLabel; separator="|") AS ?tzs) WHERE {
  ${byArticle(title)}
  OPTIONAL { ?country wdt:P1448 ?officialName . FILTER(LANG(?officialName) = "en") }
  OPTIONAL { ?country wdt:P36 ?capital . ?capital rdfs:label ?capitalLabel . FILTER(LANG(?capitalLabel) = "en") }
  OPTIONAL { ?country wdt:P1082 ?population . }
  OPTIONAL { ?country p:P2046/psn:P2046/wikibase:quantityAmount ?areaM2 . }
  OPTIONAL { ?country wdt:P38 ?currency . ?currency rdfs:label ?cl . FILTER(LANG(?cl) = "en") OPTIONAL { ?currency wdt:P498 ?code . } BIND(CONCAT(?cl, " (", COALESCE(?code, ""), ")") AS ?curr) }
  OPTIONAL { ?country wdt:P37 ?language . ?language rdfs:label ?langLabel . FILTER(LANG(?langLabel) = "en") }
  OPTIONAL { ?country wdt:P1622 ?driveSide . ?driveSide rdfs:label ?driveLabel . FILTER(LANG(?driveLabel) = "en") }
  OPTIONAL { ?country wdt:P474 ?cc . }
  OPTIONAL { ?country wdt:P421 ?tz . ?tz rdfs:label ?tzLabel . FILTER(LANG(?tzLabel) = "en") }
} GROUP BY ?country LIMIT 1`
}

/** Shape a Wikidata facts row into what the page shows. Missing fields stay empty. */
export function normalizeFacts(row: Row | null | undefined): CountryFacts {
  const v = (k: string) => (row?.[k]?.value ?? '').trim()
  const split = (k: string) => v(k).split('|').map(x => x.trim()).filter(Boolean)
  const num = (k: string) => { const n = parseFloat(v(k)); return Number.isFinite(n) ? n : null }
  const area = num('area')
  const drive = v('drive').toLowerCase()
  const tzs = split('tzs')
  const utc = tzs.filter(t => /^UTC/.test(t))
  return {
    official: v('official'),
    capital: split('capitals'),
    population: num('pop'),
    areaKm2: area != null ? area / 1e6 : null,
    region: '',
    subregion: '',
    currencies: split('currencies').map(c => {
      const m = /^(.*?)\s*\(([A-Z]{3})?\)$/.exec(c)
      return { code: m?.[2] ?? '', name: m ? m[1] : c, symbol: '' }
    }),
    languages: split('langs'),
    timezones: (utc.length ? utc : tzs).slice(0, 6),
    driveSide: drive === 'left' || drive === 'right' ? drive : null,
    callingCode: v('calling'),
    mapUrl: null,
  }
}

/** Keep a found (non-null) answer on this device for `ttlMs`; a miss is asked again next time. */
async function remembered<T>(key: string, ttlMs: number, load: () => Promise<T | null>): Promise<T | null> {
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null')
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T
  } catch { /* unreadable entry: load again */ }
  const value = await load()
  if (value != null) try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), value })) } catch { /* storage full */ }
  return value
}

const DAY = 24 * 3600_000

export function fetchFacts(c: Country): Promise<CountryFacts | null> {
  return remembered(`aihub-travel-facts-v1:${c.code}`, DAY, async () => {
    try {
      const rows = await sparql(factsQuery(wikiTitle(c)))
      return rows.length ? normalizeFacts(rows[0]) : null
    } catch { return null }
  })
}

// ── Leaders ─────────────────────────────────────────────────────────────────

export interface Leader {
  roles: ('state' | 'government')[]
  name: string
  office: string
  since: string
  /** English Wikipedia article title, for the photo and biography. */
  article: string
  photo: string | null
  bio: string
  url: string
}

export function leadersQuery(title: string): string {
  return `SELECT ?role ?person ?personLabel ?article ?officeLabel ?start WHERE {
  ${byArticle(title)}
  { ?country p:P35 ?st . ?st ps:P35 ?person . BIND("state" AS ?role) OPTIONAL { ?country wdt:P1906 ?office } }
  UNION
  { ?country p:P6 ?st . ?st ps:P6 ?person . BIND("government" AS ?role) OPTIONAL { ?country wdt:P1313 ?office } }
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?article schema:about ?person ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`
}

const isQid = (s: string) => /^Q\d+$/.test(s)

/**
 * Current head of state and head of government (no end date on the statement),
 * merged when one person holds both, as in a presidential system. The name falls
 * back to the Wikipedia article title when Wikidata has no English label.
 */
export function parseLeaders(rows: Row[]): Omit<Leader, 'photo' | 'bio'>[] {
  const out = new Map<string, Omit<Leader, 'photo' | 'bio'>>()
  for (const b of rows) {
    const person = b.person?.value
    if (!person) continue
    const role: 'state' | 'government' = b.role?.value === 'state' ? 'state' : 'government'
    const url = b.article?.value ?? ''
    const article = url ? decodeURIComponent(url.split('/wiki/')[1] ?? '').replace(/_/g, ' ') : ''
    const label = b.personLabel?.value ?? ''
    const office = b.officeLabel?.value ?? ''
    const prev = out.get(person)
    if (prev) { if (!prev.roles.includes(role)) prev.roles.push(role); continue }
    out.set(person, {
      roles: [role],
      name: !label || isQid(label) ? article || label : label,
      office: isQid(office) ? '' : office,
      since: (b.start?.value ?? '').slice(0, 10),
      article, url,
    })
  }
  // Head of state first.
  return [...out.values()].sort((a, b) => Number(b.roles.includes('state')) - Number(a.roles.includes('state')))
}

// The country article's infobox is the primary source. Audited 2026-10-13 across
// all 201 countries: Wikidata's head-of-government statements were stale for
// dozens (DR Congo still named Ilunkamba, PM 2019–21, not Judith Suminwa;
// Burundi, Kuwait, Iraq, Laos, Zambia and others likewise), while the
// infobox is edited within hours of a change.

/** Office links that are not the head of state or government (checked first). */
const NOT_LEADER = /\b(vice|deputy|speakers?|justice|court|senate|assembly|parliament|congress|chamber|house of|legislat\w*|judicial|council of the nation|national council|people's council|governor[- ]general|commissioner|representatives?|secretary|crown prince|regent of|heir|succession|syndic|standing committee|national committee|storting|riksdag|seimas|majlis|saeima|althing|mother|tánaiste|assistance|chancellor of switzerland|federal chancellor)\b/i
const GOVERNMENT = /\b(prime ministers?|premier|chancellor|taoiseach|heads? of government|chief executive|chief minister|minister of state|(chairman|chairwoman|chair) of the (cabinet|council) of ministers|president of the government|governor of)\b/i
const STATE = /\b(presidents?|presidency|co-presidents|monarch|monarchy|kings?|queen|emperor|emir|sultans?|rulers|co-princes|supreme leader|captains regent|grand duke|pope|heads? of state|o le ao o le malo|ngwenyama|federal council)\b/i
const MONARCH = /\b(monarch|monarchy|kings?|queen|emperor|emir|sultans?|rulers|co-princes|captains regent|grand duke|pope|ngwenyama)\b/i
/** Links in a leader's cell that are not a person: offices, parties, notes. */
const NOT_PERSON = /\b(list of|party|president|prime minister|monarchy|presidency|chairman|chairwoman|council|government|bishop|congress|movement|front|union|alliance|coalition|independent politician|military|junta)\b/i

export type InfoboxLeader = Omit<Leader, 'photo' | 'bio' | 'since'>

const squash = (s: string | null | undefined) => (s ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
const articleFromHref = (href: string) => {
  const m = /^\/wiki\/([^?#]+)/.exec(href)
  if (!m) return ''
  const t = decodeURIComponent(m[1]).replace(/_/g, ' ')
  return t.includes(':') ? '' : t
}
/** The fuller of the link text and the article title (minus "(politician)"-style disambiguation). */
const fullName = (text: string, article: string) => {
  const title = article.replace(/\s*\([^)]*\)$/, '')
  return title.length > text.length ? title : text
}

/**
 * Head of state and head of government from a country article's rendered
 * infobox (Wikipedia's action=parse HTML for section 0). Leader rows follow the
 * "Government" row; each office link is classified, and the people are the
 * person links in the row's value cell.
 */
export function parseInfoboxLeaders(html: string): InfoboxLeader[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const box = doc.querySelector('table.infobox')
  if (!box) return []
  const rows = [...box.querySelectorAll('tr')]
  const start = rows.findIndex(r => /^government$/i.test(squash(r.querySelector('th')?.textContent)))
  if (start < 0) return []

  // Names that appear linked anywhere in the infobox, for cells that give a plain-text name.
  const linked = new Map<string, string>()
  for (const a of box.querySelectorAll('a[href^="/wiki/"]')) {
    const art = articleFromHref(a.getAttribute('href') ?? '')
    if (art) linked.set(squash(a.textContent), art)
  }

  type Row = { office: string; roles: Set<'state' | 'government'>; monarch: boolean; people: { name: string; article: string; office?: string }[]; note: string }
  const found: Row[] = []
  for (const r of rows.slice(start + 1)) {
    if (!/\bmerged(row|bottomrow)\b/.test(r.className)) break
    const th = r.querySelector('th'), td = r.querySelector('td')
    if (!th || !td) continue
    const links = [...th.querySelectorAll('a')].map(a => a.getAttribute('title') || squash(a.textContent))
    const roles = new Set<'state' | 'government'>()
    let monarch = false
    for (const c of links.length ? links : [squash(th.textContent)]) {
      if (NOT_LEADER.test(c)) continue
      if (GOVERNMENT.test(c)) roles.add('government')
      else if (STATE.test(c)) { roles.add('state'); monarch ||= MONARCH.test(c) }
    }
    if (!roles.size) continue

    const note = /\b(acting|interim|disputed)\b/i.exec(td.textContent ?? '')?.[1]?.toLowerCase() ?? ''
    const cell = td.cloneNode(true) as HTMLElement
    cell.querySelectorAll('sup, style, .reference, .noprint').forEach(e => e.remove())
    // A listed person's own qualifier: "(Vice president)" drops them; "(President)"
    // linking "President of the Swiss Confederation" becomes their office.
    const ownOffice = new Map<Element, string>()
    for (const li of cell.querySelectorAll('li')) {
      const q = li.querySelector('small')
      if (!q) continue
      if (/\b(vice|deputy)\b/i.test(q.textContent ?? '')) { li.remove(); continue }
      const office = q.querySelector('a')?.getAttribute('title')
      const who = li.querySelector('a')
      if (office && who && who !== q.querySelector('a')) ownOffice.set(who, STATE.test(office) || GOVERNMENT.test(office) ? office : `${squash(th.textContent).replace(/^•\s*/, '')} (${office})`)
    }
    const people: Row['people'] = []
    for (const a of cell.querySelectorAll('a')) {
      if (a.closest('small')) continue
      const href = a.getAttribute('href') ?? ''
      const title = a.getAttribute('title') ?? ''
      const text = squash(a.textContent)
      if (!text || NOT_PERSON.test(title || text) || /^\[?\w{2}\]?$/.test(text)) continue
      // A red link (no article yet) is still a name.
      const article = articleFromHref(href)
      if (!article && !/redlink=1/.test(href)) continue
      if (!people.some(p => p.name === text)) people.push({ name: fullName(text, article), article, office: ownOffice.get(a) })
    }
    cell.querySelectorAll('small').forEach(e => e.remove())
    if (!people.length) {
      const name = squash(cell.textContent).replace(/\((acting|interim|disputed)\)/gi, '').trim()
      if (name && name.length <= 80 && !/^(vacant|none|n\/a|[-–—])$/i.test(name)) people.push({ name, article: linked.get(name) ?? '' })
    }
    if (people.length) found.push({ office: squash(th.textContent).replace(/^•\s*/, ''), roles, monarch, people: people.slice(0, 3), note })
  }

  // The first state row and the first government row are the leaders. With no
  // government row, a second head-of-state-like row heads the government (Iran's
  // President under the Supreme Leader); otherwise a non-monarch head of state
  // also heads the government, as in a presidential system.
  const state = found.find(f => f.roles.has('state'))
  let gov = found.find(f => f.roles.has('government'))
  if (!gov && state) {
    const second = found.find(f => f !== state && f.roles.has('state') && /^president\b/i.test(f.office))
    if (second) gov = { ...second, roles: new Set(['government']) }
    else if (!state.monarch) state.roles.add('government')
  }

  const out = new Map<string, InfoboxLeader>()
  for (const [row, role] of [[state, 'state'], [gov, 'government']] as const) {
    if (!row) continue
    for (const p of row.people) {
      const key = p.article || p.name
      const prev = out.get(key)
      const roles = row === state && row.roles.has('government') ? ['state', 'government'] as const : [role]
      if (prev) { for (const x of roles) if (!prev.roles.includes(x)) prev.roles.push(x); continue }
      out.set(key, {
        roles: [...roles], name: p.name, article: p.article,
        office: row.note ? `${p.office ?? row.office} (${row.note})` : p.office ?? row.office,
        url: p.article ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.article.replace(/ /g, '_'))}` : '',
      })
    }
  }
  return [...out.values()].slice(0, 5)
}

export function infoboxUrl(title: string): string {
  return `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&section=0&redirects=1&disableeditsection=1&disablelimitreport=1&format=json&formatversion=2&origin=*`
}

async function fetchInfoboxLeaders(c: Country): Promise<InfoboxLeader[]> {
  const res = await fetch(infoboxUrl(wikiTitle(c)), { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
  const j = await res.json()
  return parseInfoboxLeaders(String(j?.parse?.text ?? ''))
}

const normTitle = (t: string) => t.replace(/_/g, ' ').normalize('NFC').toLowerCase()

/** Leaders change rarely: a looked-up answer is kept for six hours on this device. */
const LEADERS_TTL = 6 * 3600_000
const leadersKey = (c: Country) => `aihub-travel-leaders-v2:${c.code}`

export function cachedLeaders(c: Country, now = Date.now()): Leader[] | null {
  try {
    const hit = JSON.parse(localStorage.getItem(leadersKey(c)) || 'null')
    return hit && now - hit.at < LEADERS_TTL && Array.isArray(hit.leaders) ? hit.leaders : null
  } catch { return null }
}

export async function fetchLeaders(c: Country): Promise<Leader[]> {
  const cached = cachedLeaders(c)
  if (cached) return cached
  // Wikipedia names the people; Wikidata, when it agrees on the person, adds the start date.
  const [fromInfobox, fromWikidata] = await Promise.all([
    fetchInfoboxLeaders(c).catch(() => [] as InfoboxLeader[]),
    sparql(leadersQuery(wikiTitle(c)), 6000).then(parseLeaders).catch(() => [] as ReturnType<typeof parseLeaders>),
  ])
  const sinceFor = (l: InfoboxLeader) => {
    const same = fromWikidata.filter(w => w.article && normTitle(w.article) === normTitle(l.article))
    return (same.find(w => w.roles.some(r => l.roles.includes(r))) ?? same[0])?.since ?? ''
  }
  const base: Omit<Leader, 'photo' | 'bio'>[] = fromInfobox.length
    ? fromInfobox.map(l => ({ ...l, since: sinceFor(l) }))
    : fromWikidata.slice(0, 3)
  try {
    const leaders = await Promise.all(base.map(async l => {
      if (!l.article) return { ...l, photo: null, bio: '' }
      try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(l.article.replace(/ /g, '_'))}`)
        const j = res.ok ? await res.json() : null
        return { ...l, photo: j?.thumbnail?.source ?? null, bio: String(j?.extract ?? ''), url: j?.content_urls?.desktop?.page ?? l.url }
      } catch { return { ...l, photo: null, bio: '' } }
    }))
    // Only the infobox answer is kept; a Wikidata-only fallback is retried next time.
    if (fromInfobox.length) try { localStorage.setItem(leadersKey(c), JSON.stringify({ at: Date.now(), leaders })) } catch { /* storage full */ }
    return leaders
  } catch { return [] }
}

/** Wikipedia article titles where the everyday name is not the article's. */
const WIKI_TITLES: Record<string, string> = {
  CD: 'Democratic Republic of the Congo', CG: 'Republic of the Congo', CI: 'Ivory Coast', GE: 'Georgia (country)',
  TR: 'Turkey', PS: 'State of Palestine', FM: 'Federated States of Micronesia', TL: 'East Timor', IE: 'Republic of Ireland',
  GM: 'The Gambia', BS: 'The Bahamas', CV: 'Cape Verde', MO: 'Macau', CZ: 'Czech Republic', ST: 'São Tomé and Príncipe',
}

export function wikiTitle(c: Country): string { return WIKI_TITLES[c.code] ?? c.name }

export interface WikiSummary { extract: string; image: string | null; url: string }

export function fetchSummary(c: Country): Promise<WikiSummary | null> {
  return remembered(`aihub-travel-summary-v1:${c.code}`, DAY, () => loadSummary(c))
}

async function loadSummary(c: Country): Promise<WikiSummary | null> {
  try {
    const t = wikiTitle(c).replace(/ /g, '_')
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`)
    if (!res.ok) return null
    const j = await res.json()
    return {
      extract: String(j?.extract ?? ''),
      image: j?.originalimage?.source ?? j?.thumbnail?.source ?? null,
      url: j?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(t)}`,
    }
  } catch { return null }
}

// ── Videos ──────────────────────────────────────────────────────────────────

export interface TravelVideo { id: string; title: string; channel: string; duration: string; thumbnail: string }

export const VIDEO_TOPICS: { id: string; label: string; query: (name: string) => string[] }[] = [
  { id: 'top', label: 'Top sights', query: n => [`${n} travel guide`, `${n} top tourist attractions`, `best places to visit in ${n}`] },
  { id: 'drone', label: 'Drone 4K', query: n => [`${n} 4K drone`, `${n} aerial 4K`] },
  { id: 'walk', label: 'Walking tours', query: n => [`${n} walking tour 4K`, `${n} city walk`] },
  { id: 'food', label: 'Food', query: n => [`${n} street food tour`, `${n} food guide`] },
  { id: 'nature', label: 'Nature & beaches', query: n => [`${n} nature 4K`, `${n} beaches travel`, `${n} national parks`] },
  { id: 'culture', label: 'Culture', query: n => [`${n} culture travel`, `${n} traditions festival travel`] },
]

/** Not what a traveller came for: news, politics, conflict, clickbait. */
const OFF_TOPIC = /\b(news|breaking|war|military|army|protests?|riots?|politic\w*|elections?|president|minister|crisis|conflict|attack\w*|bomb\w*|killed|deaths?|murder\w*|crime|poverty|refugees?|invasion|sanctions|coup|scam\w*|prank|reaction|reacts?|shocking|exposed|debate|podcast|interview|documentary|history of)\b/i
const ON_TOPIC = /\b(travel|tour|trip|visit|guide|things to do|places|4k|drone|aerial|walk(ing)?|beach(es)?|island|nature|food|city|vlog|attractions?|explore|wonders|hidden gems|itinerary|vacation|holiday)\b/i

export function durationSeconds(d: string): number | null {
  if (!/^\d+(:\d{1,2}){1,2}$/.test((d || '').trim())) return null
  return d.trim().split(':').reduce((a, p) => a * 60 + parseInt(p, 10), 0)
}

/** A tourist video: about travel, between 1 and 75 minutes, and not news or politics. */
export function isTourismVideo(v: Pick<TravelVideo, 'title' | 'duration'>): boolean {
  const secs = durationSeconds(v.duration)
  if (secs == null || secs < 60 || secs > 75 * 60) return false
  if (OFF_TOPIC.test(v.title)) return false
  return true
}

/** Travel-worded titles first, then by search order; duplicates dropped. */
export function rankVideos(lists: TravelVideo[][]): TravelVideo[] {
  const seen = new Set<string>()
  const out: { v: TravelVideo; score: number; order: number }[] = []
  let order = 0
  // Interleave the searches so each query gets its best results near the top.
  const longest = Math.max(0, ...lists.map(l => l.length))
  for (let i = 0; i < longest; i++) {
    for (const l of lists) {
      const v = l[i]
      if (!v || seen.has(v.id) || !isTourismVideo(v)) continue
      seen.add(v.id)
      out.push({ v, score: ON_TOPIC.test(v.title) ? 1 : 0, order: order++ })
    }
  }
  return out.sort((a, b) => b.score - a.score || a.order - b.order).map(x => x.v)
}

/** Results per country and topic for this session: switching tabs or topics back does not search again. */
const videoCache = new Map<string, Promise<TravelVideo[]>>()

export function searchTravelVideos(country: Country, topic = 'top'): Promise<TravelVideo[]> {
  const key = `${country.code}|${topic}`
  let p = videoCache.get(key)
  if (!p) {
    p = searchUncached(country, topic)
    videoCache.set(key, p)
    p.catch(() => videoCache.delete(key)) // a failed search may be retried
  }
  return p
}

async function searchUncached(country: Country, topic: string): Promise<TravelVideo[]> {
  const t = VIDEO_TOPICS.find(x => x.id === topic) ?? VIDEO_TOPICS[0]
  const api = (window as any).electronAPI?.dj
  if (!api?.youtubeSearch) throw new Error('YouTube search is not available')
  const lists = await Promise.all(t.query(country.name).map(async q => {
    try {
      const r = await api.youtubeSearch(q, 14)
      return r?.ok && Array.isArray(r.videos) ? (r.videos as TravelVideo[]) : []
    } catch { return [] }
  }))
  if (lists.every(l => !l.length)) throw new Error('YouTube could not be reached')
  return rankVideos(lists)
}

// ── AI guide ────────────────────────────────────────────────────────────────

export type HotelTier = 'luxury' | 'mid' | 'budget'

export interface TravelGuide {
  overview: string
  bestTime: string
  geography: string
  economy: string
  politics: string
  culture: string
  safety: string
  visa: string
  money: string
  gettingAround: string
  hotels: { name: string; city: string; tier: HotelTier; why: string }[]
  airbnbAreas: { area: string; city: string; why: string }[]
  carRental: { companies: string[]; tips: string }
  mustSee: { name: string; city: string; why: string }[]
  food: string[]
}

function factsText(f: CountryFacts | null): string {
  if (!f) return ''
  return [
    f.official && `Official name: ${f.official}`,
    f.capital.length && `Capital: ${f.capital.join(', ')}`,
    f.population != null && `Population: ${f.population.toLocaleString('en-US')}`,
    f.areaKm2 != null && `Area: ${Math.round(f.areaKm2).toLocaleString('en-US')} km²`,
    f.subregion && `Region: ${f.subregion}`,
    f.currencies.length && `Currency: ${f.currencies.map(c => `${c.name} (${c.code})`).join(', ')}`,
    f.languages.length && `Languages: ${f.languages.join(', ')}`,
    f.driveSide && `Cars drive on the ${f.driveSide}`,
  ].filter(Boolean).join('\n')
}

export function buildGuidePrompt(c: Country, facts: CountryFacts | null, summary: string): string {
  return [
    `You are an expert travel writer and local guide. Write an accurate, practical travel guide to ${c.name} for a first-time visitor.`,
    'Use these verified facts and do not contradict them:',
    factsText(facts) || '(no facts available)',
    summary ? `Background: ${summary.slice(0, 1200)}` : '',
    'Rules: only name hotels, companies and places that really exist and are well known. If unsure, give fewer items rather than inventing.',
    'Keep politics neutral and factual (system of government, head of state role, stability for travellers) — no opinions.',
    'Reply with ONLY one JSON object, no other text, in exactly this shape:',
    '{"overview":"3-4 sentences","bestTime":"when to go and why","geography":"landscape, regions, climate",',
    '"economy":"main industries and natural resources","politics":"government system and what it means for visitors",',
    '"culture":"customs and etiquette visitors should know","safety":"practical safety advice","visa":"general entry requirements, advise checking official sources",',
    '"money":"currency, cards vs cash, tipping, rough daily costs","gettingAround":"trains, buses, domestic flights, taxis, apps",',
    '"hotels":[{"name":"real hotel name","city":"city","tier":"luxury|mid|budget","why":"one line"}],',
    '"airbnbAreas":[{"area":"neighbourhood","city":"city","why":"one line"}],',
    '"carRental":{"companies":["real rental companies operating there"],"tips":"licence, driving side, road conditions, insurance"},',
    '"mustSee":[{"name":"place","city":"city or region","why":"one line"}],',
    '"food":["dish — one line"]}',
    'Give 6 hotels (2 per tier), 4 Airbnb areas, 8 must-sees and 6 dishes.',
  ].filter(Boolean).join('\n')
}

const str = (v: unknown, max = 700) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Read the model's JSON reply. Anything malformed is dropped rather than shown. */
export function parseGuide(reply: string): TravelGuide | null {
  const a = reply.indexOf('{')
  const b = reply.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  let j: any
  try { j = JSON.parse(reply.slice(a, b + 1)) } catch { return null }
  if (!j || typeof j !== 'object') return null
  const list = <T>(v: unknown, map: (x: any) => T | null, max: number): T[] =>
    Array.isArray(v) ? v.map(map).filter((x): x is T => !!x).slice(0, max) : []
  const tier = (t: unknown): HotelTier => (t === 'luxury' || t === 'budget' ? t : 'mid')
  const g: TravelGuide = {
    overview: str(j.overview, 1200), bestTime: str(j.bestTime), geography: str(j.geography), economy: str(j.economy),
    politics: str(j.politics), culture: str(j.culture), safety: str(j.safety), visa: str(j.visa), money: str(j.money),
    gettingAround: str(j.gettingAround),
    hotels: list(j.hotels, x => (str(x?.name, 90) ? { name: str(x.name, 90), city: str(x.city, 60), tier: tier(x.tier), why: str(x.why, 200) } : null), 9),
    airbnbAreas: list(j.airbnbAreas, x => (str(x?.area, 80) ? { area: str(x.area, 80), city: str(x.city, 60), why: str(x.why, 200) } : null), 6),
    carRental: {
      companies: list(j.carRental?.companies, x => (str(x, 60) || null), 8),
      tips: str(j.carRental?.tips),
    },
    mustSee: list(j.mustSee, x => (str(x?.name, 90) ? { name: str(x.name, 90), city: str(x.city, 60), why: str(x.why, 200) } : null), 12),
    food: list(j.food, x => (str(x, 160) || null), 10),
  }
  return g.overview || g.hotels.length || g.mustSee.length ? g : null
}

const GUIDE_KEY = 'aihub-travel-guide-v1'
const GUIDE_TTL = 14 * 86_400_000

function readCache(): Record<string, { at: number; g: TravelGuide; provider: string }> {
  try { return JSON.parse(localStorage.getItem(GUIDE_KEY) || '{}') || {} } catch { return {} }
}

export function cachedGuide(code: string): { g: TravelGuide; provider: string } | null {
  const e = readCache()[code]
  return e && Date.now() - e.at < GUIDE_TTL ? { g: e.g, provider: e.provider } : null
}

export async function generateGuide(c: Country, facts: CountryFacts | null, summary: string): Promise<{ g: TravelGuide; provider: string }> {
  const ai = (window as any).electronAPI?.ai
  if (!ai?.chat) throw new Error('No AI model is available')
  const prompt = buildGuidePrompt(c, facts, summary)
  let lastErr = 'The AI model did not answer — check that Ollama or an AI provider is set up in Settings.'
  // A small local model sometimes wraps or breaks the JSON: one retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ai.chat([{ role: 'user', content: prompt }])
    if (!r || r.provider === 'error' || r.provider === 'none' || !r.content) continue
    const g = parseGuide(String(r.content))
    if (g) {
      const all = readCache()
      all[c.code] = { at: Date.now(), g, provider: String(r.provider || '') }
      try { localStorage.setItem(GUIDE_KEY, JSON.stringify(all)) } catch { /* cache is optional */ }
      return { g, provider: String(r.provider || '') }
    }
    lastErr = 'The AI reply could not be read — try again.'
  }
  throw new Error(lastErr)
}

// ── Links to check and book on real sites ───────────────────────────────────

const enc = encodeURIComponent

export const links = {
  booking: (q: string) => `https://www.booking.com/searchresults.html?ss=${enc(q)}`,
  airbnb: (place: string) => `https://www.airbnb.com/s/${enc(place)}/homes`,
  carRental: (place: string) => `https://www.google.com/search?q=${enc(`car rental ${place}`)}`,
  maps: (q: string) => `https://www.google.com/maps/search/${enc(q)}`,
  flights: (country: string) => `https://www.google.com/travel/flights?q=${enc(`flights to ${country}`)}`,
  /** UK government travel advice — country pages follow the plain name. */
  advisory: (c: Country) => `https://www.gov.uk/foreign-travel-advice/${c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[()'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  youtube: (id: string) => `https://www.youtube.com/watch?v=${id}`,
}
