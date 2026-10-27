// The song suggester's shapes: the library database rows (mirrors
// src/main/dj/trackDb.ts), what is sent to the model, and what comes back.
import type { DeckId } from '../engine/DjEngine'
import type { FxType } from '../engine/effects'

export type KeyRelation = 'perfect' | 'adjacent' | 'relative' | 'diagonal-up' | 'diagonal-down' | 'boost' | 'semitone' | 'parallel'

export interface CuePoint { label: string; ms: number }
export interface LoopRegion { startMs: number; endMs: number }

export interface Enrichment { rationale?: string; energyRating?: number; cues?: CuePoint[]; loop?: LoopRegion; after?: string; at?: number }

export interface TrackRecord {
  id: string
  title: string
  artist: string
  album?: string
  genre?: string
  year?: number
  bpm: number | null
  camelot: string | null
  energy: number | null
  density: number | null
  durationSec: number
  introEndSec: number
  outroStartSec: number
  token?: string
  path?: string
  youtubeId?: string
  enrich?: Enrichment
  seenAt?: number
}

export interface CandidateFilter {
  genres?: string[]
  bpmMin?: number
  bpmMax?: number
  yearFrom?: number
  yearTo?: number
  camelot?: string[]
  text?: string
}

export interface DbCandidate { record: TrackRecord; relation: KeyRelation | 'unknown'; pitch: number; score: number }

/** The track on air, as the suggester reads it from the deck. */
export interface NowTrack {
  id: string
  deck: DeckId
  title: string
  artist: string
  genre?: string
  year?: number
  bpm: number
  camelot: string | null
  energy: number | null
  density: number | null
  durationSec: number
  positionSec: number
  /** Downbeat the deck's beat grid starts from. */
  firstBeat: number
  /** Where the song strips back — FX macros are timed from here. */
  breakdownSec: number
  outroStartSec: number
}

/** One track in the pool, with the phrase starts its cues must land on. */
export interface PoolEntry {
  id: string
  title: string
  artist: string
  genre?: string
  year?: number
  bpm: number
  camelot: string | null
  energy: number | null
  density: number | null
  durationSec: number
  relation: KeyRelation | 'unknown'
  /** Tempo change to match the playing track, percent. */
  pitchPct: number
  /** Phrase starts (16 beats), milliseconds. */
  phrasesMs: number[]
  beatMs: number
  record: TrackRecord
}

export type Direction = 'step_up' | 'hold' | 'cool_down'
export type FxName = Extract<FxType, 'filter' | 'echo' | 'reverb' | 'flanger' | 'phaser'>

/** One timed move of an FX macro, in beats from the playing track's breakdown. */
export interface FxStep { atBeat: number; fx: FxName; action: 'on' | 'off' | 'sweep'; value: number; beats: number }

export interface StemPlan { isolate: 'instrumental' | 'acapella' | 'none'; deck: 'incoming' | 'outgoing' }

export interface Pick {
  entry: PoolEntry
  rationale: string
  energyRating: number
  /** Three hot cues, exact milliseconds on the pick's phrase grid. */
  cues: CuePoint[]
  loop: LoopRegion | null
  mixInMs: number
  /** Trim for era/density balance, dB. */
  gainTrimDb: number
  stems: StemPlan
}

export interface Mashup { entries: [PoolEntry, PoolEntry]; rationale: string }

export interface Suggestion {
  forId: string
  picks: Pick[]
  mashup: Mashup | null
  fx: FxStep[]
  direction: Direction
  provider: string
  model?: string
  at: number
}
