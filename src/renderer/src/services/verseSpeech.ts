// Reading scripture aloud.
//
// This uses the Web Speech API, which is the only text-to-speech available to
// the app without a network call, an account and a per-character bill. That
// choice has a real ceiling and it is worth stating plainly: the voices it can
// reach are the ones installed on the machine, and a local SAPI voice cannot
// act. It will not weep at Lamentations. Genuinely emotive narration needs a
// neural cloud voice (ElevenLabs, Azure Neural, OpenAI) and therefore a key, a
// connection, and sending the text off the device — none of which this app
// assumes it has.
//
// What can be done offline, and is done here, is most of the distance:
//
//   1. Pick the best voice actually present rather than whatever the browser
//      hands back first. Windows and macOS both ship natural/neural-class
//      voices now, and they are dramatically better than the default — but
//      they are never first in the list.
//   2. Read in clauses, not paragraphs. Handing a whole chapter to the engine
//      produces a flat, breathless recital; feeding it clause-sized pieces at
//      punctuation gives it the pauses a person would take, and lets a stop
//      land immediately instead of at the end of the passage.
//   3. Slow it down and drop the pitch slightly. Scripture read at the default
//      rate sounds like a disclaimer.
//
// Everything here is pure except the thin controller at the bottom, so the
// voice ranking and the chunking are unit-tested rather than eyeballed.

export interface VoiceLike {
  name: string
  lang: string
  localService?: boolean
  default?: boolean
}

/** Rate/pitch tuned for reading scripture aloud rather than reading a UI label. */
export const VERSE_RATE = 0.88
export const VERSE_PITCH = 0.96

// Names that mark a modern, high-quality voice on the platforms this app runs
// on. Ordered best-first; the first hit wins.
const QUALITY_MARKERS = [
  'natural',   // Windows 11 "Microsoft Aria (Natural)" family — by far the best local option
  'neural',
  'premium',   // macOS premium/enhanced downloads
  'enhanced',
  'siri',
  'google',    // Chromium's bundled Google voices, when present
]

// Voices to avoid when anything else exists. eSpeak is the Linux fallback and
// is robotic to the point of being unpleasant for long-form reading; the
// "Microsoft David/Zira Desktop" pair are the ancient SAPI4-era defaults.
const POOR_MARKERS = ['espeak', 'desktop', 'compact']

/**
 * Score a voice for reading scripture. Higher is better; negative means avoid.
 *
 * Exported for the tests — the ranking is the part most likely to regress
 * silently when someone "simplifies" the picker later.
 */
export function scoreVoice(v: VoiceLike, preferredLang = 'en'): number {
  const name = (v.name || '').toLowerCase()
  const lang = (v.lang || '').toLowerCase()

  // Wrong language is disqualifying: an English psalm read by a French voice
  // is unintelligible, however good the voice is.
  if (!lang.startsWith(preferredLang.toLowerCase().slice(0, 2))) return -1

  let score = 10
  const quality = QUALITY_MARKERS.findIndex(m => name.includes(m))
  if (quality >= 0) score += 100 - quality * 10
  if (POOR_MARKERS.some(m => name.includes(m))) score -= 40
  // A remote voice is usually the better-sounding one, when the platform
  // exposes it at all.
  if (v.localService === false) score += 5
  if (v.default) score += 1
  return score
}

/**
 * The best available voice, or null when the platform offers none in the
 * right language.
 *
 * A negative score means "poor", not "disqualified": eSpeak is unpleasant but
 * it is still better than silence on a machine that has nothing else. Only the
 * wrong language rules a voice out entirely, which `scoreVoice` marks with -1.
 */
export function pickVoice<T extends VoiceLike>(voices: T[], preferredLang = 'en'): T | null {
  let best: T | null = null
  let bestScore = -Infinity
  for (const v of voices || []) {
    const s = scoreVoice(v, preferredLang)
    if (s === -1) continue                    // wrong language — never usable
    if (s > bestScore) { best = v; bestScore = s }
  }
  return best
}

