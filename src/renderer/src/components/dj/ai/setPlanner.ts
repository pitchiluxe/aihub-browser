// Picks the next song. Pure and deterministic: every number it uses was
// measured or comes from the listener's own history, and every part of the
// score is returned so the stage can say WHY a song was chosen.
import type { DjTrack } from '../engine/DjEngine'
import { trackId, type TrackFacts } from './types'
import type { SetRule } from './instructions'

export interface Candidate { track: DjTrack; facts: TrackFacts | null; known: boolean; taste: number; disliked: boolean; genres: string[] }
export interface PlanContext {
  current: { bpm: number | null; camelot: string | null } | null
  targetEnergy: number
  discoveryShare: number
  played: { id: string; artist: string; atMin: number; known: boolean; title?: string }[]
  nowMin: number
  rules: SetRule[]
  nowMs: number
}
export interface Scored {
  candidate: Candidate
  total: number
  parts: { tempo: number; key: number; energy: number; taste: number; discovery: number }
  why: string
  transition: 'beatmatch' | 'echo' | 'filter'
}

const W = { tempo: 0.3, key: 0.2, energy: 0.2, taste: 0.2, discovery: 0.1 }
const ARTIST_GAP_MIN = 45
const norm = (s: string) => s.trim().toLowerCase()

/** One song across its uploads: 'B4 B4 (Official Video)' and '(Official Audio)' are the same song. */
export function songKey(artist: string, title: string): string {
  const t = norm(title).replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\b(official|music|video|audio|lyrics?|visuali[sz]er|hd|4k|remaster(ed)?)\b/g, ' ').replace(/\s(ft|feat)\.?\s.*$/, '').replace(/[^a-z0-9]+/g, ' ').trim()
  return `${norm(artist).split(/,|&| x | ft\.? | feat\.? /)[0].trim()}|${t}`
}

export function tempoFit(cur: number | null, bpm: number | null): number {
  if (!cur || !bpm) return 0.5
  const ratios = [bpm / cur, (bpm * 2) / cur, bpm / (cur * 2)]
  const off = Math.min(...ratios.map(r => Math.abs(1 - r)))
  if (off <= 0.03) return 1
  if (off >= 0.08) return 0
  return 1 - (off - 0.03) / 0.05
}

export function keyFit(a: string | null, b: string | null): number {
  if (!a || !b) return 0.5
  const na = Number(a.slice(0, -1)), nb = Number(b.slice(0, -1))
  const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12)
  const same = a.slice(-1) === b.slice(-1)
  if ((same && d <= 1) || (!same && d === 0)) return 1
  if (same && d === 2) return 0.5
  return 0.2
}

const active = (r: SetRule, nowMs: number) => !('untilMs' in r && r.untilMs !== undefined && nowMs > r.untilMs)
const EXPLICIT = /\b(explicit|uncensored|dirty)\b/i

export function allowedByRules(c: Candidate, rules: SetRule[], nowMs: number): boolean {
  const artist = norm(c.track.artist)
  const energy = c.facts?.energy ?? 0.5
  for (const r of rules) {
    if (!active(r, nowMs)) continue
    switch (r.kind) {
      case 'banArtist': if (artist.includes(norm(r.artist)) || norm(c.track.title).includes(norm(r.artist))) return false; break
      case 'onlyGenres': if (!c.genres.some(g => r.genres.includes(g))) return false; break
      case 'tempoRange': {
        const bpm = c.facts?.bpm
        if (bpm && ((r.min && bpm < r.min) || (r.max && bpm > r.max))) return false
        break
      }
      case 'minEnergy': if (c.facts && energy < r.level) return false; break
      case 'maxEnergy': if (c.facts && energy > r.level) return false; break
      case 'noExplicit': if (EXPLICIT.test(c.track.title) || EXPLICIT.test(c.track.name)) return false; break
      default: break
    }
  }
  return true
}

function genreBias(c: Candidate, rules: SetRule[]): number {
  let b = 0
  for (const r of rules) {
    if (r.kind === 'moreGenre' && c.genres.includes(r.genre)) b += 0.25
    if (r.kind === 'lessGenre' && c.genres.includes(r.genre)) b -= 0.4
  }
  return b
}

export function rankCandidates(cands: Candidate[], ctx: PlanContext): Scored[] {
  const playedIds = new Set(ctx.played.map(p => p.id))
  const playedSongs = new Set(ctx.played.filter(p => p.title).map(p => songKey(p.artist, p.title!)))
  const recentArtists = new Set(ctx.played.filter(p => ctx.nowMin - p.atMin < ARTIST_GAP_MIN).map(p => norm(p.artist)))
  const newSoFar = ctx.played.filter(p => !p.known).length
  const wantNew = ctx.played.length ? newSoFar / ctx.played.length < ctx.discoveryShare : ctx.discoveryShare >= 0.5

  const out: Scored[] = []
  for (const c of cands) {
    if (c.disliked || c.facts?.playable === false) continue
    if (playedIds.has(trackId(c.track)) || playedSongs.has(songKey(c.track.artist, c.track.title))) continue
    if (recentArtists.has(norm(c.track.artist))) continue
    if (!allowedByRules(c, ctx.rules, ctx.nowMs)) continue

    const tempo = tempoFit(ctx.current?.bpm ?? null, c.facts?.bpm ?? null)
    const key = keyFit(ctx.current?.camelot ?? null, c.facts?.camelot ?? null)
    const energy = c.facts ? 1 - Math.min(1, Math.abs(c.facts.energy - ctx.targetEnergy) / 0.5) : 0.5
    const taste = (c.taste + 1) / 2
    const discovery = wantNew ? (c.known ? 0 : 1) : (c.known ? 1 : 0.3)
    const total = W.tempo * tempo + W.key * key + W.energy * energy + W.taste * taste + W.discovery * discovery + genreBias(c, ctx.rules)

    const reasons: string[] = []
    if (!c.known) reasons.push('new to you')
    else if (c.taste > 0.4) reasons.push('one of your favourites')
    if (tempo >= 0.9 && key >= 1) reasons.push('same key family, smooth mix')
    else if (tempo >= 0.9) reasons.push('matching tempo')
    else if (key >= 1) reasons.push('compatible key')
    if (c.facts && energy >= 0.8) reasons.push(c.facts.energy > (ctx.current ? ctx.targetEnergy - 0.05 : 0) ? 'keeps the energy where you want it' : 'brings the energy down')

    const bpmKnown = !!c.facts?.bpm && (c.facts?.bpmConfidence ?? 0) >= 0.7 && !!ctx.current?.bpm
    const transition: Scored['transition'] = !bpmKnown ? 'echo' : tempo > 0 ? 'beatmatch' : 'filter'
    out.push({ candidate: c, total, parts: { tempo, key, energy, taste, discovery }, why: reasons.join(' · ') || 'fits the vibe', transition })
  }
  return out.sort((a, b) => b.total - a.total)
}
