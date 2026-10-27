// The model's answer, checked against the pool before anything reaches the
// console: ids must be candidates, cues and loops land exactly on the pick's
// phrase grid, numbers are clamped, and whatever is missing is filled from the
// library ranking so the menu always shows three picks.
import { compatible } from './rank'
import { snapMs } from './phrase'
import type { CuePoint, Direction, FxName, FxStep, Mashup, Pick, PoolEntry, StemPlan } from './types'

const FX: FxName[] = ['filter', 'echo', 'reverb', 'flanger', 'phaser']
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

/** JSON out of a reply that may arrive fenced or with stray text around it. */
export function extractJson(text: string): any {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try { return JSON.parse(t) } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { /* invalid */ } }
  return null
}

const PREAMBLE = /^(?:(?:sure|okay|ok|certainly|great)[!,.]*|here(?:'s| is)[^:]*:|i (?:would |'d )?(?:suggest|recommend)[^,:]*[,:])\s*/i

/** One sentence, no preamble. */
export function oneSentence(s: unknown, max = 200): string {
  let t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''
  for (let i = 0; i < 3 && PREAMBLE.test(t); i++) t = t.replace(PREAMBLE, '')
  // Field names from the payload read as jargon in the menu.
  t = t.replace(/\bnow_playing\b/g, 'the playing track').replace(/\b(key_relation|pitch_pct|phrases_ms|beat_ms)\b/g, m => m.split('_')[0])
  const end = /[.!?](\s|$)/.exec(t)
  if (end) t = t.slice(0, end.index + 1)
  if (t.length > max) t = `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
  else if (t && !/[.!?…]$/.test(t)) t += '.'
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}

/** Phrase-based cues without the model: mix-in after the intro, the drop a phrase later, the outro. */
export function defaultCues(e: PoolEntry): { cues: CuePoint[]; loop: { startMs: number; endMs: number } | null; mixInMs: number } {
  const g = e.phrasesMs
  const intro = snapMs((e.record.introEndSec || 0) * 1000, g)
  const i = Math.max(0, g.indexOf(intro))
  const drop = g[Math.min(g.length - 1, i + 1)] ?? intro
  const outro = snapMs((e.record.outroStartSec || e.durationSec * 0.85) * 1000, g)
  const loopStart = intro
  return {
    cues: [{ label: 'Mix in', ms: intro }, { label: 'Drop', ms: drop }, { label: 'Outro', ms: outro }],
    loop: g.length ? { startMs: loopStart, endMs: Math.round(loopStart + 16 * e.beatMs) } : null,
    mixInMs: intro,
  }
}

function fallbackRationale(e: PoolEntry): string {
  const rel = e.relation === 'unknown' ? 'Unverified key' : `${e.relation.charAt(0).toUpperCase()}${e.relation.slice(1).replace('-', ' ')} key move`
  const pitch = Math.abs(e.pitchPct) < 0.05 ? 'no tempo change' : `${e.pitchPct > 0 ? '+' : ''}${e.pitchPct.toFixed(1)}% tempo`
  return `${rel} to ${e.camelot ?? '?'} with ${pitch}.`
}

function rationaleOr(raw: unknown, fallback: string): string {
  const r = oneSentence(raw)
  return r.split(/\s+/).length >= 5 ? r : fallback
}

function fallbackPick(e: PoolEntry): Pick {
  const d = defaultCues(e)
  return {
    entry: e, rationale: fallbackRationale(e),
    energyRating: e.energy != null ? Math.max(1, Math.min(10, Math.round(e.energy * 10))) : 5,
    ...d, gainTrimDb: 0, stems: { isolate: 'none', deck: 'incoming' },
  }
}

function parseCues(raw: unknown, e: PoolEntry): CuePoint[] | null {
  if (!Array.isArray(raw)) return null
  const cues = raw.slice(0, 3).map((c, i) => ({
    label: typeof c?.label === 'string' && c.label.trim() ? c.label.trim().slice(0, 16) : ['Mix in', 'Drop', 'Outro'][i],
    ms: snapMs(clamp(c?.ms, 0, e.durationSec * 1000, 0), e.phrasesMs),
  }))
  return cues.length === 3 ? cues : null
}

function parsePick(raw: any, e: PoolEntry): Pick {
  const d = defaultCues(e)
  const cues = parseCues(raw?.cues, e) ?? d.cues
  let loop = d.loop
  if (raw?.loop && e.phrasesMs.length) {
    const start = snapMs(clamp(raw.loop.start_ms, 0, e.durationSec * 1000, d.mixInMs), e.phrasesMs)
    // 8 or 16 beats, whichever the model's length is nearer.
    const beats = (clamp(raw.loop.end_ms, 0, 1e9, 0) - start) / e.beatMs <= 12 ? 8 : 16
    loop = { startMs: start, endMs: Math.round(start + beats * e.beatMs) }
  }
  const stems: StemPlan = {
    isolate: ['instrumental', 'acapella', 'none'].includes(raw?.stems?.isolate) ? raw.stems.isolate : 'none',
    deck: raw?.stems?.deck === 'outgoing' ? 'outgoing' : 'incoming',
  }
  return {
    entry: e,
    // A stub like "Energy, era." says nothing: the measured facts say more.
    rationale: rationaleOr(raw?.rationale, fallbackRationale(e)),
    energyRating: Math.round(clamp(raw?.energy_rating, 1, 10, 5)),
    cues, loop,
    mixInMs: raw?.mix_in_ms != null ? snapMs(clamp(raw.mix_in_ms, 0, e.durationSec * 1000, d.mixInMs), e.phrasesMs) : d.mixInMs,
    gainTrimDb: Math.round(clamp(raw?.gain_trim_db, -6, 3, 0) * 10) / 10,
    stems,
  }
}

export function parseFx(raw: unknown): FxStep[] {
  if (!Array.isArray(raw)) return []
  const steps = raw.slice(0, 6).map(s => ({
    atBeat: Math.round(clamp(s?.at_beat, -64, 64, 0) * 4) / 4,
    fx: FX.includes(s?.fx) ? s.fx as FxName : 'filter',
    action: (['on', 'off', 'sweep'].includes(s?.action) ? s.action : 'on') as FxStep['action'],
    value: clamp(s?.value, 0, 1, 0.5),
    beats: clamp(s?.beats, 0, 64, 0),
  })).sort((a, b) => a.atBeat - b.atBeat)
  // The same move twice is noise; a "macro" with every step on one beat is no macro (small models do both).
  const seen = new Set<string>()
  const out = steps.filter(s => { const k = `${s.atBeat}|${s.fx}|${s.action}`; return !seen.has(k) && !!seen.add(k) })
  return new Set(out.map(s => s.atBeat)).size < 2 ? [] : out
}

/** A filter-down into an echo-out over the breakdown: the macro when the model gives none. */
export function defaultFx(direction: Direction): FxStep[] {
  return direction === 'step_up'
    ? [{ atBeat: -16, fx: 'filter', action: 'sweep', value: 0.8, beats: 16 }, { atBeat: 0, fx: 'filter', action: 'sweep', value: 0.5, beats: 0 }, { atBeat: 0, fx: 'reverb', action: 'on', value: 0.5, beats: 0 }, { atBeat: 4, fx: 'reverb', action: 'off', value: 0, beats: 0 }]
    : [{ atBeat: -16, fx: 'filter', action: 'sweep', value: 0.2, beats: 16 }, { atBeat: -4, fx: 'echo', action: 'on', value: 0.6, beats: 0 }, { atBeat: 4, fx: 'echo', action: 'off', value: 0, beats: 0 }, { atBeat: 4, fx: 'filter', action: 'sweep', value: 0.5, beats: 4 }]
}

/** The best pair to layer over the playing track: both compatible with it and with each other. */
export function bestMashup(pool: PoolEntry[], skip: ReadonlySet<string> = new Set()): Mashup | null {
  let best: { a: PoolEntry; b: PoolEntry; s: number } | null = null
  const list = pool.filter(p => p.relation !== 'unknown')
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j]
    if (!compatible(a.camelot, b.camelot) || Math.abs(a.pitchPct - b.pitchPct) > 6) continue
    const s = (skip.has(a.id) ? 0 : 1) + (skip.has(b.id) ? 0 : 1) - Math.abs(a.pitchPct - b.pitchPct) / 6 - Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5))
    if (!best || s > best.s) best = { a, b, s }
  }
  return best ? { entries: [best.a, best.b], rationale: `${best.a.camelot} and ${best.b.camelot} sit together and with the playing key.` } : null
}

/**
 * The model's JSON → exactly three picks, a mashup pair and an FX macro.
 * Unknown or repeated ids are dropped and the gaps filled from the pool order.
 */
export function parseSuggestion(json: any, pool: PoolEntry[], direction: Direction): { picks: Pick[]; mashup: Mashup | null; fx: FxStep[]; fromModel: number } {
  const byId = new Map(pool.map(p => [p.id, p]))
  const used = new Set<string>()
  const picks: Pick[] = []
  for (const raw of Array.isArray(json?.picks) ? json.picks : []) {
    const e = byId.get(raw?.id)
    if (!e || used.has(e.id)) continue
    used.add(e.id)
    picks.push(parsePick(raw, e))
    if (picks.length === 3) break
  }
  const fromModel = picks.length
  for (const e of pool) { if (picks.length >= 3) break; if (!used.has(e.id)) { used.add(e.id); picks.push(fallbackPick(e)) } }

  let mashup: Mashup | null = null
  const ids = Array.isArray(json?.mashup?.ids) ? json.mashup.ids : []
  const a = byId.get(ids[0]), b = byId.get(ids[1])
  if (a && b && a.id !== b.id) mashup = { entries: [a, b], rationale: rationaleOr(json.mashup.rationale, `${a.camelot} and ${b.camelot} layer over the playing key.`) }
  else mashup = bestMashup(pool, used)

  const fx = parseFx(json?.fx)
  return { picks, mashup, fx: fx.length ? fx : defaultFx(direction), fromModel }
}
