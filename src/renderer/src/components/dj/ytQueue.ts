/**
 * The YouTube queue: named playlists of YouTube songs the DJ collects while
 * searching, kept across sessions. "Queue" is the working list and
 * "Favorites" collects hearted songs; the DJ can add more lists.
 *
 * Playing a list hands its songs to Automix one by one, so the set flows from
 * artist to artist without a gap. Only what is needed to find the video again
 * is stored — id, title, artist, thumbnail, length.
 */
import type { DjTrack } from './engine/DjEngine'
import { ytTrackFrom } from './libraryData'

export interface QueueItem { id: string; title: string; artist: string; cover?: string; duration?: number }
export interface Playlist { id: string; name: string; items: QueueItem[]; fixed?: boolean }
export interface QueueState {
  lists: Playlist[]
  activeId: string
  /** The list Automix is playing through, and the next index in it. */
  playing: { listId: string; index: number } | null
  repeat: boolean
}

export const QUEUE_ID = 'queue'
export const FAVORITES_ID = 'favorites'
const KEY = 'aihub-dj-ytqueue-v1'
const MAX_ITEMS = 500
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

function fresh(): QueueState {
  return {
    lists: [
      { id: QUEUE_ID, name: 'Queue', items: [], fixed: true },
      { id: FAVORITES_ID, name: 'Favorites', items: [], fixed: true },
    ],
    activeId: QUEUE_ID,
    playing: null,
    repeat: false,
  }
}

function sanitize(v: any): QueueState {
  const base = fresh()
  if (!v || !Array.isArray(v.lists)) return base
  const lists: Playlist[] = []
  for (const l of v.lists) {
    if (!l || typeof l.id !== 'string' || typeof l.name !== 'string' || !Array.isArray(l.items)) continue
    const items = l.items.filter((i: any) => i && typeof i.id === 'string' && VIDEO_ID.test(i.id) && typeof i.title === 'string')
      .slice(0, MAX_ITEMS).map((i: any) => ({ id: i.id, title: String(i.title), artist: String(i.artist || ''), cover: typeof i.cover === 'string' ? i.cover : undefined, duration: typeof i.duration === 'number' ? i.duration : undefined }))
    lists.push({ id: l.id, name: l.name.slice(0, 60), items, fixed: l.id === QUEUE_ID || l.id === FAVORITES_ID })
  }
  for (const f of base.lists) if (!lists.some(l => l.id === f.id)) lists.unshift(f)
  return {
    lists,
    activeId: lists.some(l => l.id === v.activeId) ? v.activeId : QUEUE_ID,
    playing: null, // a fresh page is not mid-set
    repeat: !!v.repeat,
  }
}

let state: QueueState = (() => {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')) } catch { return fresh() }
})()
const listeners = new Set<() => void>()

function set(next: QueueState): void {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, playing: null })) } catch { /* optional */ }
  for (const l of listeners) l()
}

export const queueStore = {
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } },
  get(): QueueState { return state },
}

export function itemFrom(t: DjTrack): QueueItem | null {
  if (!t.youtubeId) return null
  return { id: t.youtubeId, title: t.title, artist: t.artist, cover: t.cover, duration: t.durationHint }
}

export function trackFrom(i: QueueItem): DjTrack {
  return ytTrackFrom(i)
}

function mapList(listId: string, fn: (items: QueueItem[]) => QueueItem[]): void {
  set({ ...state, lists: state.lists.map(l => (l.id === listId ? { ...l, items: fn(l.items).slice(0, MAX_ITEMS) } : l)) })
}

/** Add YouTube songs to a list (the active one by default); returns how many were new. */
export function addToList(tracks: DjTrack[], listId = state.activeId): number {
  const list = state.lists.find(l => l.id === listId)
  if (!list) return 0
  const have = new Set(list.items.map(i => i.id))
  const add = tracks.map(itemFrom).filter((i): i is QueueItem => !!i && !have.has(i.id) && (have.add(i.id), true))
  if (add.length) mapList(listId, items => [...items, ...add])
  return add.length
}

