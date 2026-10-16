/**
 * A cover for every song.
 *
 * A file's own artwork comes first (tags, or the album folder's cover.jpg —
 * main/dj/library.ts). Plenty of files have neither, so the song is looked up
 * on YouTube by artist and title and the top result's thumbnail is used. A
 * YouTube track whose thumbnail fails to load falls back to the standard-size
 * one, which every video has. Answers — including "nothing found" — are kept,
 * so a library is searched once, not on every visit.
 */
import { useEffect, useState } from 'react'
import type { DjTrack } from './engine/DjEngine'
import { knownMeta, loadMeta, type RawTrack } from './libraryData'

type CoverTrack = Pick<DjTrack, 'cover' | 'title' | 'youtubeId'> & Partial<Pick<DjTrack, 'artist' | 'token' | 'path' | 'name' | 'size'>>

const STORE_KEY = 'aihub-dj-cover-lookup-v1'
const MAX_ENTRIES = 3000
/** A miss is retried after this long — the song may be on YouTube by then. */
const MISS_TTL_MS = 7 * 24 * 3600 * 1000
const CONCURRENCY = 2

interface Entry { u: string | null; at: number }

let store: Record<string, Entry> | null = null

function load(): Record<string, Entry> {
  if (store) return store
  try { store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {} } catch { store = {} }
  return store!
}

function save(): void {
  const s = load()
  const keys = Object.keys(s)
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => s[a].at - s[b].at).slice(0, keys.length - MAX_ENTRIES).forEach(k => delete s[k])
  }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch { /* optional */ }
}

/** The search a song is looked up by; '' when there is nothing to search for. */
export function coverQuery(t: { title: string; artist?: string }): string {
  const title = String(t.title || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ').trim()
  if (title.length < 2) return ''
  return `${String(t.artist || '').trim()} ${title}`.trim().toLowerCase()
}

/** A cover found earlier for this song, without searching. */
export function cachedCover(t: CoverTrack): string | null | undefined {
  if (t.youtubeId) return ytFallback(t.youtubeId)
  const q = coverQuery(t)
  if (!q) return null
  const e = load()[q]
  if (!e) return undefined
  if (!e.u && Date.now() - e.at > MISS_TTL_MS) return undefined
  return e.u
}

export function ytFallback(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}

/**
 * YouTube's 4:3 thumbnails (default, hqdefault, sddefault) carry the 16:9
 * frame between black letterbox bars, which a square crop shows as dark bands
 * across the cover. mqdefault is the same frame at 16:9 with no bars, and
 * every video has it.
 */
export function displayCover(url: string): string {
  return url.replace(/^(https:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/[\w-]{6,}\/)(?:hq|sd)?default\.(?:jpg|webp)(\?.*)?$/, '$1mqdefault.jpg')
}

function remember(q: string, u: string | null): void {
  load()[q] = { u, at: Date.now() }
  save()
}

/** The top result's thumbnail; `definite` is false when the search itself failed. */
async function searchThumb(query: string): Promise<{ url: string | null; definite: boolean }> {
  try {
    const r = await (window as any).electronAPI?.dj?.youtubeSearch?.(query, 1)
    const thumb = r?.ok ? r.videos?.[0]?.thumbnail : undefined
    if (typeof thumb === 'string' && /^https:\/\//.test(thumb)) return { url: thumb, definite: true }
    return { url: null, definite: !!r && (r.ok || r.error === 'no-results') }
  } catch { return { url: null, definite: false } }
}

const inFlight = new Map<string, Promise<string | null>>()
const waiting: (() => void)[] = []
let running = 0

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>(r => waiting.push(r))
  running++
  try { return await work() } finally { running--; waiting.shift()?.() }
}

/** Finds a cover for a song that has none of its own. */
export function lookupCover(t: CoverTrack): Promise<string | null> {
  const known = cachedCover(t)
  if (known !== undefined) return Promise.resolve(known)
  const q = coverQuery(t)
  const pending = inFlight.get(q)
  if (pending) return pending
  const p = slot(async () => {
    // Artist + title first; a song YouTube doesn't know under both is often
    // there under its title alone.
    const titleOnly = coverQuery({ title: t.title })
    let missed = true
    for (const query of titleOnly && titleOnly !== q ? [q, titleOnly] : [q]) {
      const r = await searchThumb(query)
      if (r.url) { remember(q, r.url); return r.url }
      // A network failure says nothing about the song: try again next time.
      if (!r.definite) missed = false
    }
    if (missed) remember(q, null)
    return null
  }).finally(() => inFlight.delete(q))
  inFlight.set(q, p)
  return p
}

/** A file on this computer (its tags may hold artwork), not a YouTube video. */
function localFile(t: CoverTrack): RawTrack | null {
  if (t.youtubeId || !t.token || t.token.startsWith('yt-') || !t.path || /^https?:/i.test(t.path)) return null
  return { token: t.token, path: t.path, name: t.name || '', size: t.size || 0, ext: (t.path.split('.').pop() || '').toLowerCase() }
}

/**
 * The cover a song settles on, decided in order so the picture changes at
 * most once: the file's own artwork first (tags or folder art — read now if
 * the list hasn't yet), and only when it has none, a YouTube lookup. Doing the
 * lookup while the tags were still loading is what made covers flicker:
 * placeholder → YouTube thumbnail → embedded art, one after another.
 */
export async function resolveCover(t: CoverTrack): Promise<string | null> {
  if (t.cover) return t.cover
  const raw = localFile(t)
  if (raw) {
    const meta = knownMeta(raw.token) ?? await loadMeta(raw).catch(() => undefined)
    if (meta?.cover) return meta.cover
  }
  return lookupCover(t)
}

/**
 * The track as it should go onto a deck: with the same cover the library
 * shows for it, so the platter, jog screen and monitor carry the picture
 * that was dragged. Waits at most `waitMs` for a cover not found yet — a
 * load never hangs on a slow search.
 */
export async function withDeckCover<T extends CoverTrack>(t: T, waitMs = 1500): Promise<T> {
  if (t.cover) return { ...t, cover: displayCover(t.cover) }
  const found = await Promise.race([resolveCover(t), new Promise<null>(r => setTimeout(() => r(null), waitMs))]).catch(() => null)
  return found ? { ...t, cover: displayCover(found) } : t
}

/**
 * The picture to show for a song. `pending` while it is still being decided —
 * draw a quiet neutral tile then, not the placeholder — and `src` null with
 * `pending` false only when nothing exists anywhere. Pass `onError` to the <img>.
 */
export function useCover(t: CoverTrack | undefined): { src: string | null; pending: boolean; onError: () => void } {
  const [failed, setFailed] = useState<string[]>([])
  const own = t?.cover && !failed.includes(t.cover) ? t.cover : null
  const initial = () => (t && !own ? (localFile(t) && !knownMeta(t.token!) ? undefined : cachedCover(t)) : null)
  const [found, setFound] = useState<string | null | undefined>(initial)
  const key = t ? `${t.token || ''}|${t.youtubeId || ''}|${t.artist || ''}|${t.title || ''}` : ''

  useEffect(() => {
    if (!t || own) return
    let alive = true
    setFound(initial())
    // Without its own cover (none, or it failed to load): never hand back the failed one.
    resolveCover({ ...t, cover: undefined }).then(u => { if (alive) setFound(u) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, own])

  const fallback = found && !failed.includes(found) ? found : null
  const pick = own || fallback
  const src = pick ? displayCover(pick) : null
  return { src, pending: !pick && found === undefined, onError: () => { if (pick) setFailed(f => [...f, pick]) } }
}
