// Building a drill from a verse.
//
// Every exercise is made from the bundled text: the answer is the real verse,
// and the wrong options are other real verses from the same book. Nothing here
// invents scripture, and nothing here needs a model — the drill room works
// with the AI switched off, which is the whole point of authoring it this way.
//
// Difficulty rises with the box level, so a verse gets harder to answer as it
// gets better known: recognise it, then supply a word, then the first letters,
// then the order, then the whole thing from memory.

import type { Box } from './bibleSrs'

export type ExerciseType =
  | 'choose-text'
  | 'fill-blank'
  | 'first-letters'
  | 'scramble'
  | 'type-recall'

export interface QuizVerse { ref: string; text: string }

export interface Exercise {
  type: ExerciseType
  ref: string
  /** The full verse — the answer, and what is revealed after a response. */
  fullText: string
  /** One line telling the reader what this drill is asking of them. */
  instruction: string
  /** choose-text: four candidate verse texts, the real one among them. */
  options?: string[]
  /** choose-text: index into `options` that is correct. */
  answerIndex?: number
  /** fill-blank: the verse with one word replaced by a blank. */
  masked?: string
  /** fill-blank: the word that was removed. */
  missing?: string
  /** first-letters: `F__ G__ s_ l____ t__ w____,`. */
  skeleton?: string
  /** scramble: the phrases, shuffled. */
  phrases?: string[]
  /** scramble: the same phrases in their true order. */
  orderedPhrases?: string[]
}

const EXERCISE_BY_BOX: Record<Box, ExerciseType> = {
  1: 'choose-text',
  2: 'fill-blank',
  3: 'first-letters',
  4: 'scramble',
  5: 'type-recall',
}

export function exerciseForBox(box: Box): ExerciseType {
  return EXERCISE_BY_BOX[box] ?? 'choose-text'
}

// ── Deterministic randomness ────────────────────────────────────────────────
// A drill must not reshuffle underneath someone mid-session, and the same verse
// on the same day should present the same way if they come back to it. Both
// come free from seeding on the reference plus a caller-supplied seed.

export function seedFrom(...parts: (string | number)[]): number {
  let h = 0x811c9dc5
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** mulberry32 — small, fast, and good enough to shuffle four options. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], next: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── Text helpers ────────────────────────────────────────────────────────────

/** What two answers must share to count as the same. Case, punctuation and
 *  spacing are noise when someone is recalling a verse; the words are not. */
export function normalizeText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Words that carry no memory weight — never chosen as the missing word. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'but', 'not', 'you', 'your', 'that', 'this', 'with',
  'his', 'her', 'him', 'she', 'they', 'them', 'their', 'was', 'were', 'are',
  'have', 'has', 'had', 'will', 'shall', 'unto', 'from', 'into', 'upon',
  'all', 'any', 'who', 'whom', 'what', 'when', 'then', 'than', 'there',
  'shall', 'may', 'let', 'out', 'off', 'our', 'its', 'it', 'is', 'in', 'on',
  'of', 'to', 'a', 'as', 'at', 'be', 'by', 'do', 'he', 'if', 'me', 'my', 'no',
  'or', 'so', 'up', 'us', 'we',
])

