/**
 * Favicon helpers shared by the main process and the UI.
 *
 * Background: every favicon used to be an <img> pointing straight at
 * `google.com/s2/favicons?domain=<full url>`. Two problems, one visible and one
 * not.
 *
 * The visible one: Google 404s for any site it has no icon for, and a failed
 * <img> load is written to the console by Chromium itself. No amount of
 * `onError` handling removes it — the entry is made before the handler runs.
 * Forty bookmarks without icons meant forty red lines in DevTools every time
 * the homepage rendered.
 *
 * The quiet one: `domain=` was handed the entire URL, path and query included,
 * so bookmarks to the same site with different paths each missed the cache and
 * asked for an icon under a key that could never match.
 *
 * The fix is to fetch in the main process, where a 404 is an integer and not a
 * console entry, and to give the renderer either a data URI that is known to
 * work or a generated tile that needs no network at all.
 */

/**
 * The registrable host for a URL, lowercased, or '' when there isn't one.
 *
 * Deliberately tolerant: bookmarks accumulate over years and contain bare
 * hostnames, schemeless pastes and the occasional broken entry. Returning ''
 * for those lets the caller fall back to a generated tile instead of throwing
 * inside a render.
 */
export function hostOf(raw: string): string {
  const input = String(raw ?? '').trim()
  if (!input) return ''
  try {
    // A bare "example.com/path" has no scheme and would otherwise parse as a
    // relative URL with an empty host.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`
    const host = new URL(withScheme).hostname.toLowerCase()
    // Reject things that cannot be a real host: a favicon request for
    // "localhost" or an IP is fine, but an empty label never is.
    return host && host.includes('.') || host === 'localhost' ? host : ''
  } catch {
    return ''
  }
}

/** The first character a human would read as the site's initial. */
export function initialFor(host: string): string {
  const cleaned = String(host ?? '').replace(/^www\./, '')
  const first = [...cleaned].find(c => /[a-z0-9]/i.test(c))
  return (first || '?').toUpperCase()
}

/** Deterministic hue per host, so a site keeps the same colour everywhere. */
function hueFor(host: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < host.length; i++) {
    h ^= host.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 360
}

/**
 * A generated letter tile, as a data URI.
 *
 * Used whenever the real icon is unknown, unavailable, or still loading. It
 * costs no request, so it cannot fail, cannot log, and works offline — which
 * is the entire point of replacing the hot-link.
 */
export function letterTileDataUri(url: string, size = 32): string {
  const host = hostOf(url) || String(url ?? '')
  const hue = hueFor(host)
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">`,
    `<rect width="32" height="32" rx="7" fill="hsl(${hue} 42% 26%)"/>`,
    `<text x="16" y="17" text-anchor="middle" dominant-baseline="central"`,
    ` font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="16"`,
    ` font-weight="600" fill="hsl(${hue} 75% 74%)">${escapeXml(initialFor(host))}</text>`,
    `</svg>`,
  ].join('')
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

/**
 * Where to ask for a real icon, given a host.
 *
 * Still Google's service — it has by far the best coverage — but keyed on the
 * host alone, and only ever requested from the main process, where a 404 is a
 * status code rather than a console entry.
 */
export function faviconSourceUrl(host: string, size = 64): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`
}
