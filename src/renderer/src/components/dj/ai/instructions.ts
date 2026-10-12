// What the listener asked for. The old keyword parser read "no more slow
// songs" as "chill" and "Calm Down by Rema" as a mood, and had nowhere to
// keep "don't play Drake". Here, standing requests become SET RULES the
// planner enforces on every pick; negation is resolved before any mood word
// is read; song titles are recognised before moods; only then do one-shot
// actions fall through to the existing command parser.
import { parseCommand, type DjIntent } from '../djBrain'

export type SetRule =
  | { kind: 'banArtist'; artist: string }
  | { kind: 'onlyGenres'; genres: string[] }
  | { kind: 'moreGenre'; genre: string }
  | { kind: 'lessGenre'; genre: string }
  | { kind: 'tempoRange'; min?: number; max?: number }
  | { kind: 'minEnergy'; level: number; untilMs?: number }
  | { kind: 'maxEnergy'; level: number; untilMs?: number }
  | { kind: 'noExplicit' }
  | { kind: 'stopAfterCurrent' }
  | { kind: 'sequence'; steps: { query: string; count: number }[] }
  | { kind: 'playNext'; query: string }
  | { kind: 'discoveryBurst'; tracks: number }
  | { kind: 'favoritesOnly'; tracks: number }

export type Instruction = { action: DjIntent } | { rule: SetRule } | { removeRule: SetRule['kind']; value?: string }
export interface Parsed { items: Instruction[]; confirm: string; understood: boolean }

const GENRES = ['afrobeats', 'afrobeat', 'amapiano', 'hip hop', 'hip-hop', 'rap', 'r&b', 'rnb', 'house', 'deep house', 'tech house', 'techno', 'drum and bass', 'dnb', 'dancehall', 'reggae', 'reggaeton', 'pop', 'rock', 'jazz', 'gospel', 'soul', 'funk', 'disco', 'edm', 'trance', 'dubstep', 'latin', 'salsa', 'bachata', 'kpop', 'k-pop', 'country', 'lofi', 'lo-fi', 'trap', 'drill', 'bongo', 'highlife', 'soca', 'kompa', 'zouk', 'bollywood', 'classical', 'blues', 'garage', 'uk garage', 'afro house']
const SLOW_WORDS = /\b(slow|chill|calm|mellow|sad|ballads?|quiet|soft)\b/
const NEG = /\b(no|no more|not|don'?t|do not|stop( the)?|without|avoid|less|fewer|enough( of)?|skip the)\b/
const HOUR = 3_600_000
const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase())

const clean = (s: string) => s.toLowerCase().replace(/[“”]/g, '"').replace(/[!?.]+$/g, '').replace(/\s+/g, ' ').trim()
function strip(t: string): string {
  return t.replace(/^(hey |ok |okay )?(dj|ai dj|aihub)[ ,:]*/, '')
    .replace(/^(can|could|would|will) you (please )?/, '').replace(/^(please|pls|just|now|i want you to|i need you to|let'?s) /, '')
    .replace(/ (please|pls|for me|thanks|thank you)$/, '').trim()
}
const genreIn = (t: string) => GENRES.filter(g => new RegExp(`\\b${g.replace(/[-&]/g, m => `\\${m}`)}\\b`).test(t)).map(g => g === 'afrobeat' ? 'afrobeats' : g === 'hip-hop' ? 'hip hop' : g === 'rnb' ? 'r&b' : g === 'k-pop' ? 'kpop' : g === 'lo-fi' ? 'lofi' : g)
const durationMs = (t: string): number | undefined => {
  // "for an hour", "for 2 hours", "for the next hour" (no number = one).
  const m = /for (?:the )?(?:next )?(?:(an?|\d+(?:\.\d+)?) ?)?(hours?|hrs?|h|minutes?|mins?|m)\b/.exec(t)
  if (!m) return undefined
  const n = !m[1] || m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1])
  return /^h/.test(m[2]) ? n * HOUR : n * 60_000
}