/** Split keeping punctuation attached, so masking can put it back verbatim. */
function tokens(text: string): { word: string; lead: string; trail: string }[] {
  return String(text || '').split(/\s+/).filter(Boolean).map(raw => {
    const m = /^([^A-Za-z0-9]*)([A-Za-z0-9'’-]*)([^A-Za-z0-9]*)$/.exec(raw)
    return m ? { lead: m[1], word: m[2], trail: m[3] } : { lead: '', word: raw, trail: '' }
  })
}

/**
 * `For God so loved the world,` → `F__ G__ s_ l____ t__ w____,`
 *
 * Word count, word length and punctuation all survive: the skeleton has to be
 * enough of a scaffold that recall is possible, and a shape that lies about the
 * verse teaches the wrong thing.
 */
export function firstLetters(text: string): string {
  return tokens(text)
    .map(t => t.word
      ? `${t.lead}${t.word[0]}${'_'.repeat(Math.max(0, t.word.length - 1))}${t.trail}`
      : `${t.lead}${t.trail}`)
    .join(' ')
}

export const BLANK = '______'

/**
 * Remove one word worth removing.
 *
 * The longest non-stopword wins, ties broken by the seed, so the blank lands on
 * "loved" or "everlasting" rather than "the" — a blank you can fill without
 * knowing the verse is not a drill.
 */
export function blankKeyword(text: string, seed: number): { masked: string; missing: string } {
  const toks = tokens(text)
  const candidates = toks
    .map((t, i) => ({ i, w: t.word }))
    .filter(c => c.w.length >= 4 && !STOPWORDS.has(c.w.toLowerCase()))
  const pool = candidates.length ? candidates : toks.map((t, i) => ({ i, w: t.word })).filter(c => c.w)
  if (!pool.length) return { masked: text, missing: '' }

  const maxLen = Math.max(...pool.map(c => c.w.length))
  const longest = pool.filter(c => c.w.length === maxLen)
  const pick = longest[seed % longest.length]

  const masked = toks
    .map((t, i) => (i === pick.i ? `${t.lead}${BLANK}${t.trail}` : `${t.lead}${t.word}${t.trail}`))
    .join(' ')
  return { masked, missing: pick.w }
}

/**
 * Break a verse into phrases to put back in order.
 *
 * Punctuation first — that is how the verse actually reads. Verses without
 * internal punctuation get split into even runs of words instead, never into
 * one-word confetti (which is a jigsaw, not a memory exercise).
 */
export function splitPhrases(text: string, target = 4): string[] {
  const byPunct = String(text || '')
    .split(/(?<=[,;:—])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
  if (byPunct.length >= 3) return byPunct.slice(0, 6)

  const words = String(text || '').split(/\s+/).filter(Boolean)
  const parts = Math.max(2, Math.min(target, Math.ceil(words.length / 3)))
  const size = Math.ceil(words.length / parts)
  const out: string[] = []
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(' '))
  return out.length >= 2 ? out : [text]
}

// ── Building an exercise ────────────────────────────────────────────────────

const INSTRUCTIONS: Record<ExerciseType, string> = {
  'choose-text':   'Which of these is the verse?',
  'fill-blank':    'One word is missing. What is it?',
  'first-letters': 'Only the first letters are left. Say the verse.',
  'scramble':      'Put the phrases back in order.',
  'type-recall':   'Type the verse from memory.',
}

/**
 * Pick the wrong answers.
 *
 * Distractors come from the same book as the answer so the choice is between
 * real, plausible scripture — four verses in the same voice — rather than the
 * right verse next to three obvious pieces of filler. Verses of a wildly
 * different length are avoided for the same reason.
 */
export function pickDistractors(
  answer: QuizVerse, pool: QuizVerse[], count: number, next: () => number,
): QuizVerse[] {
  const target = answer.text.length
  const usable = pool
    .filter(v => v.ref !== answer.ref && v.text && normalizeText(v.text) !== normalizeText(answer.text))
    // Long enough to be a real verse, and in the same rough size class.
    .filter(v => v.text.length >= 25)
    .sort((a, b) => Math.abs(a.text.length - target) - Math.abs(b.text.length - target))
    .slice(0, Math.max(count * 4, 12))
  return shuffle(usable, next).slice(0, count)
}

export function buildExercise(
  verse: QuizVerse, pool: QuizVerse[], box: Box, seed = 0,
): Exercise {
  const type = exerciseForBox(box)
  const s = seedFrom(verse.ref, type, seed)
  const next = rng(s)
  const base: Exercise = {
    type, ref: verse.ref, fullText: verse.text, instruction: INSTRUCTIONS[type],
  }

  switch (type) {
    case 'choose-text': {
      const distractors = pickDistractors(verse, pool, 3, next)
      const options = shuffle([verse.text, ...distractors.map(d => d.text)], next)
      return { ...base, options, answerIndex: options.indexOf(verse.text) }
    }
    case 'fill-blank': {
      const { masked, missing } = blankKeyword(verse.text, s)
      return { ...base, masked, missing }
    }
    case 'first-letters':
      return { ...base, skeleton: firstLetters(verse.text) }
    case 'scramble': {
      const ordered = splitPhrases(verse.text)
      let phrases = shuffle(ordered, next)
      // A "shuffle" that happens to land in the right order is not a drill.
      if (ordered.length > 1 && phrases.every((p, i) => p === ordered[i])) {
        phrases = [...phrases.slice(1), phrases[0]]
      }
      return { ...base, phrases, orderedPhrases: ordered }
    }
    default:
      return base
  }
}

// ── Grading ─────────────────────────────────────────────────────────────────

/** Share of the answer's words the response got right, in order-free terms. */
export function similarity(response: string, answer: string): number {
  const a = normalizeText(answer).split(' ').filter(Boolean)
  const b = normalizeText(response).split(' ').filter(Boolean)
  if (!a.length) return 0
  const counts = new Map<string, number>()
  for (const w of a) counts.set(w, (counts.get(w) || 0) + 1)
  let hit = 0
  for (const w of b) {
    const n = counts.get(w) || 0
    if (n > 0) { counts.set(w, n - 1); hit++ }
  }
  // Penalise padding as well as omission, so pasting a whole chapter fails.
  return hit / Math.max(a.length, b.length)
}

/** Free recall passes on an exact normalised match, or a near-miss (a stray
 *  "the", a modernised spelling). Anything looser stops being memorisation. */
export const RECALL_THRESHOLD = 0.9

export function checkAnswer(ex: Exercise, response: string | string[] | number): boolean {
  switch (ex.type) {
    case 'choose-text':
      return typeof response === 'number' && response === ex.answerIndex
    case 'fill-blank':
      return typeof response === 'string' && normalizeText(response) === normalizeText(ex.missing || '')
    case 'scramble': {
      const given = Array.isArray(response) ? response : []
      const want = ex.orderedPhrases || []
      return given.length === want.length && given.every((p, i) => normalizeText(p) === normalizeText(want[i]))
    }
    case 'first-letters':
    case 'type-recall': {
      if (typeof response !== 'string') return false
      if (normalizeText(response) === normalizeText(ex.fullText)) return true
      return similarity(response, ex.fullText) >= RECALL_THRESHOLD
    }
    default:
      return false
  }
}
