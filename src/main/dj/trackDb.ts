// The song suggester's library database: one record per track the DJ has seen
// (local files with their tags, YouTube songs once measured), what was measured
// about it, and what the AI wrote about it. Pure functions — the store
// (trackDbStore.ts) persists, the renderer is the only writer, so every record
// is validated and bounded here.

export interface Cue { label: string; ms: number }
export interface Enrichment {
  /** The model's one-sentence reason for mixing into this track. */
  rationale?: string
  /** 1..10, the model's rating of how hard the track hits. */
  energyRating?: number
  cues?: Cue[]
  loop?: { startMs: number; endMs: number }
  /** What it was suggested after ("Artist – Title"). */
  after?: string
  at: number
}

export interface TrackRecord {
  id: string
  title: string
  artist: string
  album?: string
  genre?: string
  year?: number
  bpm: number | null
  camelot: string | null
  /** 0..1, measured loudness and pace. */
  energy: number | null
  /** 0..1, how loud the average is against the peaks — a hot modern master is near 1. */
  density: number | null
  durationSec: number
  introEndSec: number
  outroStartSec: number
  /** Library token (files: valid this run only) or YouTube id — how the renderer loads it again. */
  token?: string
  path?: string
  youtubeId?: string
  enrich?: Enrichment
  seenAt: number
}

export const DB_CAP = 20000
const ID = /^(yt:[A-Za-z0-9_-]{11}|file:.{1,1024})$/
const CAMELOT = /^(1[0-2]|[1-9])[AB]$/
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined)
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined)

function cleanEnrich(x: unknown, prev?: Enrichment): Enrichment | undefined {
  const e = x as Partial<Enrichment> | undefined
  if (!e || typeof e !== 'object') return prev
  const cues = Array.isArray(e.cues)
    ? e.cues.slice(0, 8).map(c => ({ label: str(c?.label, 24) ?? '', ms: Math.round(num(c?.ms, 0, 6 * 3600_000) ?? -1) })).filter(c => c.ms >= 0)
    : prev?.cues
  const loop = e.loop && num(e.loop.startMs, 0, 6 * 3600_000) !== undefined && num(e.loop.endMs, 0, 6 * 3600_000) !== undefined && e.loop.endMs > e.loop.startMs
    ? { startMs: Math.round(e.loop.startMs), endMs: Math.round(e.loop.endMs) } : prev?.loop
  return {
    rationale: str(e.rationale, 300) ?? prev?.rationale,
    energyRating: num(e.energyRating, 1, 10) ?? prev?.energyRating,
    cues, loop,
    after: str(e.after, 200) ?? prev?.after,
    at: Date.now(),
  }
}

/** A validated record merged over what was stored: a later reading of one field never wipes the others. */
export function mergeRecord(prev: TrackRecord | undefined, x: unknown): TrackRecord | null {
  const r = x as Partial<TrackRecord>
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !ID.test(r.id)) return null
  const pick = <K extends keyof TrackRecord>(k: K, v: TrackRecord[K] | undefined): TrackRecord[K] | undefined => (v !== undefined ? v : prev?.[k])
  const title = str(r.title, 300) || prev?.title
  if (!title) return null
  const bpm = r.bpm === null ? prev?.bpm ?? null : num(r.bpm, 30, 300) ?? prev?.bpm ?? null
  const camelot = typeof r.camelot === 'string' && CAMELOT.test(r.camelot) ? r.camelot : prev?.camelot ?? null
  return {
    id: r.id,
    title,
    artist: str(r.artist, 300) ?? prev?.artist ?? '',
    album: pick('album', str(r.album, 300)),
    genre: pick('genre', str(r.genre, 80)),
    year: pick('year', num(r.year, 1900, 2100)),
    bpm, camelot,
    energy: num(r.energy, 0, 1) ?? prev?.energy ?? null,
    density: num(r.density, 0, 1) ?? prev?.density ?? null,
    durationSec: num(r.durationSec, 1, 6 * 3600) ?? prev?.durationSec ?? 0,
    introEndSec: num(r.introEndSec, 0, 6 * 3600) ?? prev?.introEndSec ?? 0,
    outroStartSec: num(r.outroStartSec, 0, 6 * 3600) ?? prev?.outroStartSec ?? 0,
    token: pick('token', str(r.token, 64)),
    path: pick('path', str(r.path, 1024)),
    youtubeId: r.id.startsWith('yt:') ? r.id.slice(3) : undefined,
    enrich: r.enrich ? cleanEnrich(r.enrich, prev?.enrich) : prev?.enrich,
    seenAt: Date.now(),
  }
}

