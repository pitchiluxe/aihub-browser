/**
 * Library data access for AIHub DJ: talks to the main-process library over
 * IPC, enriches files with tags, and keeps a token → track registry so a
 * drag from the browser can be resolved on drop.
 */
import type { DjTrack } from './engine/DjEngine'
import { cachedTrack, rememberTrack } from './engine/trackCache'

export interface RawTrack { token: string; name: string; path: string; size: number; ext: string }
export interface Folder { name: string; path: string }
export interface TrackMeta { title?: string; artist?: string; album?: string; bpm?: number; key?: string; durationSec?: number; cover?: string }

const api = () => (window as any).electronAPI.dj as {
  roots(): Promise<{ places: Folder[]; drives: Folder[] }>
  list(dir: string): Promise<{ folders: Folder[]; tracks: RawTrack[] }>
  search(dir: string, q: string): Promise<{ tracks: RawTrack[]; truncated: boolean }>
  meta(token: string): Promise<TrackMeta | null>
  pickFolder(): Promise<Folder | null>
  saveRecording(data: ArrayBuffer, ext: string): Promise<{ success: boolean; path?: string; error?: string }>
  registerFile(path: string): Promise<RawTrack | null>
  pathForFile(file: File): string
}
export const djApi = api

const registry = new Map<string, DjTrack>()
const metaCache = new Map<string, TrackMeta>()

export function trackByToken(token: string): DjTrack | undefined {
  return registry.get(token)
}

/** "Artist - Title.mp3" → { artist, title } when the file has no tags. */
export function parseFileName(name: string): { artist: string; title: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim()
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base }
}

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'mkv'])

export function toTrack(raw: RawTrack, meta?: TrackMeta): DjTrack {
  const fromName = parseFileName(raw.name)
  const t: DjTrack = {
    token: raw.token,
    path: raw.path,
    name: raw.name,
    size: raw.size,
    title: meta?.title || fromName.title,
    artist: meta?.artist || fromName.artist,
    album: meta?.album,
    cover: meta?.cover,
    tagBpm: meta?.bpm,
    key: meta?.key,
    video: VIDEO_EXT.has(raw.ext),
  }
  registry.set(raw.token, t)
  return t
}

export function knownMeta(token: string): TrackMeta | undefined {
  return metaCache.get(token)
}

// ── Bounded work queues ──────────────────────────────────────────────────────
function queue<T>(concurrency: number, work: (key: string) => Promise<T>) {
  const pending: string[] = []
  const inFlight = new Set<string>()
  const waiting = new Map<string, ((v: T | null) => void)[]>()
  const pump = () => {
    while (inFlight.size < concurrency && pending.length) {
      const key = pending.shift()!
      inFlight.add(key)
      work(key)
        .then(v => v, () => null)
        .then(v => {
          inFlight.delete(key)
          for (const r of waiting.get(key) || []) r(v as T | null)
          waiting.delete(key)
          pump()
        })
    }
  }
  return {
    run(key: string): Promise<T | null> {
      return new Promise(resolve => {
        const list = waiting.get(key)
        if (list) { list.push(resolve); return }
        waiting.set(key, [resolve])
        pending.push(key)
        pump()
      })
    },
    /** Drop everything not yet started — the user moved to another folder. */
    clear() {
      for (const k of pending) { for (const r of waiting.get(k) || []) r(null); waiting.delete(k) }
      pending.length = 0
    },
  }
}

const metaQueue = queue(4, async token => {
  const m = (await api().meta(token)) || {}
  metaCache.set(token, m)
  return m
})

export async function loadMeta(raw: RawTrack): Promise<TrackMeta> {
  const hit = metaCache.get(raw.token)
  if (hit) return hit
  const m = (await metaQueue.run(raw.token)) || {}
  if (m.durationSec) rememberTrack(raw.path, { d: m.durationSec })
  return m
}

/** Length via a throwaway <audio> reading only the header. */
const durationQueue = queue(3, token => new Promise<number>((resolve, reject) => {
  const a = new Audio()
  a.preload = 'metadata'
  const done = () => { a.removeAttribute('src'); a.load() }
  const timer = window.setTimeout(() => { done(); reject(new Error('timeout')) }, 8000)
  a.onloadedmetadata = () => { window.clearTimeout(timer); const d = a.duration; done(); Number.isFinite(d) ? resolve(d) : reject(new Error('nan')) }
  a.onerror = () => { window.clearTimeout(timer); done(); reject(new Error('decode')) }
  a.src = `aihub-media://${token}/`
}))

export async function probeDuration(raw: RawTrack): Promise<number | null> {
  const c = cachedTrack(raw.path)
  if (c?.d) return c.d
  const d = await durationQueue.run(raw.token)
  if (d) rememberTrack(raw.path, { d })
  return d
}

export function cancelPendingProbes(): void {
  metaQueue.clear()
  durationQueue.clear()
}

// ── User folders ─────────────────────────────────────────────────────────────
const FOLDERS_KEY = 'aihub-dj-folders-v1'

export function savedFolders(): Folder[] {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]')
    return Array.isArray(v) ? v.filter(f => f && typeof f.path === 'string') : []
  } catch { return [] }
}

export function saveFolders(f: Folder[]): void {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(f)) } catch { /* optional */ }
}

// ── YouTube ──────────────────────────────────────────────────────────────────
interface YouTubeVideo { id: string; title: string; channel: string; duration: string; thumbnail: string }

/** "4:21" / "1:02:03" → seconds; undefined when absent (live streams). */
export function parseDuration(s: string | undefined): number | undefined {
  if (!s || !/^\d+(:\d{1,2}){1,2}$/.test(s.trim())) return undefined
  return s.trim().split(':').reduce((acc, part) => acc * 60 + parseInt(part, 10), 0)
}

/** Split "Artist - Title (Official Video)" style upload names. */
export function cleanVideoTitle(title: string, channel: string): { artist: string; title: string } {
  const stripped = title
    .replace(/\s*[([](official|lyrics?|audio|video|visuali[sz]er|hd|4k|music video|explicit)[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const m = /^(.+?)\s+[-–—|]\s+(.+)$/.exec(stripped)
  if (m) return { artist: m[1].trim(), title: m[2].trim() }
  return { artist: channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim(), title: stripped }
}

export function ytTrack(v: YouTubeVideo): DjTrack {
  const { artist, title } = cleanVideoTitle(v.title, v.channel)
  return ytTrackFrom({ id: v.id, title, artist, cover: v.thumbnail, duration: parseDuration(v.duration), name: v.title })
}

/** A playable deck track for a YouTube video, registered so it can be dragged. */
export function ytTrackFrom(v: { id: string; title: string; artist: string; cover?: string; duration?: number; name?: string }): DjTrack {
  const t: DjTrack = {
    token: `yt-${v.id}`,
    path: `https://www.youtube.com/watch?v=${v.id}`,
    name: v.name ?? `${v.artist ? `${v.artist} - ` : ''}${v.title}`,
    size: 0,
    title: v.title,
    artist: v.artist,
    album: 'YouTube',
    cover: v.cover,
    youtubeId: v.id,
    durationHint: v.duration,
  }
  registry.set(t.token, t)
  return t
}

export async function searchYouTube(query: string, limit = 20): Promise<DjTrack[]> {
  const r = await (window as any).electronAPI.dj.youtubeSearch(query, limit)
  if (!r?.ok) {
    if (r?.error === 'no-results') return []
    throw new Error(r?.error === 'empty' ? 'Type something to search' : 'YouTube could not be reached')
  }
  return (r.videos as YouTubeVideo[]).map(ytTrack)
}
