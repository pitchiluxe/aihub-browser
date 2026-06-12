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

  const { category, color } = await window.electronAPI.ai.categorizeBookmark(normalizedUrl, title || normalizedUrl)
  const bookmark = await window.electronAPI.bookmarks.add({
    url: normalizedUrl,
    title: title || extractDomainName(normalizedUrl),
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