export function removeAt(listId: string, index: number): void {
  const playing = state.playing
  mapList(listId, items => items.filter((_, i) => i !== index))
  if (playing?.listId === listId && index < playing.index) set({ ...state, playing: { ...playing, index: playing.index - 1 } })
}

export function moveItem(listId: string, from: number, to: number): void {
  mapList(listId, items => {
    const next = [...items]
    const [it] = next.splice(from, 1)
    if (it) next.splice(Math.max(0, Math.min(next.length, to)), 0, it)
    return next
  })
}

export function clearList(listId: string): void {
  mapList(listId, () => [])
  if (state.playing?.listId === listId) set({ ...state, playing: null })
}

/** Shuffle what has not played yet. */
export function shuffleList(listId: string): void {
  const keep = state.playing?.listId === listId ? state.playing.index : 0
  mapList(listId, items => {
    const head = items.slice(0, keep)
    const tail = items.slice(keep)
    for (let i = tail.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[tail[i], tail[j]] = [tail[j], tail[i]]
    }
    return [...head, ...tail]
  })
}

export function isFavorite(videoId: string | undefined): boolean {
  if (!videoId) return false
  return !!state.lists.find(l => l.id === FAVORITES_ID)?.items.some(i => i.id === videoId)
}

/** Heart / un-heart a song; returns true when it is now a favourite. */
export function toggleFavorite(t: DjTrack): boolean {
  if (!t.youtubeId) return false
  if (isFavorite(t.youtubeId)) {
    mapList(FAVORITES_ID, items => items.filter(i => i.id !== t.youtubeId))
    return false
  }
  addToList([t], FAVORITES_ID)
  return true
}

export function createList(name: string): string {
  const id = `pl-${Date.now().toString(36)}`
  set({ ...state, lists: [...state.lists, { id, name: name.trim().slice(0, 60) || 'Playlist', items: [] }], activeId: id })
  return id
}

export function renameList(listId: string, name: string): void {
  const n = name.trim().slice(0, 60)
  if (!n) return
  set({ ...state, lists: state.lists.map(l => (l.id === listId && !l.fixed ? { ...l, name: n } : l)) })
}

export function deleteList(listId: string): void {
  const l = state.lists.find(x => x.id === listId)
  if (!l || l.fixed) return
  set({
    ...state,
    lists: state.lists.filter(x => x.id !== listId),
    activeId: state.activeId === listId ? QUEUE_ID : state.activeId,
    playing: state.playing?.listId === listId ? null : state.playing,
  })
}

export function setActiveList(listId: string): void {
  if (state.lists.some(l => l.id === listId)) set({ ...state, activeId: listId })
}

export function setRepeat(on: boolean): void { set({ ...state, repeat: on }) }

/** Start playing a list from `index`. */
export function startList(listId: string, index = 0): void {
  set({ ...state, playing: { listId, index } })
}
export function stopList(): void { set({ ...state, playing: null }) }

/** What the playing list will give next, without moving on (for "up next" displays). */
export function peekNext(): QueueItem | undefined {
  const p = state.playing
  if (!p) return undefined
  const list = state.lists.find(l => l.id === p.listId)
  if (!list || !list.items.length) return undefined
  if (p.index < list.items.length) return list.items[p.index]
  return state.repeat ? list.items[0] : undefined
}

/** The next song of the list being played, advancing past it. */
export function takeNext(): DjTrack | undefined {
  const p = state.playing
  if (!p) return undefined
  const list = state.lists.find(l => l.id === p.listId)
  if (!list || !list.items.length) { set({ ...state, playing: null }); return undefined }
  let index = p.index
  if (index >= list.items.length) {
    if (!state.repeat) { set({ ...state, playing: null }); return undefined }
    index = 0
  }
  set({ ...state, playing: { listId: p.listId, index: index + 1 } })
  return trackFrom(list.items[index])
}
