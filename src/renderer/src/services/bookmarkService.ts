import { Bookmark } from '../store/browserStore'

export async function loadBookmarks(): Promise<Bookmark[]> {
  return window.electronAPI.bookmarks.getAll()
}

export async function addBookmarkWithAI(
  url: string,
  title: string,
  existingBookmarks: Bookmark[]
): Promise<{ success: boolean; bookmark?: Bookmark; error?: string; warning?: string }> {
  let normalizedUrl = url.trim()
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`
  }
  try { new URL(normalizedUrl) } catch { return { success: false, error: 'Invalid URL format' } }

  const existingUrls = existingBookmarks.map(b => b.url)
  const dupCheck = await window.electronAPI.ai.checkDuplicate(normalizedUrl, existingUrls)
  if (dupCheck.isDuplicate) return { success: false, error: `Already bookmarked: ${dupCheck.reason}` }

  // Categorize with the full title for best AI context, but STORE a short name:
  // bookmark tiles are fixed-width, so long page titles overflow and knock the
  // grid out of alignment.
  const { category, color } = await window.electronAPI.ai.categorizeBookmark(normalizedUrl, title || normalizedUrl)
  const bookmark = await window.electronAPI.bookmarks.add({
    url: normalizedUrl,
    title: shortenBookmarkName(title, normalizedUrl),
    favicon: `https://www.google.com/s2/favicons?domain=${normalizedUrl}&sz=64`,
    category,
    color,
  })

  return {
    success: true,
    bookmark,
    warning: dupCheck.isSameDomain ? `Note: You have another bookmark from ${new URL(normalizedUrl).hostname}` : undefined,
  }
}

export async function removeBookmark(id: string): Promise<boolean> {
  return window.electronAPI.bookmarks.remove(id)
}

function extractDomainName(url: string): string {
  try {
    const host = new URL(url).hostname.replace('www.', '')
    const name = host.split('.')[0]
    return name.charAt(0).toUpperCase() + name.slice(1)
  } catch { return url }
}

// Produce a concise, tile-friendly bookmark label from a (possibly very long)
// page title. Empty titles fall back to the domain name. Otherwise: collapse
// whitespace, drop a trailing "— Site Name" style suffix when the leading
// segment can stand on its own, and cap the length on a word boundary.
const MAX_BOOKMARK_NAME = 24
export function shortenBookmarkName(rawTitle: string, url: string): string {
  let t = (rawTitle || '').replace(/\s+/g, ' ').trim()
  if (!t) return extractDomainName(url)

  // "Article Title — Brand" / "Page | Site" → keep the first, usually most
  // specific, segment (but only if it's substantial on its own). ':' is left
  // intact so things like "9:41 Keynote" aren't chopped.
  const parts = t.split(/\s+[|•·–—»]\s+/)
  if (parts.length > 1 && parts[0].length >= 3) t = parts[0].trim()

  if (t.length > MAX_BOOKMARK_NAME) {
    const cut = t.slice(0, MAX_BOOKMARK_NAME)
    const lastSpace = cut.lastIndexOf(' ')
    t = (lastSpace >= 12 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }
  return t
}