export function upsertRecords(db: Record<string, TrackRecord>, xs: unknown[], cap = DB_CAP): { db: Record<string, TrackRecord>; changed: number } {
  let changed = 0
  const next = { ...db }
  for (const x of xs.slice(0, 2000)) {
    const id = (x as TrackRecord)?.id
    const r = mergeRecord(typeof id === 'string' ? next[id] : undefined, x)
    if (r) { next[r.id] = r; changed++ }
  }
  if (!changed) return { db, changed }
  const keys = Object.keys(next)
  if (keys.length > cap) {
    keys.sort((a, b) => next[a].seenAt - next[b].seenAt)
    for (const k of keys.slice(0, keys.length - cap)) delete next[k]
  }
  return { db: next, changed }
}

// ── Harmonic rules ───────────────────────────────────────────────────────────

/**
 * How a candidate's key sits against the playing one on the Camelot wheel.
 *  Standard — perfect (same key), adjacent (±1, same mode), relative (A↔B, same number).
 *  Pivots (creative energy shifts):
 *   diagonal-up   8A→9B / 8B→9A   a lift across the wheel
 *   diagonal-down 8A→7B / 8B→7A   a drop across the wheel
 *   boost         +2 same mode     a whole-tone lift
 *   semitone      +7 same mode     the "key change" lift of a final chorus
 *   parallel      8B↔5A           same tonic, major/minor flip (mood turn)
 */
export type KeyRelation = 'perfect' | 'adjacent' | 'relative' | 'diagonal-up' | 'diagonal-down' | 'boost' | 'semitone' | 'parallel'
export const STANDARD: readonly KeyRelation[] = ['perfect', 'adjacent', 'relative']
export const PIVOTS: readonly KeyRelation[] = ['diagonal-up', 'diagonal-down', 'boost', 'semitone', 'parallel']

const wrap = (n: number) => ((n - 1 + 120) % 12) + 1
function parseCamelot(c: string): { n: number; m: 'A' | 'B' } | null {
  const x = /^(1[0-2]|[1-9])([AB])$/.exec(c)
  return x ? { n: Number(x[1]), m: x[2] as 'A' | 'B' } : null
}

/** Every key a track in `from` can mix into, and how. */
export function compatibleKeys(from: string): { camelot: string; relation: KeyRelation }[] {
  const k = parseCamelot(from)
  if (!k) return []
  const flip = k.m === 'A' ? 'B' : 'A'
  return [
    { camelot: `${k.n}${k.m}`, relation: 'perfect' },
    { camelot: `${wrap(k.n + 1)}${k.m}`, relation: 'adjacent' },
    { camelot: `${wrap(k.n - 1)}${k.m}`, relation: 'adjacent' },
    { camelot: `${k.n}${flip}`, relation: 'relative' },
    { camelot: `${wrap(k.n + 1)}${flip}`, relation: 'diagonal-up' },
    { camelot: `${wrap(k.n - 1)}${flip}`, relation: 'diagonal-down' },
    { camelot: `${wrap(k.n + 2)}${k.m}`, relation: 'boost' },
    { camelot: `${wrap(k.n + 7)}${k.m}`, relation: 'semitone' },
    // Same tonic, other mode: C major (8B) ↔ C minor (5A).
    { camelot: k.m === 'B' ? `${wrap(k.n - 3)}A` : `${wrap(k.n + 3)}B`, relation: 'parallel' },
  ]
}

export function keyRelation(from: string | null, to: string | null): KeyRelation | null {
  if (!from || !to) return null
  return compatibleKeys(from).find(k => k.camelot === to)?.relation ?? null
}

// ── Candidate query ──────────────────────────────────────────────────────────

/** Tempo match allowing a half/double-time blend (87 BPM over 174). */
export function tempoRatio(from: number, to: number, tolerance = 0.06): number | null {
  for (const f of [1, 2, 0.5]) {
    const r = (to * f) / from
    if (Math.abs(r - 1) <= tolerance) return r
  }
  return null
}

export interface CandidateFilter {
  genres?: string[]
  bpmMin?: number
  bpmMax?: number
  yearFrom?: number
  yearTo?: number
  camelot?: string[]
  /** Free text matched on title, artist, album and genre. */
  text?: string
}