/**
 * Break text into the pieces the engine should speak one at a time.
 *
 * Split at sentence ends first, then at internal punctuation when a sentence
 * is long enough that the engine would run out of breath. Punctuation is kept
 * on the chunk so the engine still hears the question mark and inflects.
 */
export function speechChunks(text: string, maxChars = 180): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return []

  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean]
  const out: string[] = []
  for (const raw of sentences) {
    const sentence = raw.trim()
    if (!sentence) continue
    if (sentence.length <= maxChars) { out.push(sentence); continue }

    // Too long to say in one breath — break at commas, semicolons and colons,
    // accumulating until the next clause would overflow.
    const clauses = sentence.split(/(?<=[,;:—])\s+/)
    let buffer = ''
    for (const clause of clauses) {
      if (!buffer) { buffer = clause; continue }
      if (`${buffer} ${clause}`.length > maxChars) { out.push(buffer); buffer = clause }
      else buffer = `${buffer} ${clause}`
    }
    if (buffer) out.push(buffer)
  }
  // A clause longer than the cap even after splitting (a verse with no
  // internal punctuation) is spoken whole rather than cut mid-word.
  return out.filter(Boolean)
}

/** `John 3:16` → the spoken form, so the engine doesn't say "three colon sixteen". */
export function spokenReference(label: string): string {
  return String(label || '').replace(/(\d+)\s*:\s*(\d+)/, '$1 verse $2')
}

// ── Controller ──────────────────────────────────────────────────────────────

export interface SpeechHandle {
  /** Stop immediately and drop anything queued. */
  stop: () => void
}

export interface SpeakOptions {
  /** Spoken before the text, e.g. "John 3 verse 16". */
  intro?: string
  lang?: string
  onChunk?: (index: number, total: number) => void
  onDone?: () => void
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined'
}

/**
 * Voices load asynchronously on most platforms — the first call to
 * getVoices() routinely returns an empty array, which is why so many web
 * players read in the wrong voice for the first few seconds.
 */
export function loadVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    if (!speechSupported()) { resolve([]); return }
    const synth = window.speechSynthesis
    const ready = synth.getVoices()
    if (ready.length) { resolve(ready); return }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      synth.onvoiceschanged = null
      resolve(synth.getVoices())
    }
    synth.onvoiceschanged = finish
    setTimeout(finish, timeoutMs)
  })
}

/**
 * Speak a passage. Returns a handle whose stop() is safe to call at any time,
 * including after the reading has already finished.
 */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<SpeechHandle> {
  if (!speechSupported()) return { stop: () => {} }
  const synth = window.speechSynthesis
  synth.cancel()

  const voices = await loadVoices()
  const voice = pickVoice(voices, opts.lang || 'en')
  const chunks = speechChunks(text)
  if (opts.intro) chunks.unshift(spokenReference(opts.intro))
  if (!chunks.length) return { stop: () => {} }

  let cancelled = false
  let index = 0

  const next = () => {
    if (cancelled || index >= chunks.length) {
      if (!cancelled) opts.onDone?.()
      return
    }
    const i = index++
    const u = new SpeechSynthesisUtterance(chunks[i])
    if (voice) u.voice = voice as SpeechSynthesisVoice
    u.lang = voice?.lang || opts.lang || 'en-US'
    u.rate = VERSE_RATE
    u.pitch = VERSE_PITCH
    opts.onChunk?.(i, chunks.length)
    u.onend = next
    // An error on one clause must not silently end the reading — skip to the
    // next rather than leaving the button stuck showing "playing".
    u.onerror = next
    synth.speak(u)
  }
  next()

  return {
    stop: () => {
      cancelled = true
      try { synth.cancel() } catch {}
    },
  }
}

/** Stop anything currently being read, from anywhere in the app. */
export function stopSpeaking(): void {
  if (speechSupported()) {
    try { window.speechSynthesis.cancel() } catch {}
  }
}
