/**
 * The AI DJ's ears and judgement, kept free of React and the audio engine so
 * they can be tested.
 *
 *  - parseCommand: understands what the DJ says to the assistant ("skip", "more
 *    energy", "play Essence by Wizkid", "hit the horn") with plain rules, so the
 *    assistant answers instantly and even when no AI model is reachable.
 *  - parseModelIntents: the same vocabulary from a model's JSON reply, for
 *    anything the rules do not recognise. Only whitelisted actions get through.
 *  - setContext lines: what the model is told about the room — what is playing,
 *    the energy being asked for, the time of day — so its picks follow the set.
 *  - fallbackQueries: searches that keep the set going when the model is down.
 */
import type { HitId } from './engine/sampler'
import type { TasteProfile } from './taste'
import { dayPart } from './taste'

export type Energy = 'auto' | 'build' | 'peak' | 'chill'

export type DjIntent =
  | { type: 'skip' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'fade' }
  | { type: 'sync' }
  | { type: 'loop' }
  | { type: 'status' }
  | { type: 'like' }
  | { type: 'dislike' }
  | { type: 'automix'; on: boolean }
  | { type: 'takeover'; on: boolean }
  | { type: 'voice'; on: boolean }
  | { type: 'energy'; to: Energy }
  | { type: 'volume'; delta: number }
  | { type: 'hit'; id: HitId }
  | { type: 'mixin'; query: string }
  | { type: 'queue'; query: string }
  | { type: 'vibe'; text: string }

