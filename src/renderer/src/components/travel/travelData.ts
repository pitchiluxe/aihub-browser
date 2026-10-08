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
async function sparql(query: string): Promise<Row[]> {
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  })
  if (!res.ok) throw new Error(`Wikidata ${res.status}`)
  const j = await res.json()
  return Array.isArray(j?.results?.bindings) ? j.results.bindings : []
}

/** Find the country by its English Wikipedia article — the same page the summary comes from. */
const byArticle = (title: string) =>
  `?ca schema:about ?country ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ${JSON.stringify(title)}@en .`

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

export async function fetchFacts(c: Country): Promise<CountryFacts | null> {
  try {
    const rows = await sparql(factsQuery(wikiTitle(c)))
    return rows.length ? normalizeFacts(rows[0]) : null
  } catch { return null }
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

export async function fetchLeaders(c: Country): Promise<Leader[]> {
  try {
    const base = parseLeaders(await sparql(leadersQuery(wikiTitle(c)))).slice(0, 3)
    return await Promise.all(base.map(async l => {
      if (!l.article) return { ...l, photo: null, bio: '' }
      try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(l.article.replace(/ /g, '_'))}`)
        const j = res.ok ? await res.json() : null
        return { ...l, photo: j?.thumbnail?.source ?? null, bio: String(j?.extract ?? ''), url: j?.content_urls?.desktop?.page ?? l.url }
      } catch { return { ...l, photo: null, bio: '' } }
    }))
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

export async function fetchSummary(c: Country): Promise<WikiSummary | null> {
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
