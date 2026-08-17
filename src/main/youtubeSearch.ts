// Reading a YouTube search page without an API key.
//
// The Data API would be cleaner, but it needs a Google Cloud project, a key
// per install, and a quota that a browsing app would burn through. YouTube's
// own search page embeds its whole result set as JSON in a `ytInitialData`
// assignment, so the results can be read from the page the browser would have
// loaded anyway.
//
// This is scraping, and scraping breaks. Everything here is therefore written
// to fail soft: an unrecognised shape yields fewer results or none, never an
// exception, and never a half-built entry with a missing video id. The parser
// is pure so its handling of a changed payload can be tested against a fixture
// rather than against the live site.

export interface YouTubeVideo {
  id: string
  title: string
  channel: string
  /** As YouTube renders it — "4:21". Empty when the payload omitted it. */
  duration: string
  /** "1.2M views", or empty. */
  views: string
  thumbnail: string
  url: string
}

/** Thumbnail URL for a video id. `hqdefault` exists for every video. */
export function thumbnailFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** YouTube ids are exactly 11 URL-safe characters. Anything else is not one. */
export function isVideoId(id: unknown): id is string {
  return typeof id === 'string' && VIDEO_ID.test(id)
}

/**
 * Pull the `ytInitialData` object out of a search page.
 *
 * The assignment appears in more than one form depending on which variant of
 * the page was served, so both are tried. Brace matching rather than a greedy
 * regex: the payload contains every bracket character imaginable inside string
 * literals, and a regex that tries to find the closing brace gets it wrong.
 */
export function extractInitialData(html: string): any | null {
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = ']
  for (const marker of markers) {
    const at = html.indexOf(marker)
    if (at === -1) continue
    const start = html.indexOf('{', at)
    if (start === -1) continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < html.length; i++) {
      const ch = html[i]
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try { return JSON.parse(html.slice(start, i + 1)) } catch { return null }
        }
      }
    }
  }
  return null
}

/** YouTube wraps display text as either `simpleText` or an array of `runs`. */
function readText(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (typeof node.simpleText === 'string') return node.simpleText
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text || '').join('')
  return ''
}

/**
 * Walk the payload for `videoRenderer` nodes.
 *
 * A recursive sweep rather than the documented path through
 * contents → twoColumnSearchResultsRenderer → … because that path has changed
 * repeatedly and the node itself has not. Shelves, chips and promoted slots
 * all nest results differently; they all still contain videoRenderers.
 */
export function collectVideoRenderers(node: any, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== 'object' || depth > 30) return out
  if (Array.isArray(node)) {
    for (const item of node) collectVideoRenderers(item, out, depth + 1)
    return out
  }
  if (node.videoRenderer && isVideoId(node.videoRenderer.videoId)) out.push(node.videoRenderer)
  for (const key of Object.keys(node)) {
    if (key === 'videoRenderer') continue
    collectVideoRenderers(node[key], out, depth + 1)
  }
  return out
}

/**
 * Turn a search page into a video list.
 *
 * Live streams and premieres are dropped: a "gospel music" search returns a
 * lot of 24/7 radio streams, and a theatre listing of things with no runtime
 * that may or may not be playing is not what was asked for.
 */
export function parseSearchResults(html: string, limit = 40): YouTubeVideo[] {
  const data = extractInitialData(html)
  if (!data) return []

  const seen = new Set<string>()
  const out: YouTubeVideo[] = []
  for (const r of collectVideoRenderers(data)) {
    const id = r.videoId
    if (!isVideoId(id) || seen.has(id)) continue

    const duration = readText(r.lengthText)
    // No lengthText means a live stream or a premiere.
    if (!duration) continue

    const title = readText(r.title).trim()
    if (!title) continue

    seen.add(id)
    out.push({
      id,
      title,
      channel: readText(r.ownerText) || readText(r.longBylineText) || '',
      duration,
      views: readText(r.shortViewCountText),
      thumbnail: thumbnailFor(id),
      url: `https://www.youtube.com/watch?v=${id}`,
    })
    if (out.length >= limit) break
  }
  return out
}

/** The search URL for a query, restricted to videos only (`sp=EgIQAQ%3D%3D`). */
export function searchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`
}

/**
 * Deterministic shuffle.
 *
 * The Gospel room asks for "something to listen to", not "the top result for
 * gospel music", so the list is shuffled. Seeded so that a re-render does not
 * reshuffle underneath someone halfway down the page.
 */
export function shuffleSeeded<T>(items: T[], seed: number): T[] {
  const out = items.slice()
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The searches the Gospel room draws from.
 *
 * Deliberately a spread of traditions and eras rather than one playlist, so
 * the room does not become one artist's back catalogue: choir and congregational
 * singing, contemporary worship, southern and urban gospel, hymns, and
 * non-English gospel traditions.
 */
export const GOSPEL_QUERIES: string[] = [
  'gospel music worship song',
  'black gospel choir performance',
  'contemporary christian worship live',
  'southern gospel quartet',
  'traditional hymns choir',
  'praise and worship songs live',
  'gospel piano instrumental worship',
  'african gospel music',
  'spanish christian worship musica cristiana',
  'acapella gospel choir',
]