const clean = (s: string) => s.toLowerCase().replace(/[“”"!?.]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Drop the polite wrapper: "hey DJ, could you please skip this song" → "skip this song". */
function strip(text: string): string {
  let t = clean(text)
  t = t.replace(/^(hey |ok |okay )?(dj|ai dj|aihub)[ ,:]*/, '')
  t = t.replace(/^(can|could|would|will) you (please )?/, '').replace(/^(please|pls|just|now|go ahead and|let'?s|i want you to|i need you to) /, '')
  t = t.replace(/ (please|pls|for me|now|thanks|thank you)$/, '')
  return t.trim()
}

const isOn = (t: string) => !/\b(off|stop|disable|quiet|mute|silence|no more|cancel)\b/.test(t)

/**
 * What did the DJ ask for? Null when the rules do not recognise it — the caller
 * can then ask the model.
 */
export function parseCommand(text: string): DjIntent | null {
  const t = strip(text)
  if (!t) return null
  const words = t.split(' ').length

  // Handing the decks over or taking them back.
  if (/\b(take back|taking back|i('| wi)?ll take (it )?(back|over)|stop the ai|ai off|turn off the ai|you can stop)\b/.test(t)) return { type: 'takeover', on: false }
  if (/\b(take over|you take over|you('| a)?re the dj|you be the dj|run the (set|show|decks|party)|you drive|surprise me)\b/.test(t)) return { type: 'takeover', on: true }

  if (/\bauto ?mix\b/.test(t)) return { type: 'automix', on: isOn(t) }
  if (/\b(voice|announce\w*|talk to me|mc mode)\b/.test(t) && words <= 4 && !/^(play|queue|add|mix|put on|spin)\b/.test(t)) return { type: 'voice', on: isOn(t) }

  // Sampler hits are short commands: "horn", "hit the siren", "fire a laser".
  if (words <= 5) {
    if (/\b(air ?horn|horn)\b/.test(t)) return { type: 'hit', id: 'horn' }
    if (/\bsiren\b/.test(t)) return { type: 'hit', id: 'siren' }
    if (/\b(laser|zap)\b/.test(t)) return { type: 'hit', id: 'laser' }
    if (/\b(riser|build ?up|rise)\b/.test(t)) return { type: 'hit', id: 'riser' }
    if (/\b(impact|boom|sub drop|big drop)\b/.test(t)) return { type: 'hit', id: 'impact' }
    if (/\bclap\b/.test(t)) return { type: 'hit', id: 'clap' }
  }

  if (/^(skip|next|next (song|track|one)|play (the )?next( one| song| track)?|change (the )?(song|track)|skip (this|it|that)( song| track| one)?|move on)$/.test(t)) return { type: 'skip' }
  if (/^(pause|stop|stop (the )?(music|song|track|playing)|pause (the )?(music|song|track)|hold on|freeze)$/.test(t)) return { type: 'pause' }
  if (/^(resume|continue|unpause|play|start|keep going|play (the )?(music|song|track)|start (the )?(music|song))$/.test(t)) return { type: 'resume' }
  if (/^(fade|crossfade|blend|transition|mix|mix (it )?(now|over|across|out)|fade (it )?(now|over|across|out)|bring in the other (deck|song))$/.test(t)) return { type: 'fade' }
  if (/^(sync|beat ?match|match (the )?(beats|tempo|bpm)|sync (the )?(decks|tempo|beats))$/.test(t)) return { type: 'sync' }
  if (/^loop( it| this)?( \d+)?( beats?| bars?)?$/.test(t)) return { type: 'loop' }

  if (/\b(what('?s| is) (this|that|the|playing|on)( song| track)?|now playing|what am i (listening|hearing)|who('?s| is) (this|singing|that)|what song)\b/.test(t) && words <= 7) return { type: 'status' }
  // Dislike first: "don't like this" also contains "like this".
  if (/\b(hate|dislike|don'?t like|do not like|not a fan of|can'?t stand|sick of) (this|it|that)( song| track| one)?$|thumbs down/.test(t)) return { type: 'dislike' }
  if (/\b(i )?(love|like|really like) (this|it|that)( song| track| one)?$|thumbs up|^good one$/.test(t)) return { type: 'like' }

  if (/\b(louder|turn it up|volume up|raise the volume|crank it|more volume|bigger)\b/.test(t) && words <= 6) return { type: 'volume', delta: 0.1 }
  if (/\b(quieter|softer|turn it down|volume down|lower the volume|less volume|too loud)\b/.test(t) && words <= 6) return { type: 'volume', delta: -0.1 }

  if (/\b(all out|max(imum)? energy|peak time|go crazy|go wild|full energy|peak)\b/.test(t) && words <= 6) return { type: 'energy', to: 'peak' }
  if (/\b(more|higher|raise the|bring up the|build( the)?) ?(energy|intensity|tempo|speed)\b|\b(pump it up|hype|get (the )?(party|crowd|room) (going|started|moving)|faster|speed it up|speed up|build it up|lift it)\b/.test(t) && words <= 8) return { type: 'energy', to: 'build' }
  if (/\b(chill|calm|relax|mellow|slow(er)?|cool (it )?down|wind down|lower the energy|less energy|bring it down|take it easy|softer vibe)\b/.test(t) && words <= 8) return { type: 'energy', to: 'chill' }
  if (/\b(energy|vibe) (auto|automatic|back to normal|reset)\b|\bauto energy\b/.test(t)) return { type: 'energy', to: 'auto' }

  let m = /^(?:queue(?: up)?|add(?: to (?:the )?(?:queue|set|list|playlist))?|play next|up next|line up|next up)\s+(.{2,})$/.exec(t)
  if (m) return { type: 'queue', query: m[1].replace(/\s+(to|in|on) (the )?(queue|set|list|playlist)$/, '').trim() }

  m = /^(?:(?:vibe|set the vibe|change the vibe|switch the vibe)(?: to| is)?|give me|i want|i('?m| am) in the mood for|in the mood for|let'?s (?:do|have|go for)|something (?:like|with)?|play (?:some|something|a few|more|me some)|more|a set of|a (?:set|mix) of)\s*(.*)$/.exec(t)
  if (m) {
    const rest = (m[m.length - 1] || '').trim()
    return { type: 'vibe', text: rest || t }
  }

  m = /^(?:play|put on|mix in|mix|spin|drop in|cue up|throw on|bring in|load)\s+(.{2,})$/.exec(t)
  if (m) return { type: 'mixin', query: m[1].replace(/^(the )?(song|track) /, '').trim() }

  return null
}

const ENERGIES: readonly string[] = ['auto', 'build', 'peak', 'chill']
const HITS: readonly string[] = ['horn', 'siren', 'laser', 'riser', 'impact', 'clap']

/** Read the actions a model asked for. Anything outside the vocabulary is dropped. */
export function parseModelIntents(reply: string): DjIntent[] {
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  let arr: unknown
  try {
    arr = start >= 0 && end > start ? JSON.parse(reply.slice(start, end + 1)) : JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))
  } catch { return [] }
  const list = Array.isArray(arr) ? arr : [arr]
  const out: DjIntent[] = []
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 120) : '')
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const x = raw as Record<string, unknown>
    switch (x.type ?? x.action) {
      case 'skip': case 'pause': case 'resume': case 'fade': case 'sync': case 'loop': case 'status': case 'like': case 'dislike':
        out.push({ type: (x.type ?? x.action) as 'skip' }); break
      case 'automix': out.push({ type: 'automix', on: x.on !== false }); break
      case 'takeover': out.push({ type: 'takeover', on: x.on !== false }); break
      case 'voice': out.push({ type: 'voice', on: x.on !== false }); break
      case 'energy': if (ENERGIES.includes(String(x.to))) out.push({ type: 'energy', to: x.to as Energy }); break
      case 'volume': { const d = Number(x.delta); if (Number.isFinite(d)) out.push({ type: 'volume', delta: Math.max(-0.3, Math.min(0.3, d)) }); break }
      case 'hit': if (HITS.includes(String(x.id))) out.push({ type: 'hit', id: x.id as HitId }); break
      case 'mixin': case 'play': if (str(x.query)) out.push({ type: 'mixin', query: str(x.query) }); break
      case 'queue': if (str(x.query)) out.push({ type: 'queue', query: str(x.query) }); break
      case 'vibe': if (str(x.text)) out.push({ type: 'vibe', text: str(x.text) }); break
    }
    if (out.length >= 4) break
  }
  return out
}

/** The prompt that turns free speech into actions, for what the rules did not catch. */
export function buildCommandPrompt(text: string, now?: string): string {
  return [
    'You are the brain of a DJ console. The DJ said something to you. Turn it into 1-3 actions.',
    now ? `Now playing: ${now}.` : 'Nothing is playing.',
    `The DJ said: "${text.replace(/"/g, "'").slice(0, 300)}"`,
    'Allowed actions (reply with ONLY a JSON array of these, nothing else):',
    '{"type":"skip"} {"type":"pause"} {"type":"resume"} {"type":"fade"} {"type":"sync"} {"type":"loop"} {"type":"status"}',
    '{"type":"like"} {"type":"dislike"} {"type":"automix","on":true} {"type":"takeover","on":true} {"type":"voice","on":true}',
    '{"type":"energy","to":"auto|build|peak|chill"} {"type":"volume","delta":0.1} {"type":"hit","id":"horn|siren|laser|riser|impact|clap"}',
    '{"type":"mixin","query":"Artist Song"} {"type":"queue","query":"Artist Song"} {"type":"vibe","text":"describe the music"}',
    'If the DJ named a song or artist to hear now use mixin; to hear later use queue; if they described a mood or genre use vibe.',
    'If nothing fits, reply [].',
  ].join('\n')
}

// ── What the model is told about the room ───────────────────────────────────

export interface SetContext {
  now?: { artist: string; title: string; bpm?: number | null; key?: string | null }
  energy: Energy
  hour: number
}

export const ENERGY_NOTES: Record<Energy, string> = {
  auto: 'Read the room: hold the energy steady, with small lifts.',
  build: 'Build the energy: each song a touch faster and more intense than the last.',
  peak: 'This is the peak of the night: the biggest, most danceable songs, high tempo, no slow ones.',
  chill: 'Bring the energy down: slower, smoother, warmer songs; lower the tempo gradually.',
}

export function contextLines(ctx: SetContext): string[] {
  const lines: string[] = []
  if (ctx.now) {
    const bits = [ctx.now.bpm ? `${Math.round(ctx.now.bpm)} BPM` : '', ctx.now.key ? `key ${ctx.now.key}` : ''].filter(Boolean).join(', ')
    lines.push(`Playing right now: "${ctx.now.artist ? `${ctx.now.artist} - ` : ''}${ctx.now.title}"${bits ? ` (${bits})` : ''}.`)
    lines.push('Keep neighbouring songs within about ±8 BPM of each other unless you are deliberately changing the energy, and prefer songs that mix in key.')
  }
  lines.push(`Energy direction: ${ENERGY_NOTES[ctx.energy]}`)
  lines.push(`It is ${dayPart(ctx.hour)} — choose songs that suit that time of day.`)
  return lines
}

/**
 * Searches that keep a set going when no model answers: the artists the listener
 * loves, their loved songs, or the described vibe. Order is shuffled with `rnd`
 * so repeated top-ups do not ask for the same thing.
 */
export function fallbackQueries(vibe: string, p: TasteProfile, energy: Energy, count: number, rnd: () => number = Math.random): string[] {
  const suffix = energy === 'chill' ? 'chill songs' : energy === 'peak' || energy === 'build' ? 'dance hits' : 'best songs'
  const pool: string[] = []
  if (vibe.trim()) {
    pool.push(`${vibe.trim()} songs`, `${vibe.trim()} hits`, `${vibe.trim()} mix`, `best of ${vibe.trim()}`)
  }
  for (const a of p.topArtists.slice(0, 10)) pool.push(`${a.artist} ${suffix}`)
  for (const t of p.lovedTracks.slice(0, 6)) pool.push(`${t.artist} ${t.title} similar songs`)
  if (!pool.length) pool.push('top hits playlist', 'afrobeats hits', 'house music hits', 'r&b hits', 'pop hits')
  const shuffled = pool.map(q => ({ q, r: rnd() })).sort((a, b) => a.r - b.r).map(x => x.q)
  return shuffled.slice(0, count)
}

/** Short spoken lines for the DJ voice. Deterministic per song so a replay says the same thing. */
export function introLine(artist: string, title: string, energy: Energy): string {
  const name = artist ? `${title} by ${artist}` : title
  const plain = [`Up next, ${name}.`, `Coming up, ${name}.`, `Here we go. ${name}.`, `Keep it locked. ${name}.`]
  const hype = [`Let's go! ${name}!`, `Turn it up. ${name}!`, `Big one coming. ${name}!`, `Hands up. ${name}!`]
  const calm = [`Easy now. ${name}.`, `Settle in. ${name}.`, `Nice and smooth. ${name}.`]
  const list = energy === 'peak' || energy === 'build' ? hype : energy === 'chill' ? calm : plain
  let h = 0
  for (const c of title + artist) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return list[h % list.length]
}

// ── The energy the DJ asked for (shared by the panel, the voice and the assistant) ──
let energy: Energy = 'auto'
const energyListeners = new Set<() => void>()
export const getEnergy = (): Energy => energy
export function setEnergy(e: Energy): void {
  if (e === energy) return
  energy = e
  for (const l of energyListeners) l()
}
export function subscribeEnergy(l: () => void): () => void { energyListeners.add(l); return () => { energyListeners.delete(l) } }
