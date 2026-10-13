// Every song the AI DJ's search found, kept for the console library ("✨ AI DJ
// finds") with its thumbnail — so a song seen on the stage is one click away on
// the decks too. Newest first, de-duplicated, capped, saved in localStorage
// (a per-device convenience; nothing breaks if storage is blocked).
import type { DjTrack } from './engine/DjEngine'
import { itemFrom, type QueueItem } from './ytQueue'

const KEY = 'aihub-dj-ai-finds'
export interface AiFind extends QueueItem { query: string; at: number }

export function createAiFinds(cap = 300) {
  const listeners = new Set<() => void>()
  let items: AiFind[] = []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (Array.isArray(raw)) items = raw.filter(i => i && typeof i.id === 'string' && typeof i.title === 'string').slice(0, cap)
  } catch { /* storage blocked or corrupt: start empty */ }

  return {
    get: () => items,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    add(tracks: DjTrack[], query: string) {
      const now = Date.now()
      const fresh = tracks.map(itemFrom).filter((i): i is QueueItem => !!i).map(i => ({ ...i, query, at: now }))
      const ids = new Set(fresh.map(i => i.id))
      const seen = new Set<string>()
      items = [...fresh, ...items.filter(i => !ids.has(i.id))].filter(i => !seen.has(i.id) && !!seen.add(i.id)).slice(0, cap)
      try { localStorage.setItem(KEY, JSON.stringify(items)) } catch { /* full or blocked */ }
      listeners.forEach(l => l())
    },
  }
}

/** The app-wide list (DjPage adds, Library shows). */
export const aiFinds = createAiFinds()
