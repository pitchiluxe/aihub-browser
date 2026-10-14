// Web search for the AI tools (agent, travel deal research), with no API key.
//
// One scraped engine is not enough: on 2026-10-13 DuckDuckGo's HTML endpoint
// started answering this PC with HTTP 202 "anomaly" bot challenges, and every
// AI deal research failed with "Travel sources could not be reached". Engines
// are now tried as hedged requests: the first starts at once, the next starts
// when one fails or has not answered within `hedgeMs`, and the first engine
// with results wins. An engine that challenged us rests for a while.

export interface SearchHit { title: string; url: string; snippet: string }

export type SearchResult =
  | { success: true; query: string; engine: string; results: SearchHit[] }
  | { success: false; query: string; error: string }

/** GET through Chromium's network stack (netGet.ts): status + body, never throws on a non-2xx status. */
export type SearchGet = (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>

export interface SearchEngine { name: string; url: (q: string) => string; parse: (html: string) => SearchHit[]; blocked: (status: number, html: string) => boolean }

const MAX_HITS = 8

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

// Highlight tags (<strong>cheap</strong>) sit inside words and sentences: drop them without a space.
const text = (html: string) => decodeEntities(html.replace(/<\/?(strong|b|em|i|span|mark)\b[^>]*>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Organic web results only: http(s), not the engine's own pages or ad redirects, no duplicates. */
function clean(hits: SearchHit[], ownHosts: RegExp): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const h of hits) {
    let u: URL
    try { u = new URL(h.url) } catch { continue }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
    if (ownHosts.test(u.hostname) || /[?&](ad_provider|ad_domain)=/.test(u.search)) continue
    const key = u.href.replace(/#.*$/, '').replace(/\/$/, '')
    if (seen.has(key) || !h.title) continue
    seen.add(key)
    out.push({ title: h.title.slice(0, 250), url: u.href, snippet: h.snippet.slice(0, 1500) })
    if (out.length >= MAX_HITS) break
  }
  return out
}

/** html.duckduckgo.com: links are redirect-wrapped, the real destination is in `uddg`. */
export function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  links.forEach((a, i) => {
    // The snippet belongs to this link when it comes before the next link.
    const block = html.slice(a.index! + a[0].length, links[i + 1]?.index ?? html.length)
    let url = decodeEntities(a[1])
    try {
      const parsed = new URL(url.startsWith('//') ? `https:${url}` : url)
      url = parsed.searchParams.get('uddg') ?? parsed.href
    } catch { return }
    const snip = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    hits.push({ title: text(a[2]), url, snippet: snip ? text(snip[1]) : '' })
  })
  return clean(hits, /(^|\.)duckduckgo\.com$/)
}

/** Bing wraps links as /ck/a?…&u=a1<base64url of the destination>. */
export function bingTarget(href: string): string {
  try {
    const u = new URL(decodeEntities(href), 'https://www.bing.com')
    const enc = u.searchParams.get('u')
    if (/(^|\.)bing\.com$/.test(u.hostname) && enc?.startsWith('a1')) {
      return Buffer.from(enc.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    }
    return u.href
  } catch { return '' }
}

export function parseBing(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const body = block.slice(0, block.indexOf('</li>') + 1 || undefined)
    const a = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(body)
    if (!a) continue
    const snip = /<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(body) ?? /class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(body)
    hits.push({ title: text(a[2]), url: bingTarget(a[1]), snippet: snip ? text(snip[1]) : '' })
  }
  return clean(hits, /(^|\.)(bing|microsoft|msn)\.com$/)
}

export function parseBrave(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of html.split(/data-type="web"/).slice(1)) {
    const a = /<a[^>]*href="(https?:\/\/[^"]+)"/.exec(block)
    const title = /class="[^"]*search-snippet-title[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)
    if (!a || !title) continue
    const snip = /class="content [^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)
    hits.push({ title: text(title[1]), url: decodeEntities(a[1]), snippet: snip ? text(snip[1]) : '' })
  }
  return clean(hits, /(^|\.)(brave\.com)$/)
}

const enc = encodeURIComponent

export const ENGINES: SearchEngine[] = [
  {
    name: 'DuckDuckGo', url: q => `https://html.duckduckgo.com/html/?q=${enc(q)}`, parse: parseDuckDuckGo,
    // A bot challenge comes back as 202 with an "anomaly" page instead of results.
    blocked: (status, html) => status === 202 || /anomaly-modal|class="anomaly/.test(html),
  },
  {
    name: 'Brave Search', url: q => `https://search.brave.com/search?q=${enc(q)}&source=web`, parse: parseBrave,
    blocked: (status, html) => status === 429 || (/captcha/i.test(html.slice(0, 20000)) && !/data-type="web"/.test(html)),
  },
  {
    name: 'Bing', url: q => `https://www.bing.com/search?q=${enc(q)}&setlang=en&cc=US`, parse: parseBing,
    blocked: (status, html) => status === 429 || /<title>[^<]*captcha/i.test(html),
  },
]

/** Engines that challenged or failed us recently, and until when they rest (ms since epoch). */
const resting = new Map<string, number>()
const REST_MS = 30 * 60_000
const FAIL_REST_MS = 10 * 60_000

export function searchWeb(query: string, get: SearchGet, opts: { engines?: SearchEngine[]; hedgeMs?: number; timeoutMs?: number; now?: () => number } = {}): Promise<SearchResult> {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!q) return Promise.resolve({ success: false, query: q, error: 'query is required' })
  const now = opts.now ?? Date.now
  const all = opts.engines ?? ENGINES
  const awake = all.filter(e => (resting.get(e.name) ?? 0) <= now())
  // If every engine is resting, try them anyway rather than fail without asking.
  const engines = awake.length ? awake : all
  const hedgeMs = opts.hedgeMs ?? 2500
  const timeoutMs = opts.timeoutMs ?? 10000

  return new Promise(resolve => {
    const errors: string[] = []
    let next = 0
    let finished = 0
    let done = false
    let hedge: ReturnType<typeof setTimeout> | undefined

    const finish = (r: SearchResult) => { if (!done) { done = true; clearTimeout(hedge); resolve(r) } }
    const launch = () => {
      clearTimeout(hedge)
      if (done || next >= engines.length) return
      const engine = engines[next++]
      hedge = setTimeout(launch, hedgeMs)
      get(engine.url(q), timeoutMs).then(({ status, body }) => {
        if (engine.blocked(status, body)) { resting.set(engine.name, now() + REST_MS); throw new Error('asked to verify we are human') }
        if (status >= 400) throw new Error(`HTTP ${status}`)
        const results = engine.parse(body)
        if (!results.length) throw Object.assign(new Error('no results'), { empty: true })
        finish({ success: true, query: q, engine: engine.name, results })
      }).catch((e: any) => {
        // Unreachable or failing (even after another engine already answered): rest it
        // briefly, so the next search does not wait out its timeout again.
        if (!e?.empty && (resting.get(engine.name) ?? 0) <= now()) resting.set(engine.name, now() + FAIL_REST_MS)
        errors.push(`${engine.name}: ${String(e?.message || e)}`)
      }).finally(() => {
        finished++
        if (done) return
        if (finished === engines.length) finish({ success: false, query: q, error: errors.join('; ') || 'no results' })
        else if (next === finished) launch()   // nothing in flight: start the next engine now
      })
    }
    launch()
  })
}

/** Test hook: forget which engines are resting. */
export function resetSearchEngines(): void { resting.clear() }