export interface CandidateQuery {
  bpm: number
  camelot: string | null
  year?: number | null
  density?: number | null
  energy?: number | null
  /** -1 cool down … 0 hold … 1 step up. */
  direction?: number
  excludeIds?: string[]
  /** Allow pivot keys (diagonal, boost, semitone, parallel) as well as the standard ones. */
  pivots?: boolean
  tolerance?: number
  limit?: number
  filter?: CandidateFilter
}

export interface Candidate {
  record: TrackRecord
  relation: KeyRelation | 'unknown'
  /** Signed tempo change needed, e.g. -0.031 = pitch down 3.1 %. */
  pitch: number
  score: number
}

const RELATION_SCORE: Record<KeyRelation | 'unknown', number> = {
  perfect: 1, adjacent: 0.9, relative: 0.85, 'diagonal-up': 0.7, 'diagonal-down': 0.7, boost: 0.6, semitone: 0.55, parallel: 0.5, unknown: 0.3,
}

function passesFilter(r: TrackRecord, f: CandidateFilter | undefined): boolean {
  if (!f) return true
  if (f.bpmMin && (!r.bpm || r.bpm < f.bpmMin)) return false
  if (f.bpmMax && (!r.bpm || r.bpm > f.bpmMax)) return false
  if (f.yearFrom && (!r.year || r.year < f.yearFrom)) return false
  if (f.yearTo && (!r.year || r.year > f.yearTo)) return false
  if (f.camelot?.length && (!r.camelot || !f.camelot.includes(r.camelot))) return false
  if (f.genres?.length) {
    const g = (r.genre || '').toLowerCase()
    if (!g || !f.genres.some(x => g.includes(x.toLowerCase()))) return false
  }
  if (f.text) {
    const hay = `${r.title} ${r.artist} ${r.album ?? ''} ${r.genre ?? ''}`.toLowerCase()
    if (!f.text.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false
  }
  return true
}

/**
 * The pool the model chooses from: tempo within ±6 % (or half/double), a key that
 * mixes harmonically, ranked by key fit, tempo closeness, the energy direction the
 * floor asks for, and era/density closeness so a hot modern master does not bury an
 * older acoustic recording. Returns up to `limit` (15); tracks with an unknown key
 * only fill the pool when fewer than 10 harmonic matches exist.
 */
export function queryCandidates(db: Record<string, TrackRecord>, q: CandidateQuery): Candidate[] {
  const limit = Math.max(1, Math.min(15, q.limit ?? 15))
  const tol = q.tolerance ?? 0.06
  const exclude = new Set(q.excludeIds ?? [])
  const allowed = new Map((q.camelot ? compatibleKeys(q.camelot) : []).filter(k => q.pivots !== false || STANDARD.includes(k.relation)).map(k => [k.camelot, k.relation]))
  const harmonic: Candidate[] = []
  const unknownKey: Candidate[] = []
  for (const r of Object.values(db)) {
    if (exclude.has(r.id) || !r.bpm || !passesFilter(r, q.filter)) continue
    const ratio = tempoRatio(q.bpm, r.bpm, tol)
    if (ratio === null) continue
    const relation: KeyRelation | 'unknown' = q.camelot && r.camelot ? allowed.get(r.camelot) ?? 'unknown' : 'unknown'
    if (relation === 'unknown' && q.camelot && r.camelot) continue // known clash
    const pitch = 1 / ratio - 1
    let score = RELATION_SCORE[relation] * 3 + (1 - Math.abs(pitch) / tol)
    if (q.energy != null && r.energy != null) {
      const want = Math.max(0, Math.min(1, q.energy + (q.direction ?? 0) * 0.15))
      score += 1.5 * (1 - Math.abs(r.energy - want))
    }
    if (q.year && r.year) score -= Math.min(1, Math.abs(q.year - r.year) / 30) * 0.8
    if (q.density != null && r.density != null) score -= Math.abs(q.density - r.density) * 1.2
    const c = { record: r, relation, pitch, score }
    ;(relation === 'unknown' ? unknownKey : harmonic).push(c)
  }
  harmonic.sort((a, b) => b.score - a.score)
  unknownKey.sort((a, b) => b.score - a.score)
  const out = harmonic.slice(0, limit)
  if (out.length < 10) out.push(...unknownKey.slice(0, Math.min(limit, 10) - out.length))
  return out
}
