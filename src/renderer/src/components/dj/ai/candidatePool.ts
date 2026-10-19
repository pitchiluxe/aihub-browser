// Where songs come from: the listener's favourites and most-loved tracks, and
// YouTube searches seeded by the brief (genre seeds are remembered on each
// track so genre rules can be enforced later).
import type { DjTrack } from '../engine/DjEngine'
import type { TasteProfile } from '../taste'
import type { Candidate } from './setPlanner'

export interface PoolDeps { profile(): TasteProfile; favorites(): DjTrack[]; search(q: string, n: number): Promise<DjTrack[]> }

const norm = (s: string) => s.trim().toLowerCase()

/** A set is built from songs. A 62-minute "Afrobeat Mix" video played as one
 *  track (seen live, 2026-10-12) — no transitions, a nonsense BPM. */
const MAX_SONG_SEC = 10 * 60
const NOT_A_SONG = /\b(mix(tape)?|megamix|non-?stop|playlist|compilation|full album|best of|\d+\s*(hours?|hrs?)\b|hour of|dj set|live set|boiler room|continuous)\b/i

/** Keyword-stuffed filler uploads, not records: "Nakupenda — New Video, Iconic
 *  Models, Deep House Music 2026", "Afro Lofi Background Music" (both played
 *  live in a "Late night" set, 2026-10-15). */
const FILLER = /\b(new video|iconic models|fashion (show|models)|background music|bgm|(study|work|gaming|sleep|relaxing|focus) (music|beats)|(music|beats|songs) 20\d\d)\b/i

/**
 * AI-generated music: the AI DJ plays original recordings by real artists only.
 * Matched on the upload title, the channel and the album line, because AI
 * uploads say so somewhere — "AI cover", "Suno", "[AI]", a channel called
 * "… AI Music". The word alone is not enough ("Ai" is an artist and a word in
 * many languages), so it must sit next to a music word or a known generator.
 */
const AI_MUSIC = [
  /\b(ai|a\.i\.)[\s-]*(generated|cover|covers|song|songs|music|version|remix|voice|vocals?|sings?|sung|singer|artist|track|beat|beats|instrumental|edit|made|records|studio|tunes|radio|afrobeats?|amapiano|hip[\s-]?hop|rap|r&b|gospel|love songs?)\b/i,
  /\b(made|created|generated|produced|composed|sung|performed|written)\s+(with|by|using|in)\s+(an?\s+)?(ai|a\.i\.|artificial intelligence)\b/i,
  /\bartificial intelligence\b/i,
  /\b(suno|udio|riffusion|boomy|mubert|soundraw|aiva|soundful|beatoven)\b/i,
  /[[(]\s*(ai|a\.i\.)\s*[\])]/i,
  /\b(ai|a\.i\.)\s*(×|x|vs\.?)\s/i,
]

export function isAiMusic(t: Pick<DjTrack, 'title' | 'name'> & Partial<Pick<DjTrack, 'artist' | 'album'>>): boolean {
  const text = [t.title, t.name, t.artist, t.album].filter(Boolean).join(' · ')
  return AI_MUSIC.some(re => re.test(text))
}

export function isSong(t: DjTrack): boolean {
  if (t.durationHint && t.durationHint > MAX_SONG_SEC) return false
  const text = `${t.title} ${t.name}`
  return !NOT_A_SONG.test(text) && !FILLER.test(text) && !isAiMusic(t)
}

export async function gatherCandidates(seeds: string[], deps: PoolDeps, opts: { perSeed?: number; favoritesOnly?: boolean; /** Tag every result with this genre (seeds are phrasings of it). */ genre?: string } = {}): Promise<Omit<Candidate, 'facts'>[]> {
  const p = deps.profile()
  const artistScore = new Map(p.topArtists.map(a => [norm(a.artist), a.score]))
  const maxScore = Math.max(1, ...p.topArtists.map(a => a.score))
  const avoid = new Set(p.avoidArtists.map(norm))
  const loved = new Set(p.lovedTracks.map(t => `${norm(t.artist)}|${norm(t.title)}`))
  const out = new Map<string, Omit<Candidate, 'facts'>>()
  const add = (t: DjTrack, genre?: string) => {
    const key = t.youtubeId || t.path
    if (!key || !isSong(t)) return
    const prev = out.get(key)
    if (prev) { if (genre && !prev.genres.includes(genre)) prev.genres.push(genre); return }
    const a = norm(t.artist)
    const known = loved.has(`${a}|${norm(t.title)}`) || artistScore.has(a)
    // The track carries the same genres array, so tempo readings on the deck
    // (and the facts scan) know a genre found later too.
    const genres = genre ? [genre] : []
    out.set(key, { track: { ...t, genres }, known, taste: Math.max(-1, Math.min(1, (artistScore.get(a) ?? 0) / maxScore)), disliked: avoid.has(a), genres })
  }
  for (const t of deps.favorites()) add(t)
  if (!opts.favoritesOnly) {
    const per = opts.perSeed ?? 15
    const lists = await Promise.all(seeds.slice(0, 4).map(s => deps.search(s, per).then(l => ({ s, l })).catch(() => ({ s, l: [] as DjTrack[] }))))
    for (const { s, l } of lists) for (const t of l) add(t, opts.genre ?? norm(s))
  }
  return [...out.values()]
}
