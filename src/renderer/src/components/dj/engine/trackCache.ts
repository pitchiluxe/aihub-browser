/**
 * Remembers per-file facts that are expensive to work out (length, tempo) so
 * the library columns fill instantly the next time a folder is opened.
 * Keyed by absolute path; capped so it cannot grow without bound.
 */

export interface CachedTrack { d?: number; bpm?: number }

const KEY = 'aihub-dj-tracks-v1'
const MAX_ENTRIES = 4000

let cache: Record<string, CachedTrack> | null = null
let saveTimer = 0
const listeners = new Set<() => void>()

function load(): Record<string, CachedTrack> {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { cache = {} }
  return cache!
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const c = load()
    const keys = Object.keys(c)
    if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete c[k]
    try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* quota — cache is optional */ }
  }, 800)
}

export function cachedTrack(path: string): CachedTrack | undefined {
  return load()[path]
}

export function rememberTrack(path: string, facts: CachedTrack): void {
  const c = load()
  const prev = c[path] || {}
  const next = { ...prev, ...Object.fromEntries(Object.entries(facts).filter(([, v]) => v != null)) }
  if (prev.d === next.d && prev.bpm === next.bpm) return
  // Re-insert so the newest entries survive the cap.
  delete c[path]
  c[path] = next
  scheduleSave()
  for (const l of listeners) l()
}

export function onTrackCacheChange(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
