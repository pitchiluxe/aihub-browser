// Where songs come from: the listener's favourites and most-loved tracks, and
// YouTube searches seeded by the brief (genre seeds are remembered on each
// track so genre rules can be enforced later).
import type { DjTrack } from '../engine/DjEngine'
import type { TasteProfile } from '../taste'
import type { Candidate } from './setPlanner'

export interface PoolDeps { profile(): TasteProfile; favorites(): DjTrack[]; search(q: string, n: number): Promise<DjTrack[]> }

const norm = (s: string) => s.trim().toLowerCase()

export async function gatherCandidates(seeds: string[], deps: PoolDeps, opts: { perSeed?: number; favoritesOnly?: boolean } = {}): Promise<Omit<Candidate, 'facts'>[]> {
  const p = deps.profile()
  const artistScore = new Map(p.topArtists.map(a => [norm(a.artist), a.score]))
  const maxScore = Math.max(1, ...p.topArtists.map(a => a.score))
  const avoid = new Set(p.avoidArtists.map(norm))
  const loved = new Set(p.lovedTracks.map(t => `${norm(t.artist)}|${norm(t.title)}`))
  const out = new Map<string, Omit<Candidate, 'facts'>>()
  const add = (t: DjTrack, genre?: string) => {
    const key = t.youtubeId || t.path
    if (!key) return
    const prev = out.get(key)
    if (prev) { if (genre && !prev.genres.includes(genre)) prev.genres.push(genre); return }
    const a = norm(t.artist)
    const known = loved.has(`${a}|${norm(t.title)}`) || artistScore.has(a)
    out.set(key, { track: t, known, taste: Math.max(-1, Math.min(1, (artistScore.get(a) ?? 0) / maxScore)), disliked: avoid.has(a), genres: genre ? [genre] : [] })
  }
  for (const t of deps.favorites()) add(t)
  if (!opts.favoritesOnly) {
    const per = opts.perSeed ?? 15
    const lists = await Promise.all(seeds.slice(0, 4).map(s => deps.search(s, per).then(l => ({ s, l })).catch(() => ({ s, l: [] as DjTrack[] }))))
    for (const { s, l } of lists) for (const t of l) add(t, norm(s))
  }
  return [...out.values()]
}
