import { net } from 'electron'

/**
 * Link previews.
 *
 * Fetching a preview tells the linked site that someone opened a conversation
 * containing its URL. That is a real disclosure, so it is deliberately narrow:
 * only http and https, only when a message actually carries a link, one request
 * per URL ever (results are cached for the session), a hard timeout, and only
 * the first 128 KB is read — enough for any `<head>`, far short of downloading
 * whatever the URL actually serves.
 *
 * Nothing is executed and nothing is stored on disk. The parser reads meta tags
 * with a regex rather than a DOM, because the input is a hostile document from
 * an arbitrary server and the smallest possible surface is the right one.
 */

export interface LinkPreview {
  url: string
  title?: string
  description?: string
  image?: string
  siteName?: string
}

const CACHE = new Map<string, LinkPreview | null>()
const MAX_CACHE = 500
const TIMEOUT_MS = 6_000
const MAX_BYTES = 128 * 1024

/** Absolute http(s) URLs only. Anything else is not previewed and not fetched. */
export function isPreviewable(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch { return false }
}

/** The URLs in a message body, in order, de-duplicated. */
export function urlsIn(body: string): string[] {
  const found = new Set<string>()
  for (const match of String(body ?? '').matchAll(/https?:\/\/[^\s<>"')]+/gi)) {
    const cleaned = match[0].replace(/[.,;:!?]+$/, '')
    if (isPreviewable(cleaned)) found.add(cleaned)
  }
  return [...found]
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** One meta tag's content, matched either attribute order. */
function meta(html: string, name: string): string | undefined {
  const escaped = name.replace(/[:]/g, '\\:')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match?.[1]) return decodeEntities(match[1]).trim().slice(0, 400)
  }
  return undefined
}

async function fetchHead(url: string): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: string | null) => { if (!settled) { settled = true; resolve(value) } }

    let request: ReturnType<typeof net.request>
    try {
      request = net.request({ url, method: 'GET', redirect: 'follow' })
    } catch { return finish(null) }

    // A generic desktop user agent: some sites serve no card markup at all to
    // clients they do not recognise.
    request.setHeader('User-Agent', 'Mozilla/5.0 (compatible; AIHubBrowser/1.0; +link-preview)')
    request.setHeader('Accept', 'text/html,application/xhtml+xml')

    const timer = setTimeout(() => { try { request.abort() } catch {} ; finish(null) }, TIMEOUT_MS)

    request.on('response', response => {
      const type = String(response.headers['content-type'] ?? '')
      if (!/text\/html|application\/xhtml/i.test(type)) {
        clearTimeout(timer)
        try { request.abort() } catch {}
        return finish(null)
      }

      let html = ''
      response.on('data', (chunk: Buffer) => {
        html += chunk.toString('utf8')
        // The head is all that matters. Stop as soon as it closes, or at the
        // cap — a preview must never become a download.
        if (html.length >= MAX_BYTES || /<\/head>/i.test(html)) {
          clearTimeout(timer)
          try { request.abort() } catch {}
          finish(html.slice(0, MAX_BYTES))
        }
      })
      response.on('end', () => { clearTimeout(timer); finish(html.slice(0, MAX_BYTES)) })
      response.on('error', () => { clearTimeout(timer); finish(null) })
    })

    request.on('error', () => { clearTimeout(timer); finish(null) })
    try { request.end() } catch { clearTimeout(timer); finish(null) }
  })
}

export async function linkPreview(rawUrl: string): Promise<LinkPreview | null> {
  const url = String(rawUrl ?? '')
  if (!isPreviewable(url)) return null
  if (CACHE.has(url)) return CACHE.get(url) ?? null

  const html = await fetchHead(url)
  let preview: LinkPreview | null = null

  if (html) {
    const documentTitle =
      decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').trim().slice(0, 400)
    const title = meta(html, 'og:title')
      ?? meta(html, 'twitter:title')
      ?? (documentTitle || undefined)
    const description = meta(html, 'og:description') ?? meta(html, 'twitter:description') ?? meta(html, 'description')
    const image = meta(html, 'og:image') ?? meta(html, 'twitter:image')
    const siteName = meta(html, 'og:site_name') ?? new URL(url).hostname.replace(/^www\./, '')

    // A card with nothing on it is worse than no card: it takes space and says
    // less than the link it replaced.
    if (title || description) {
      preview = {
        url,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        // Only https images: an http image inside the app is mixed content and
        // a tracking pixel with extra steps.
        ...(image && image.startsWith('https://') ? { image } : {}),
        siteName,
      }
    }
  }

  if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value as string)
  CACHE.set(url, preview)
  return preview
}
