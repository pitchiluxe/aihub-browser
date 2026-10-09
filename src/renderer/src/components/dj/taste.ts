/**
 * What the DJ likes — learnt from what they actually do on the console.
 *
 * Every song that plays leaves a listening record: how long it was heard and
 * how it ended (played out, skipped early, or just sampled). Likes, dislikes,
 * favourites, queue adds and YouTube searches are recorded too. The profile
 * built from them weighs recent behaviour more than old (30-day half-life),
 * so the AI DJ follows the DJ's taste as it changes.
 *
 * Everything stays on this computer, in this profile. A private window's
 * storage is in-memory only, so nothing it plays is learnt.
 */
import { IS_INCOGNITO } from '../../services/incognitoMode'

export type TasteKind = 'play' | 'like' | 'dislike' | 'favorite' | 'queue' | 'search'
export type PlayOutcome = 'complete' | 'skip' | 'sample'

export interface TasteEvent {
  kind: TasteKind
  at: number
  artist?: string
  title?: string
  youtubeId?: string
  /** play: seconds heard and how it ended; search: the query. */
  listened?: number
  duration?: number
  outcome?: PlayOutcome
  query?: string
  /** play: started by Automix / the AI DJ rather than by hand. */
  auto?: boolean
}

export interface TasteProfile {
  topArtists: { artist: string; score: number }[]
  avoidArtists: string[]
  lovedTracks: { artist: string; title: string; score: number }[]
  recentSearches: string[]
  /** Artists most played at this time of day. */
  nowArtists: string[]
  stats: { minutes: number; plays: number; completes: number; skips: number }
}

const KEY = 'aihub-dj-taste-v1'
const PREFS_KEY = 'aihub-dj-taste-prefs'
const MAX_EVENTS = 3000
const HALF_LIFE_DAYS = 30

/** How much one event says about liking an artist / a song. */
const WEIGHTS: Record<string, number> = {
  complete: 3, sample: 0.6, skip: -2, like: 5, dislike: -6, favorite: 4, queue: 1,
}

const norm = (s: string | undefined) => (s || '').trim().toLowerCase()

export function eventWeight(e: TasteEvent): number {
  if (e.kind === 'play') {
    const w = WEIGHTS[e.outcome || 'sample']
    // The AI's own picks count a little less until the DJ shows an opinion.
    return e.auto && e.outcome !== 'skip' ? w * 0.7 : w
  }
  if (e.kind === 'search') return 0
  return WEIGHTS[e.kind] ?? 0
}

export function decay(at: number, now: number): number {
  const days = Math.max(0, now - at) / 86_400_000
  return Math.pow(0.5, days / HALF_LIFE_DAYS)
}

/**
 * How a listen ended. A song heard to (near) the end counts as played out; one
 * dropped within its first third after a few seconds is a skip; anything else
 * — a short sample, an early stop while browsing — says little either way.
 */
export function classifyListen(listened: number, duration: number, endedNaturally: boolean): PlayOutcome {
  if (endedNaturally) return 'complete'
  if (duration > 0) {
    const f = listened / duration
    if (f >= 0.7 || duration - listened < 30) return 'complete'
    if (listened >= 5 && f < 0.35) return 'skip'
  }
  return 'sample'
}

