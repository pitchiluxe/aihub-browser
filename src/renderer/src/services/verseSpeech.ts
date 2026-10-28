// Reading scripture aloud.
//
// Two engines. The natural voice is a small neural model (Kokoro, see
// src/main/tts) that the user installs once from Settings → Bible; it runs on
// the device, offline, and sounds like a person reading. Until it is installed
// — and for languages it does not speak — the Web Speech API reads instead,
// and on most Windows machines that means David or Zira: the robotic voices.
//
// Both engines are fed the same way, because most of what makes a reading
// sound human is not the voice but the pacing:
//
//   - one clause at a time, with a real silence after it whose length follows
//     the punctuation — a breath at a comma, a beat at a full stop, a longer
//     rest after the reference is announced;
//   - a slight slowing on the last clause, the way a reader lands a passage;
//   - for the system voice, a small deterministic drift in rate and a lift on
//     questions, so twenty clauses are not delivered in one identical tone.
//
// For the system voice, the rest of the distance is:
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

import { loadBibleSettings } from './bibleSettings'

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

/**
 * `John 3:16` → the spoken form, so the engine doesn't say "three colon
 * sixteen"; `5:16–18` → "5 verse 16 to 18".
 */
export function spokenReference(label: string): string {
  return String(label || '')
    .replace(/(\d+)\s*:\s*(\d+)/, '$1 verse $2')
    .replace(/(\d+)\s*[–-]\s*(\d+)/g, '$1 to $2')
}

/**
 * Text as it should be heard rather than as it is printed. Small caps LORD is
 * a typographic convention, not an acronym — some engines spell it out letter
 * by letter. Editorial brackets are dropped; their words are kept.
 */
