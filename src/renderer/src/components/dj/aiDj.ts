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

export interface SongPick { artist: string; title: string }

export interface SetPlan {
  picks: SongPick[]
  provider: string
}

/** Pull song picks out of a model reply: a JSON array if there is one, else "Artist - Title" lines. */
export function parsePicks(reply: string): SongPick[] {
  const out: SongPick[] = []
  const seen = new Set<string>()
  const add = (artist: unknown, title: unknown) => {
    const a = String(artist ?? '').trim().replace(/^["'*]+|["'*]+$/g, '')
    const t = String(title ?? '').trim().replace(/^["'*]+|["'*]+$/g, '')
    if (!t || t.length > 120 || a.length > 120) return
    const key = `${a}|${t}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ artist: a, title: t })
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
          } else if (x && typeof x === 'object') add(x.artist ?? x.Artist, x.title ?? x.song ?? x.Title)
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

export function buildPrompt(vibe: string, count: number, avoid: string[], following?: SongPick): string {
  return [
    `You are a professional DJ building a set. Vibe: "${vibe}".`,
    following ? `The set continues straight after "${following.artist} - ${following.title}".` : '',
    `Pick ${count} real, well-known released songs that fit, in the order you would play them,`,
    'so energy and tempo flow smoothly from one to the next.',
    avoid.length ? `Do not repeat any of these: ${avoid.slice(-40).join('; ')}.` : '',
    'Reply with ONLY a JSON array, no other text, like:',
    '[{"artist":"Artist Name","title":"Song Title"}]',
  ].filter(Boolean).join('\n')
}

export async function planSet(vibe: string, count: number, avoid: string[], following?: SongPick): Promise<SetPlan> {
  const ai = (window as any).electronAPI.ai
  const r = await ai.chat([{ role: 'user', content: buildPrompt(vibe, count, avoid, following) }])
  if (!r || r.provider === 'error' || r.provider === 'none' || !r.content) {
    throw new Error('The AI model is not answering — check that Ollama is running.')
  }
  const picks = parsePicks(String(r.content)).slice(0, count)
  if (!picks.length) throw new Error('The AI reply had no songs in it — try describing the vibe differently.')
  return { picks, provider: String(r.provider || '') }
}

/** Longest a pick may run — skips hour-long compilations a search can return. */
const MAX_PICK_SECONDS = 12 * 60

/** Find one playable YouTube upload for a pick. */
export async function resolvePick(p: SongPick): Promise<DjTrack | null> {
  const q = `${p.artist} ${p.title} audio`.trim()
  const results = await searchYouTube(q, 6)
  const ok = results.filter(t => !t.durationHint || t.durationHint <= MAX_PICK_SECONDS)
  const best = ok[0] ?? null
  if (!best) return null
  // Show the song as the model named it — upload titles are noisy.
  return { ...best, title: p.title || best.title, artist: p.artist || best.artist }
}

/** Resolve picks a few at a time, reporting each as it lands, in set order. */
export async function resolvePicks(picks: SongPick[], onTrack: (t: DjTrack, i: number) => void): Promise<number> {
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
      try { results[i] = await resolvePick(picks[i]) } catch { results[i] = null }
      flush()
    }
  }
  await Promise.all([worker(), worker(), worker()])
  flush()
  return found
}