function rules(t: string, now: number): SetRule | { remove: SetRule['kind']; value?: string } | null {
  let m: RegExpExecArray | null

  // Lifting a ban comes before banning: "you can play Drake again".
  if ((m = /^(?:you can |it'?s ok(?:ay)? to )?play (.+?) again$/.exec(t))) return { remove: 'banArtist', value: m[1].replace(/^any /, '').trim() }

  // Song titles before anything mood-shaped: "play Calm Down by Rema next".
  if ((m = /^(?:play|put on|queue|cue up) "([^"]{2,80})"(?: by ([^,]{2,60}))?(?: next| now)?$/.exec(t))) return { kind: 'playNext', query: [m[1], m[2]].filter(Boolean).join(' ').trim() }
  if ((m = /^(?:play|put on|queue|cue up) (.{2,80}?) by (.{2,60}?)(?: next| now)?$/.exec(t))) return { kind: 'playNext', query: `${m[1]} ${m[2]}`.trim() }

  if (/^stop after (this|the current)( one| song| track)?$|^(this is|make this) the last (song|one|track)$|^last song$/.test(t)) return { kind: 'stopAfterCurrent' }
  if (/\b(explicit|clean versions?|no swearing|no cursing|radio edits?)\b/.test(t) && /\b(no|avoid|without|clean|only|radio)\b/.test(t)) return { kind: 'noExplicit' }

  // Negation resolved BEFORE mood words: "no more slow songs" raises the floor.
  if (NEG.test(t) && SLOW_WORDS.test(t) && !/\b(more|keep|play some)\b.*\bslow\b/.test(t.replace(/no more/, ''))) {
    return { kind: 'minEnergy', level: 0.5, ...(durationMs(t) ? { untilMs: now + durationMs(t)! } : {}) }
  }
  if (/\b(keep|stay|hold)\b.*\b(energy|vibe|it)\b.*\b(high|up|hype)\b|\bhigh energy\b/.test(t)) {
    const d = durationMs(t)
    return { kind: 'minEnergy', level: 0.65, ...(d ? { untilMs: now + d } : {}) }
  }
  if (/\b(keep|stay|hold)\b.*\b(energy|vibe|it)\b.*\b(low|down|chill|calm)\b/.test(t)) {
    const d = durationMs(t)
    return { kind: 'maxEnergy', level: 0.45, ...(d ? { untilMs: now + d } : {}) }
  }

  if ((m = /\b(?:under|below|less than|max(?:imum)?|no faster than) (\d{2,3}) ?bpm\b/.exec(t))) return { kind: 'tempoRange', max: Number(m[1]) }
  if ((m = /\b(?:over|above|more than|at least|min(?:imum)?) (\d{2,3}) ?bpm\b/.exec(t))) return { kind: 'tempoRange', min: Number(m[1]) }
  if ((m = /\bbetween (\d{2,3}) and (\d{2,3}) ?bpm\b/.exec(t))) return { kind: 'tempoRange', min: Math.min(+m[1], +m[2]), max: Math.max(+m[1], +m[2]) }

  const genres = genreIn(t)
  if (genres.length) {
    if (/^(less|fewer|not so much|enough|no more|stop the|stop playing|no) /.test(t)) return { kind: 'lessGenre', genre: genres[0] }
    if (/^(only|play only|just|stick to|stick with|switch to|change to|all|nothing but)\b/.test(t) || /\bonly\b/.test(t)) return { kind: 'onlyGenres', genres }
    if (/^(more|add more|more of|extra)\b/.test(t)) return { kind: 'moreGenre', genre: genres[0] }
  }

  if (/\b(never heard|something new|new (music|songs|stuff)|surprise me with new|discover)\b/.test(t)) return { kind: 'discoveryBurst', tracks: 3 }
  if (/\b(my (favorites|favourites|faves|liked songs|likes)|songs i (love|like))\b/.test(t)) return { kind: 'favoritesOnly', tracks: 5 }

  // Sequences: "play 3 Wizkid songs then Davido".
  if ((m = /^play (\d{1,2}|a few|two|three|four|five) (.+?) (?:songs?|tracks?)?(?: then | and then )(.+)$/.exec(t))) {
    const words: Record<string, number> = { 'a few': 3, two: 2, three: 3, four: 4, five: 5 }
    const count = words[m[1]] ?? Number(m[1])
    const first = m[2].replace(/ (songs?|tracks?)$/, '').trim()
    const second = m[3].replace(/ (songs?|tracks?)$/, '').trim()
    return { kind: 'sequence', steps: [{ query: first, count: Math.min(10, count) }, { query: second, count: 1 }] }
  }

  // Bans: "don't play drake", "no more Drake", "skip the Drake songs".
  if ((m = /^(?:don'?t|do not|never) play (?:any )?(?:more )?(.{2,40}?)(?: songs?| music)?$/.exec(t)) || (m = /^no more (.{2,40}?)(?: songs?| music)?$/.exec(t))) {
    const who = m[1].trim()
    if (!genreIn(who).length && !SLOW_WORDS.test(who)) return { kind: 'banArtist', artist: who }
  }
  return null
}

export function ruleLabel(r: SetRule): string {
  switch (r.kind) {
    case 'banArtist': return `No ${titleCase(r.artist)}`
    case 'onlyGenres': return `Only ${r.genres.map(titleCase).join(' + ')}`
    case 'moreGenre': return `More ${titleCase(r.genre)}`
    case 'lessGenre': return `Less ${titleCase(r.genre)}`
    case 'tempoRange': return r.min && r.max ? `${r.min}–${r.max} BPM` : r.max ? `≤ ${r.max} BPM` : `≥ ${r.min} BPM`
    case 'minEnergy': return r.level >= 0.65 ? 'High energy' : 'No slow songs'
    case 'maxEnergy': return 'Keep it calm'
    case 'noExplicit': return 'Clean versions'
    case 'stopAfterCurrent': return 'Last song'
    case 'sequence': return r.steps.map(s => `${s.count}× ${titleCase(s.query)}`).join(' → ')
    case 'playNext': return `Next: ${titleCase(r.query)}`
    case 'discoveryBurst': return `${r.tracks} new to you`
    case 'favoritesOnly': return `${r.tracks} favourites`
  }
}

function confirmFor(i: Instruction): string {
  if ('rule' in i) {
    const r = i.rule
    switch (r.kind) {
      case 'banArtist': return `Got it — no ${titleCase(r.artist)} for the rest of the set.`
      case 'stopAfterCurrent': return 'Got it — this is the last song.'
      case 'playNext': return `Got it — ${titleCase(r.query)} is up next.`
      case 'sequence': return `Got it — ${ruleLabel(r)}.`
      default: return `Got it — ${ruleLabel(r).toLowerCase()}${'untilMs' in r && r.untilMs ? ' for a while' : ''}.`
    }
  }
  if ('removeRule' in i) return `Okay — ${i.value ? titleCase(i.value) : 'that'} is allowed again.`
  return ''
}

export function parseInstruction(text: string, now = Date.now()): Parsed {
  const t = strip(clean(text))
  if (!t) return { items: [], confirm: '', understood: false }
  const r = rules(t, now)
  if (r && 'remove' in r) {
    const item: Instruction = { removeRule: r.remove, ...(r.value ? { value: r.value } : {}) }
    return { items: [item], confirm: confirmFor(item), understood: true }
  }
  if (r) {
    const item: Instruction = { rule: r }
    return { items: [item], confirm: confirmFor(item), understood: true }
  }
  // "slow songs please" is a positive mood request: chill.
  if (SLOW_WORDS.test(t) && !NEG.test(t)) return { items: [{ action: { type: 'energy', to: 'chill' } }], confirm: 'Bringing it down.', understood: true }
  const a = parseCommand(text)
  if (a) return { items: [{ action: a }], confirm: '', understood: true }
  return { items: [], confirm: "I didn't catch that — try “no Drake”, “only amapiano” or “skip”.", understood: false }
}

// ── Model fallback: only for what the rules cannot read ────────────────────
const RULE_KINDS = new Set(['banArtist', 'onlyGenres', 'moreGenre', 'lessGenre', 'tempoRange', 'minEnergy', 'maxEnergy', 'noExplicit', 'stopAfterCurrent', 'sequence', 'playNext', 'discoveryBurst', 'favoritesOnly'])
const ACTION_TYPES = new Set(['skip', 'pause', 'resume', 'like', 'dislike', 'status'])

export function buildInstructionPrompt(text: string): { role: string; content: string }[] {
  return [
    { role: 'system', content: 'Turn a DJ listener request into JSON: {"rules":[...],"actions":[...]}. Rule kinds: banArtist{artist}, onlyGenres{genres[]}, moreGenre{genre}, lessGenre{genre}, tempoRange{min?,max?}, minEnergy{level 0-1}, maxEnergy{level 0-1}, noExplicit, stopAfterCurrent, sequence{steps[{query,count}]}, playNext{query}, discoveryBurst{tracks}, favoritesOnly{tracks}. Action types: skip, pause, resume, like, dislike, status. Reply with JSON only.' },
    { role: 'user', content: text.slice(0, 400) },
  ]
}

function sanitizeRule(r: any): SetRule | null {
  if (!r || !RULE_KINDS.has(r.kind)) return null
  const s = (v: unknown) => typeof v === 'string' ? v.trim().toLowerCase().slice(0, 60) : ''
  const n = (v: unknown, lo: number, hi: number) => typeof v === 'number' && v >= lo && v <= hi ? v : undefined
  switch (r.kind) {
    case 'banArtist': return s(r.artist) ? { kind: 'banArtist', artist: s(r.artist) } : null
    case 'onlyGenres': return Array.isArray(r.genres) && r.genres.length ? { kind: 'onlyGenres', genres: r.genres.map(s).filter(Boolean).slice(0, 5) } : null
    case 'moreGenre': case 'lessGenre': return s(r.genre) ? { kind: r.kind, genre: s(r.genre) } : null
    case 'tempoRange': { const min = n(r.min, 40, 220), max = n(r.max, 40, 220); return min || max ? { kind: 'tempoRange', ...(min ? { min } : {}), ...(max ? { max } : {}) } : null }
    case 'minEnergy': case 'maxEnergy': { const level = n(r.level, 0, 1); return level !== undefined ? { kind: r.kind, level } : null }
    case 'sequence': return Array.isArray(r.steps) && r.steps.length ? { kind: 'sequence', steps: r.steps.slice(0, 5).map((x: any) => ({ query: s(x?.query), count: n(x?.count, 1, 10) ?? 1 })).filter((x: any) => x.query) } : null
    case 'playNext': return s(r.query) ? { kind: 'playNext', query: s(r.query) } : null
    case 'discoveryBurst': case 'favoritesOnly': return { kind: r.kind, tracks: n(r.tracks, 1, 20) ?? 3 }
    default: return { kind: r.kind } as SetRule
  }
}

export function parseModelInstructions(reply: string, now = Date.now()): Parsed {
  void now
  const m = /\{[\s\S]*\}/.exec(reply || '')
  if (!m) return { items: [], confirm: '', understood: false }
  try {
    const j = JSON.parse(m[0])
    const items: Instruction[] = []
    for (const r of Array.isArray(j.rules) ? j.rules : []) { const ok = sanitizeRule(r); if (ok) items.push({ rule: ok }) }
    for (const a of Array.isArray(j.actions) ? j.actions : []) if (ACTION_TYPES.has(a?.type)) items.push({ action: { type: a.type } as DjIntent })
    return { items, confirm: items.map(confirmFor).filter(Boolean).join(' '), understood: items.length > 0 }
  } catch { return { items: [], confirm: '', understood: false } }
}
