// Renderer side of the library database (src/main/trackDbStore.ts): records
// built from what the console already knows about a track, written in batches,
// and candidate queries turned into the pool the model chooses from.
import { parseKey } from '../engine/key'
import type { Deck, DjTrack } from '../engine/DjEngine'
import { trackId, type TrackFacts } from '../ai/types'
import { djApi, toTrack, loadMeta, trackByToken, ytTrackFrom } from '../libraryData'
import { densityOf, phraseGrid } from './phrase'
import type { CandidateFilter, DbCandidate, Enrichment, PoolEntry, TrackRecord } from './types'

const db = () => (window as any).electronAPI?.dj?.db

let pending = new Map<string, Partial<TrackRecord>>()
let timer: number | null = null
/** What was last written per id, so an unchanged deck is not re-sent every few seconds. */
const sent = new Map<string, string>()

function flush(): void {
  timer = null
  const batch = [...pending.values()]
  pending = new Map()
  if (batch.length) void db()?.upsert(batch).catch(() => {})
}

/** Queue a record (merged with anything else queued for it). */
export function note(r: Partial<TrackRecord> & { id: string; title: string }): void {
  const sig = JSON.stringify(r)
  if (sent.get(r.id) === sig) return
  sent.set(r.id, sig)
  pending.set(r.id, { ...pending.get(r.id), ...r })
  if (timer == null) timer = window.setTimeout(flush, 1500)
}

export function recordFromTrack(t: DjTrack, facts?: TrackFacts | null): Partial<TrackRecord> & { id: string; title: string } {
  const r: Partial<TrackRecord> & { id: string; title: string } = {
    id: trackId(t), title: t.title || t.name, artist: t.artist || '',
    ...(t.album && t.album !== 'YouTube' ? { album: t.album } : {}),
    ...(t.genre || t.genres?.[0] ? { genre: t.genre || t.genres![0] } : {}),
    ...(t.year ? { year: t.year } : {}),
    ...(t.youtubeId ? {} : { token: t.token, path: t.path }),
  }
  const bpm = facts?.bpm ?? t.tagBpm
  if (bpm) r.bpm = bpm
  const cam = facts?.camelot ?? parseKey(t.key)?.camelot
  if (cam) r.camelot = cam
  if (facts?.playable) {
    r.energy = facts.energy
    r.introEndSec = facts.introEndSec
    r.outroStartSec = facts.outroStartSec
    if (facts.durationSec) r.durationSec = facts.durationSec
  } else if (t.durationHint) r.durationSec = t.durationHint
  return r
}

/** What a loaded deck knows: measured tempo and key, length and how dense the master is. */
export function recordFromDeck(d: Deck, facts?: TrackFacts | null): (Partial<TrackRecord> & { id: string; title: string }) | null {
  if (!d.track) return null
  const r = recordFromTrack(d.track, facts)
  if (d.bpm && d.gridKnown) r.bpm = d.bpm
  const k = d.musicalKey
  if (k && (k.confidence >= 0.3 || !r.camelot)) r.camelot = k.camelot
  if (d.duration) r.durationSec = d.duration
  const density = densityOf(d.analysis?.env.amp ?? d.liveEnv)
  if (density != null) r.density = density
  return r
}

export function enrich(id: string, title: string, e: Enrichment): void {
  note({ id, title, enrich: { ...e, at: Date.now() } })
}

export async function query(q: {
  bpm: number; camelot: string | null; year?: number | null; density?: number | null; energy?: number | null
  direction?: number; excludeIds?: string[]; pivots?: boolean; filter?: CandidateFilter | null
}): Promise<PoolEntry[]> {
  if (timer != null) { window.clearTimeout(timer); flush() }
  const rows: DbCandidate[] = (await db()?.query({ ...q, filter: q.filter ?? undefined, limit: 15 }).catch(() => [])) || []
  return rows.map(toEntry)
}

export function toEntry(c: DbCandidate): PoolEntry {
  const r = c.record
  const bpm = r.bpm ?? 120
  return {
    id: r.id, title: r.title, artist: r.artist, genre: r.genre, year: r.year, bpm, camelot: r.camelot,
    energy: r.energy, density: r.density, durationSec: r.durationSec || 240,
    relation: c.relation, pitchPct: Math.round(c.pitch * 1000) / 10,
    phrasesMs: phraseGrid(bpm, r.introEndSec || 0, r.durationSec || 240, 10),
    beatMs: 60000 / bpm,
    record: r,
  }
}

export async function count(): Promise<number> { return (await db()?.count().catch(() => 0)) || 0 }

/** A record → a track the decks can load. File tokens last one run, so a stale one is registered again from its path. */
export async function trackFor(r: TrackRecord): Promise<DjTrack | null> {
  if (r.youtubeId) return ytTrackFrom({ id: r.youtubeId, title: r.title, artist: r.artist })
  const known = r.token ? trackByToken(r.token) : undefined
  if (known && known.path === r.path) return known
  if (!r.path) return null
  const raw = await djApi().registerFile(r.path).catch(() => null)
  if (!raw) return null
  return toTrack(raw, await loadMeta(raw).catch(() => undefined))
}

