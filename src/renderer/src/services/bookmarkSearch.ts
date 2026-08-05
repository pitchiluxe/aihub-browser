import type { Bookmark } from '../store/browserStore'

/**
 * AIHub Browser — ranking for the toolbar bookmarks menu.
 *
 * The menu exists for the case the sphere is bad at: you know which bookmark
 * you want and you want it now. That makes ordering the whole feature — typing
 * "git" must put GitHub first, not the ninth page that happens to link to it.
 *
 * Ranking is by WHERE the match lands, not by how many times it occurs: a
 * title that starts with what you typed is almost always the one you meant.
 *
 * Everything else is alphabetical — the browsing case (no query, or several
 * equally good matches) wants a predictable place for each entry, not the
 * order things happened to be saved in.
 */

export type MatchField = 'title-prefix' | 'title' | 'url' | 'category'

export interface RankedBookmark {
  bookmark: Bookmark
  field: MatchField
}

const FIELD_ORDER: MatchField[] = ['title-prefix', 'title', 'url', 'category']

/** Case-insensitive, locale-aware title order — "éclair" sorts with the Es. */
export function byTitle(a: Bookmark, b: Bookmark): number {
  return (a?.title || a?.url || '').localeCompare(b?.title || b?.url || '', undefined, { sensitivity: 'base' })
}

export function sortAlphabetically(bookmarks: Bookmark[]): Bookmark[] {
  return [...(bookmarks || [])].filter(Boolean).sort(byTitle)
}

export function rankBookmarks(bookmarks: Bookmark[], query: string): Bookmark[] {
  const q = String(query || '').trim().toLowerCase()
  const list = bookmarks || []
  if (!q) return sortAlphabetically(list)

  const scored: RankedBookmark[] = []
  for (const bookmark of list) {
    if (!bookmark) continue
    const title = (bookmark.title || '').toLowerCase()
    const url = (bookmark.url || '').toLowerCase()
    const category = (bookmark.category || '').toLowerCase()

    if (title.startsWith(q)) scored.push({ bookmark, field: 'title-prefix' })
    else if (title.includes(q)) scored.push({ bookmark, field: 'title' })
    else if (url.includes(q)) scored.push({ bookmark, field: 'url' })
    else if (category.includes(q)) scored.push({ bookmark, field: 'category' })
  }

  // Relevance decides the tier; alphabetical decides the order inside it, so
  // repeating a search always produces the same list.
  return scored
    .sort((a, b) =>
      FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field) || byTitle(a.bookmark, b.bookmark))
    .map(entry => entry.bookmark)
}

/** Group for display: categories A→Z, and bookmarks A→Z inside each. */
export function groupByCategory(bookmarks: Bookmark[]): [string, Bookmark[]][] {
  const byCategory = new Map<string, Bookmark[]>()
  for (const bookmark of bookmarks || []) {
    if (!bookmark) continue
    const key = bookmark.category || 'Other'
    const list = byCategory.get(key)
    if (list) list.push(bookmark)
    else byCategory.set(key, [bookmark])
  }
  return [...byCategory.entries()]
    .map(([category, items]) => [category, [...items].sort(byTitle)] as [string, Bookmark[]])
    .sort((a, b) => a[0].localeCompare(b[0]))
}

/**
 * The flat order the keyboard walks. It must match what grouping draws, or
 * arrow keys highlight one row and Enter opens another.
 */
export function flattenGroups(groups: [string, Bookmark[]][]): Bookmark[] {
  return groups.flatMap(([, items]) => items)
}