export function speakable(text: string): string {
  return String(text || '')
    .replace(/\bLORD\b/g, 'Lord')
    .replace(/\bGOD\b/g, 'God')
    .replace(/[[\]¶]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The silence after a clause, in milliseconds, from how it ends — a breath at
 * a comma, a beat at a full stop, a longer rest once the reference has been
 * announced and before the scripture itself begins.
 */
export function pauseAfter(chunk: string, isIntro = false): number {
  if (isIntro) return 650
  const end = chunk.trim().slice(-1)
  if (end === '?' || end === '!') return 430
  if (end === '.') return 380
  if (end === ';' || end === ':') return 260
  if (end === '—') return 220
  if (end === ',') return 180
  return 140
}

// A fixed, repeating drift rather than Math.random(), so a passage reads the
// same way twice and the shape is testable. Small enough to be heard as life,
// not as wobble.
const RATE_DRIFT = [0, 0.018, -0.012, 0.024, -0.02, 0.008]

/** Rate and pitch for one clause read by the system voice. */
export function systemProsody(chunk: string, index: number, total: number, pace = 1): { rate: number; pitch: number } {
  let rate = VERSE_RATE * pace * (1 + RATE_DRIFT[index % RATE_DRIFT.length])
  // A reader slows as they land the end of a passage.
  if (total > 1 && index === total - 1) rate *= 0.94
  let pitch = VERSE_PITCH
  if (chunk.trim().endsWith('?')) pitch += 0.05
  return { rate: Math.max(0.5, Math.min(1.3, rate)), pitch }
}

/** Speed for one clause read by the natural voice. 1 is the model's own pace. */
export function naturalSpeed(index: number, total: number, pace = 1): number {
  let speed = 0.92 * pace
  if (total > 1 && index === total - 1) speed *= 0.95
  return Math.max(0.6, Math.min(1.4, speed))
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

// The one reading in progress, app-wide. Starting another stops it — two
// voices reading over each other is never what anyone meant.
let current: SpeechHandle | null = null

function voiceApi(): any {
  return typeof window !== 'undefined' ? (window as any).electronAPI?.voice : undefined
}

/**
 * The model speaks English (American and British voices). French and the
 * rest stay with the system voice, which at least has the right language.
 */
export function naturalVoiceSpeaks(lang: string): boolean {
  return lang.toLowerCase().startsWith('en')
}

/** Whether the natural voice is installed and speaks this language. */
async function naturalReady(lang: string): Promise<boolean> {
  if (!naturalVoiceSpeaks(lang)) return false
  try { return !!(await voiceApi()?.status())?.installed } catch { return false }
}

let ensuring: Promise<boolean> | null = null

/**
 * Make sure the natural voice is installed, fetching it once if it is not.
 * Resolves true once it can read.
 *
 * Called as soon as a Listen button appears, so the download is usually done
 * before anyone presses one — the robotic system voice is what nobody asked
 * to hear. Skipped for good once the reader removes the voice. Concurrent
 * calls share one download (main dedupes it too); a failure is forgotten so
 * the next call retries.
 */
export function ensureNaturalVoice(): Promise<boolean> {
  const api = voiceApi()
  if (!api || loadBibleSettings().naturalVoiceDeclined) return Promise.resolve(false)
  if (!ensuring) {
    ensuring = (async () => {
      try {
        if ((await api.status())?.installed) return true
        return !!(await api.install())?.installed
      } catch {
        return false
      }
    })().then(ok => { if (!ok) ensuring = null; return ok })
  }
  return ensuring
}

/** Download progress of the natural voice, 0–1, while it is being fetched. */
export function onNaturalVoiceProgress(cb: (progress: number, installing: boolean) => void): () => void {
  const off = voiceApi()?.onProgress?.((s: any) => cb(s?.progress || 0, !!s?.installing))
  return typeof off === 'function' ? off : () => {}
}

/** Installed, being fetched, or neither. */
export async function naturalVoiceState(): Promise<'installed' | 'installing' | 'absent'> {
  try {
    const s = await voiceApi()?.status()
    return s?.installed ? 'installed' : s?.installing ? 'installing' : 'absent'
  } catch {
    return 'absent'
  }
}

interface Clip { samples: Float32Array; sampleRate: number }

async function synthesize(text: string, voice: string, speed: number): Promise<Clip | null> {
  try {
    const r = await voiceApi()?.speak(text, voice, speed)
    return r && r.samples && r.samples.length ? { samples: r.samples, sampleRate: r.sampleRate } : null
  } catch {
    return null
  }
}

/**
 * The natural voice. Each clause is synthesised in the utility process while
 * the one before it plays, two ahead, so the reading flows without gaps on a
 * laptop CPU (synthesis runs at about 0.65× real time).
 *
 * Resolves false if the very first clause fails, so the caller can fall back
 * to the system voice instead of reading nothing.
 */
async function speakNatural(chunks: string[], hasIntro: boolean, opts: SpeakOptions, isCancelled: () => boolean, register: (stop: () => void) => void): Promise<boolean> {
  const { readingVoice, readingPace } = loadBibleSettings()
  const ctx = new AudioContext()
  let source: AudioBufferSourceNode | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  register(() => {
    if (timer) clearTimeout(timer)
    try { source?.stop() } catch {}
    ctx.close().catch(() => {})
  })

  const AHEAD = 2
  const clips = new Map<number, Promise<Clip | null>>()
  const request = (i: number) => {
    if (i < chunks.length && !clips.has(i)) {
      clips.set(i, synthesize(chunks[i], readingVoice, naturalSpeed(i, chunks.length, readingPace)))
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    for (let k = i; k <= i + AHEAD; k++) request(k)
    let clip = await clips.get(i)!
    clips.delete(i)
    if (isCancelled()) return true
    // The first clause decides which voice reads the whole passage. One
    // transient failure (the voice process restarting, the model still
    // warming) is worth a second try before giving up to the robotic voice.
    if (!clip && i === 0) {
      clip = await synthesize(chunks[0], readingVoice, naturalSpeed(0, chunks.length, readingPace))
      if (isCancelled()) return true
    }
    if (!clip) {
      if (i === 0) { ctx.close().catch(() => {}); return false }
      continue // one bad clause should not end the reading
    }
    opts.onChunk?.(i, chunks.length)
    const buffer = ctx.createBuffer(1, clip.samples.length, clip.sampleRate)
    buffer.getChannelData(0).set(clip.samples)
    await new Promise<void>(resolve => {
      source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.onended = () => {
        source = null
        // The silence a reader leaves before the next clause.
        timer = setTimeout(resolve, pauseAfter(chunks[i], hasIntro && i === 0))
      }
      source.start()
    })
    if (isCancelled()) return true
  }
  ctx.close().catch(() => {})
  if (!isCancelled()) opts.onDone?.()
  return true
}

/** The system voice, paced clause by clause. */
async function speakSystem(chunks: string[], hasIntro: boolean, opts: SpeakOptions, isCancelled: () => boolean, register: (stop: () => void) => void) {
  const synth = window.speechSynthesis
  const voices = await loadVoices()
  const voice = pickVoice(voices, opts.lang || 'en')
  const { readingPace } = loadBibleSettings()
  let timer: ReturnType<typeof setTimeout> | null = null
  register(() => {
    if (timer) clearTimeout(timer)
    try { synth.cancel() } catch {}
  })

  let index = 0
  const next = () => {
    if (isCancelled()) return
    if (index >= chunks.length) { opts.onDone?.(); return }
    const i = index++
    const u = new SpeechSynthesisUtterance(chunks[i])
    if (voice) u.voice = voice as SpeechSynthesisVoice
    u.lang = voice?.lang || opts.lang || 'en-US'
    const { rate, pitch } = systemProsody(chunks[i], i, chunks.length, readingPace)
    u.rate = rate
    u.pitch = pitch
    opts.onChunk?.(i, chunks.length)
    u.onend = () => { timer = setTimeout(next, pauseAfter(chunks[i], hasIntro && i === 0)) }
    // An error on one clause must not silently end the reading — skip to the
    // next rather than leaving the button stuck showing "playing".
    u.onerror = next
    synth.speak(u)
  }
  next()
}

/**
 * Speak a passage. Returns a handle whose stop() is safe to call at any time,
 * including after the reading has already finished.
 */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<SpeechHandle> {
  current?.stop()
  const lang = opts.lang || 'en'
  const useNatural = await naturalReady(lang)
  if (!useNatural && !speechSupported()) return { stop: () => {} }
  if (speechSupported()) window.speechSynthesis.cancel()

  // Sentence-sized pieces suit the neural model, which phrases a whole
  // sentence far better than a fragment of one.
  const chunks = speechChunks(speakable(text), useNatural ? 240 : 180)
  const hasIntro = !!opts.intro
  if (opts.intro) chunks.unshift(spokenReference(opts.intro))
  if (!chunks.length) return { stop: () => {} }

  let cancelled = false
  let finished = false
  const stops: (() => void)[] = []
  // onDone fires exactly once: at the natural end, or when the reading is
  // stopped — including by another Listen button starting, so the first
  // button does not stay stuck on "Stop".
  const userDone = opts.onDone
  opts = { ...opts, onDone: () => { if (!finished) { finished = true; userDone?.() } } }
  const handle: SpeechHandle = {
    stop: () => {
      cancelled = true
      for (const s of stops.splice(0)) { try { s() } catch {} }
      if (current === handle) current = null
      opts.onDone?.()
    },
  }
  current = handle
  const isCancelled = () => cancelled
  const register = (s: () => void) => { if (cancelled) s(); else stops.push(s) }

  void (async () => {
    if (useNatural && await speakNatural(chunks, hasIntro, opts, isCancelled, register)) return
    if (cancelled) return
    if (speechSupported()) await speakSystem(chunks, hasIntro, opts, isCancelled, register)
    else opts.onDone?.()
  })()

  return handle
}

/** Stop anything currently being read, from anywhere in the app. */
export function stopSpeaking(): void {
  current?.stop()
  if (speechSupported()) {
    try { window.speechSynthesis.cancel() } catch {}
  }
}
