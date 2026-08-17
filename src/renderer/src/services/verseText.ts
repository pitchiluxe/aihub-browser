// Reading actual scripture out of the bundled books, for the study rooms.
//
// Everything here goes through bibleService's per-book lazy chunks, so a drill
// on one Psalm never loads the New Testament. The results are memoised because
// a drill session asks for the same book over and over — once for the answer,
// once for the distractor pool.

import { getBook, parseRef, type Verse } from './bibleService'
import type { QuizVerse } from './bibleQuiz'
import type { Passage } from './bibleCourses'

/** The text of a single verse, or '' when the reference does not resolve. */
export async function verseText(ref: string): Promise<string> {
  const parsed = parseRef(ref)
  if (!parsed) return ''
  try {
    const book = await getBook(parsed.bookId)
    const chapter = book.chapters[parsed.chapter - 1]
    return chapter?.find(v => v.v === parsed.verse)?.t || ''
  } catch {
    return ''
  }
}

export async function quizVerse(ref: string): Promise<QuizVerse | null> {
  const t = await verseText(ref)
  return t ? { ref, text: t } : null
}

export async function quizVerses(refs: string[]): Promise<QuizVerse[]> {
  const out = await Promise.all(refs.map(quizVerse))
  return out.filter((v): v is QuizVerse => !!v)
}

const poolCache = new Map<string, QuizVerse[]>()

/**
 * Candidate wrong answers: other verses from the same book.
 *
 * Same book, so the choice is between four passages in one voice. Very short
 * verses are dropped — "Jesus wept." next to three long ones gives the answer
 * away by shape alone.
 */
export async function distractorPool(bookId: string, limit = 400): Promise<QuizVerse[]> {
  const cached = poolCache.get(bookId)
  if (cached) return cached
  try {
    const book = await getBook(bookId)
    const out: QuizVerse[] = []
    book.chapters.forEach((chapter: Verse[], ci: number) => {
      for (const v of chapter) {
        if (v.t.length < 40) continue
        out.push({ ref: `${bookId}.${ci + 1}.${v.v}`, text: v.t })
      }
    })
    // Evenly sampled rather than the first N, so the pool is not all Genesis 1.
    const step = Math.max(1, Math.floor(out.length / limit))
    const sampled = out.filter((_, i) => i % step === 0).slice(0, limit)
    poolCache.set(bookId, sampled)
    return sampled
  } catch {
    return []
  }
}

/** Every verse of a lesson or plan passage, in order. */
export async function passageVerses(p: Passage): Promise<{ ref: string; v: number; t: string }[]> {
  try {
    const book = await getBook(p.bookId)
    const chapter = book.chapters[p.chapter - 1] || []
    return chapter
      .filter(v => v.v >= p.from && v.v <= p.to)
      .map(v => ({ ref: `${p.bookId}.${p.chapter}.${v.v}`, v: v.v, t: v.t }))
  } catch {
    return []
  }
}
