/**
 * AI DJ — the local model (Ollama, through the app's usual provider chain)
 * plans a set from a described vibe, and each pick is found on YouTube so it
 * can be played straight away on a deck.
 *
 * The model only ever names songs; it never invents links, ids or tempos.
 * Every playable track comes from a real YouTube search result.
 */
import type { DjTrack } from './engine/DjEngine'
import { searchYouTube } from './libraryData'
import { contextLines, type SetContext } from './djBrain'

export interface SongPick {
  artist: string
  title: string
  /** Why the DJ chose it — shown in the log. */
  reason?: string
  /** A YouTube search to run instead of a named song (the fallback when no model answers). */
  query?: string
}

export interface SetPlan {
  picks: SongPick[]
  provider: string
}

/** Pull song picks out of a model reply: a JSON array if there is one, else "Artist - Title" lines. */
export function parsePicks(reply: string): SongPick[] {
  const out: SongPick[] = []
  const seen = new Set<string>()
  const add = (artist: unknown, title: unknown, reason?: unknown) => {
    const a = String(artist ?? '').trim().replace(/^["'*]+|["'*]+$/g, '')
    const t = String(title ?? '').trim().replace(/^["'*]+|["'*]+$/g, '')
    if (!t || t.length > 120 || a.length > 120) return
    const key = `${a}|${t}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const why = typeof reason === 'string' ? reason.trim().slice(0, 140) : ''
    out.push(why ? { artist: a, title: t, reason: why } : { artist: a, title: t })
  }

  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(reply.slice(start, end + 1))
      if (Array.isArray(arr)) {
        for (const x of arr) {
          if (typeof x === 'string') {
            const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(x)
            if (m) add(m[1], m[2]); else add('', x)
          } else if (x && typeof x === 'object') add(x.artist ?? x.Artist, x.title ?? x.song ?? x.Title, x.reason ?? x.why)
        }
        if (out.length) return out
      }
    } catch { /* fall through to line parsing */ }
  }

  for (const raw of reply.split('\n')) {
    const line = raw.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/\*\*/g, '').trim()
    const m = /^"?(.+?)"?\s+[-–—]\s+"?(.+?)"?(\s*\(.*\))?$/.exec(line)
    if (m && !/^(here|sure|this|note)/i.test(m[1])) add(m[1], m[2])
  }
  return out
}

export function buildPrompt(vibe: string, count: number, avoid: string[], following?: SongPick, taste?: string, ctx?: SetContext): string {
  return [
    vibe
      ? `You are a professional DJ building a set. Vibe: "${vibe}".`
      : 'You are a professional DJ playing for one listener whose taste you know well. Build the set around it.',
    taste ? `What you know about the listener (learnt from what they play, finish, skip and like):\n${taste}` : '',
    taste ? 'Mix their favourites with songs they would likely love but have not played; follow their taste, not the charts.' : '',
    following ? `The set continues straight after "${following.artist} - ${following.title}".` : '',
    ...(ctx ? contextLines(ctx) : []),
    `Pick ${count} real, well-known released songs that fit, in the order you would play them,`,
    'so energy and tempo flow smoothly from one to the next.',
    avoid.length ? `Do not repeat any of these: ${avoid.slice(-40).join('; ')}.` : '',
    'Reply with ONLY a JSON array, no other text, like:',
    '[{"artist":"Artist Name","title":"Song Title","reason":"five words on why it fits"}]',
  ].filter(Boolean).join('\n')
}

export async function planSet(vibe: string, count: number, avoid: string[], following?: SongPick, taste?: string, ctx?: SetContext): Promise<SetPlan> {
  const ai = (window as any).electronAPI.ai
  const r = await ai.chat([{ role: 'user', content: buildPrompt(vibe, count, avoid, following, taste, ctx) }])
  if (!r || r.provider === 'error' || r.provider === 'none' || !r.content) {
    throw new Error('The AI model is not answering — check that Ollama is running.')
  }
  const picks = parsePicks(String(r.content)).slice(0, count)
  if (!picks.length) throw new Error('The AI reply had no songs in it — try describing the vibe differently.')
  return { picks, provider: String(r.provider || '') }
}

/** Longest a pick may run — skips hour-long compilations a search can return. */
const MAX_PICK_SECONDS = 12 * 60

/**
 * Find one playable YouTube upload for a pick. `taken` holds the video ids that
 * already played, so a search-based pick (no named song) returns something new.
 */
export async function resolvePick(p: SongPick, taken: ReadonlySet<string> = new Set()): Promise<DjTrack | null> {
  const q = p.query ?? `${p.artist} ${p.title} audio`.trim()
  const results = await searchYouTube(q, p.query ? 12 : 6)
  const ok = results.filter(t => (!t.durationHint || t.durationHint <= MAX_PICK_SECONDS) && !(t.youtubeId && taken.has(t.youtubeId)))
  if (p.query) {
    // A search is not a song: take a fresh result, and keep YouTube's own title.
    const pool = ok.slice(0, 5)
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
  }
  const best = ok[0] ?? null
  if (!best) return null
  // Show the song as the model named it — upload titles are noisy.
  return { ...best, title: p.title || best.title, artist: p.artist || best.artist }
}

/** Resolve picks a few at a time, reporting each as it lands, in set order. */
export async function resolvePicks(picks: SongPick[], onTrack: (t: DjTrack, i: number) => void, taken: ReadonlySet<string> = new Set()): Promise<number> {
  let found = 0
  const results: (DjTrack | null)[] = new Array(picks.length).fill(undefined)
  let next = 0
  let emitted = 0
  const flush = () => {
    while (emitted < picks.length && results[emitted] !== undefined) {
      const t = results[emitted]
      if (t) { onTrack(t, emitted); found++ }
      emitted++
    }
  }
  const worker = async () => {
    while (next < picks.length) {
      const i = next++
      try { results[i] = await resolvePick(picks[i], taken) } catch { results[i] = null }
      flush()
    }
  }
  await Promise.all([worker(), worker(), worker()])
  flush()
  return found
}
