// What the local model is sent: the playing track, the floor, the filter and the
// candidate pool as one JSON payload, and a JSON schema its answer is decoded
// against (Ollama structured outputs) — ids are an enum of the pool, so it can
// only pick songs the library holds.
import type { CandidateFilter, Direction, NowTrack, PoolEntry } from './types'

const FX_NAMES = ['filter', 'echo', 'reverb', 'flanger', 'phaser']

export function suggestionSchema(poolIds: string[]): object {
  const id = { type: 'string', enum: poolIds }
  const ms = { type: 'integer', minimum: 0 }
  return {
    type: 'object',
    required: ['picks', 'mashup', 'fx'],
    properties: {
      picks: {
        type: 'array', minItems: 3, maxItems: 3,
        items: {
          type: 'object',
          required: ['id', 'rationale', 'energy_rating', 'cues', 'loop', 'mix_in_ms', 'gain_trim_db', 'stems'],
          properties: {
            id,
            rationale: { type: 'string' },
            energy_rating: { type: 'integer', minimum: 1, maximum: 10 },
            cues: {
              type: 'array', minItems: 3, maxItems: 3,
              items: { type: 'object', required: ['label', 'ms'], properties: { label: { type: 'string' }, ms } },
            },
            loop: { type: 'object', required: ['start_ms', 'end_ms'], properties: { start_ms: ms, end_ms: ms } },
            mix_in_ms: ms,
            gain_trim_db: { type: 'number', minimum: -6, maximum: 3 },
            stems: {
              type: 'object', required: ['isolate', 'deck'],
              properties: { isolate: { type: 'string', enum: ['instrumental', 'acapella', 'none'] }, deck: { type: 'string', enum: ['incoming', 'outgoing'] } },
            },
          },
        },
      },
      mashup: {
        type: 'object', required: ['ids', 'rationale'],
        properties: { ids: { type: 'array', minItems: 2, maxItems: 2, items: id }, rationale: { type: 'string' } },
      },
      fx: {
        type: 'array', maxItems: 6,
        items: {
          type: 'object', required: ['at_beat', 'fx', 'action', 'value', 'beats'],
          properties: {
            at_beat: { type: 'number', minimum: -64, maximum: 64 },
            fx: { type: 'string', enum: FX_NAMES },
            action: { type: 'string', enum: ['on', 'off', 'sweep'] },
            value: { type: 'number', minimum: 0, maximum: 1 },
            beats: { type: 'number', minimum: 0, maximum: 64 },
          },
        },
      },
    },
  }
}

const SYSTEM = [
  'You are the track-selection engine inside a DJ application. Output only the JSON object the schema describes.',
  'Choose exactly 3 picks from "candidates", best first. Never invent ids.',
  'rationale: one sentence, at most 25 words, naming the concrete reason (key relation, tempo, energy, era).',
  'energy_rating: 1-10, how hard the pick hits on a dance floor.',
  'Floor direction "step_up": prefer higher energy and the lifting key relations diagonal-up, boost, semitone. "cool_down": prefer lower energy and diagonal-down, parallel, adjacent. "hold": prefer perfect, adjacent, relative at similar energy.',
  'cues: 3 hot cues for the pick, each ms value copied from that candidate\'s phrases_ms: cue 1 "Mix in" (first phrase after the intro), cue 2 "Drop" (the phrase where the full beat enters), cue 3 "Vocal/Hook" or "Outro".',
  'mix_in_ms: the phrase start to begin the blend on (from phrases_ms). loop: an 8 or 16 beat region starting on a phrase in phrases_ms (end_ms = start_ms + 8 or 16 x beat_ms).',
  'Era and density balance: when the pick is more than 15 years apart from now_playing or its density differs by more than 0.25, prefer closer picks; gain_trim_db negative (-1 to -4) for a denser, louder modern master following an older acoustic one, positive (up to +2) for the reverse, else 0.',
  'stems: "instrumental" on the incoming track when both tracks carry lead vocals at the mix point; "acapella" on the incoming only for a vocal-over-beat blend; "none" when the vocals do not overlap. deck says which track the isolation applies to.',
  'mashup: two different candidates that can both play over now_playing at once (each compatible with now_playing and with each other; one ideally vocal-led, one rhythmic).',
  'fx: up to 6 steps forming one macro on now_playing, timed in beats from its breakdown (negative = before it): e.g. a filter sweep (value < 0.5 low-pass, > 0.5 high-pass, 0.5 open) into an echo-out, reverb tail on the last beat. Steps must be in time order.',
].join('\n')

export interface SuggestPayload {
  now: NowTrack
  floor: { energy: number; direction: Direction }
  filter: CandidateFilter | null
  pool: PoolEntry[]
}

const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100)

export function buildMessages(p: SuggestPayload): { role: string; content: string }[] {
  const beatMs = 60000 / p.now.bpm
  const payload = {
    now_playing: {
      title: p.now.title, artist: p.now.artist, genre: p.now.genre ?? null, year: p.now.year ?? null,
      bpm: r2(p.now.bpm), key: p.now.camelot, energy: r2(p.now.energy), density: r2(p.now.density),
      duration_ms: Math.round(p.now.durationSec * 1000), position_ms: Math.round(p.now.positionSec * 1000),
      breakdown_ms: Math.round(p.now.breakdownSec * 1000), beat_ms: Math.round(beatMs),
    },
    floor: { energy: r2(p.floor.energy), direction: p.floor.direction },
    filter: p.filter,
    candidates: p.pool.map(c => ({
      id: c.id, title: c.title, artist: c.artist, genre: c.genre ?? null, year: c.year ?? null,
      bpm: r2(c.bpm), key: c.camelot, key_relation: c.relation, pitch_pct: r2(c.pitchPct),
      energy: r2(c.energy), density: r2(c.density), duration_ms: Math.round(c.durationSec * 1000),
      beat_ms: Math.round(c.beatMs), phrases_ms: c.phrasesMs,
    })),
  }
  // Unknown values are left out, not sent as null: a small model repeats "energy: null" back otherwise.
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(payload, (_k, v) => (v === null ? undefined : v)) }]
}

/** Voice command → library filter. */
export const FILTER_SCHEMA = {
  type: 'object',
  required: ['clear', 'genres', 'bpm_min', 'bpm_max', 'year_from', 'year_to', 'keys', 'text', 'energy'],
  properties: {
    clear: { type: 'boolean' },
    genres: { type: 'array', items: { type: 'string' } },
    bpm_min: { type: 'number' }, bpm_max: { type: 'number' },
    year_from: { type: 'integer' }, year_to: { type: 'integer' },
    keys: { type: 'array', items: { type: 'string' } },
    text: { type: 'string' },
    energy: { type: 'string', enum: ['step_up', 'hold', 'cool_down', 'unchanged'] },
  },
}

export function filterMessages(transcript: string, now: { bpm: number; camelot: string | null } | null): { role: string; content: string }[] {
  return [
    {
      role: 'system',
      content: [
        'Turn a DJ\'s spoken command into a filter over their track collection. Output only the JSON object.',
        'clear: true when they ask to reset or remove filters. genres: lower-case genre words mentioned. bpm_min/bpm_max: 0 when not said ("faster" = current bpm to +6%, "slower" = -6% to current).',
        'year_from/year_to: 0 when not said ("90s" = 1990..1999, "old school" = 0..2005, "new" = current year -3..current year). keys: Camelot codes like "8A" only if said.',
        'text: an artist or title word they named, else "". energy: step_up / cool_down when they ask for more or less energy, else "unchanged".',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({ command: transcript, now_playing: now, current_year: new Date().getFullYear() }) },
  ]
}