export function dayPart(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

export function buildProfile(events: TasteEvent[], now = Date.now()): TasteProfile {
  const artists = new Map<string, { name: string; score: number }>()
  const tracks = new Map<string, { artist: string; title: string; score: number }>()
  const nowPart = dayPart(new Date(now).getHours())
  const partPlays = new Map<string, { name: string; n: number }>()
  const searches: string[] = []
  const stats = { minutes: 0, plays: 0, completes: 0, skips: 0 }

  for (const e of events) {
    if (e.kind === 'search') {
      const q = (e.query || '').trim()
      if (q) searches.push(q)
      continue
    }
    const w = eventWeight(e) * decay(e.at, now)
    const a = norm(e.artist)
    if (a) {
      const cur = artists.get(a) ?? { name: e.artist!.trim(), score: 0 }
      cur.score += w
      artists.set(a, cur)
    }
    const t = norm(e.title)
    if (t) {
      const k = `${a}|${t}`
      const cur = tracks.get(k) ?? { artist: (e.artist || '').trim(), title: e.title!.trim(), score: 0 }
      cur.score += w
      tracks.set(k, cur)
    }
    if (e.kind === 'play') {
      stats.plays++
      stats.minutes += (e.listened || 0) / 60
      if (e.outcome === 'complete') stats.completes++
      if (e.outcome === 'skip') stats.skips++
      if (a && e.outcome !== 'skip' && dayPart(new Date(e.at).getHours()) === nowPart) {
        const cur = partPlays.get(a) ?? { name: e.artist!.trim(), n: 0 }
        cur.n++
        partPlays.set(a, cur)
      }
    }
  }

  const seen = new Set<string>()
  const recentSearches: string[] = []
  for (let i = searches.length - 1; i >= 0 && recentSearches.length < 10; i--) {
    const k = searches[i].toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    recentSearches.push(searches[i])
  }

  const byScore = [...artists.values()].sort((x, y) => y.score - x.score)
  return {
    topArtists: byScore.filter(x => x.score > 0.5).slice(0, 15).map(x => ({ artist: x.name, score: Math.round(x.score * 10) / 10 })),
    avoidArtists: byScore.filter(x => x.score <= -3).map(x => x.name).slice(0, 15),
    lovedTracks: [...tracks.values()].filter(x => x.score >= 3).sort((x, y) => y.score - x.score).slice(0, 15)
      .map(x => ({ ...x, score: Math.round(x.score * 10) / 10 })),
    recentSearches,
    nowArtists: [...partPlays.values()].sort((x, y) => y.n - x.n).slice(0, 6).map(x => x.name),
    stats: { ...stats, minutes: Math.round(stats.minutes) },
  }
}

/** The part of the AI DJ's brief that describes the listener. Empty when nothing is known yet. */
export function describeTaste(p: TasteProfile, now = new Date()): string {
  const lines: string[] = []
  if (p.topArtists.length) lines.push(`Artists they love most: ${p.topArtists.slice(0, 12).map(a => a.artist).join(', ')}.`)
  if (p.lovedTracks.length) lines.push(`Songs they play to the end or like: ${p.lovedTracks.slice(0, 10).map(t => `${t.artist} - ${t.title}`).join('; ')}.`)
  if (p.nowArtists.length) lines.push(`In the ${dayPart(now.getHours())} they usually play: ${p.nowArtists.join(', ')}.`)
  if (p.recentSearches.length) lines.push(`They recently searched for: ${p.recentSearches.slice(0, 6).join('; ')}.`)
  if (p.avoidArtists.length) lines.push(`They skip or dislike: ${p.avoidArtists.join(', ')} — do not pick these.`)
  return lines.join('\n')
}

// ── Storage ──────────────────────────────────────────────────────────────────
type Listener = () => void
const listeners = new Set<Listener>()
let events: TasteEvent[] | null = null
let version = 0
let saveTimer = 0

function load(): TasteEvent[] {
  if (events) return events
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    events = Array.isArray(v) ? v.filter(e => e && typeof e.kind === 'string' && typeof e.at === 'number') : []
  } catch { events = [] }
  return events!
}

function changed(): void {
  version++
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(load())) } catch { /* quota — learning is optional */ }
  }, 600)
  for (const l of listeners) l()
}

export function learningEnabled(): boolean {
  if (IS_INCOGNITO) return false
  try { return localStorage.getItem(PREFS_KEY) !== 'off' } catch { return true }
}

export function setLearning(on: boolean): void {
  try { localStorage.setItem(PREFS_KEY, on ? 'on' : 'off') } catch { /* optional */ }
  version++
  for (const l of listeners) l()
}

export function recordTaste(e: Omit<TasteEvent, 'at'>): void {
  if (!learningEnabled()) return
  const list = load()
  list.push({ ...e, at: Date.now() })
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS)
  changed()
}

export function tasteEvents(): readonly TasteEvent[] { return load() }

export function clearTaste(): void {
  events = []
  changed()
}

export function subscribeTaste(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
export function tasteVersion(): number { return version }

let cached: { v: number; p: TasteProfile } | null = null
export function currentProfile(): TasteProfile {
  if (!cached || cached.v !== version) cached = { v: version, p: buildProfile(load()) }
  return cached.p
}
