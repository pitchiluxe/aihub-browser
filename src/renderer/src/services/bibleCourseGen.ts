// Generating a Classroom course with the model.
//
// The original design said no AI-authored lesson content at runtime. That rule
// is now deliberately relaxed, but the reason behind it has not gone away: a
// model asked for scripture will produce references that look right and are
// not. "Hebrews 13:9" for a verse that is actually 13:8, a Psalm 151, a
// chapter with more verses than it has. Shipped courses were verified by hand
// against the bundled text; a generated one cannot be.
//
// So the model is never trusted about scripture. It proposes; the bundled text
// decides. Every passage range and every memory reference is resolved against
// the actual verses before a course is allowed to exist, and a course carrying
// a reference that does not resolve is rejected rather than repaired — a
// lesson quietly re-pointed at a different verse than the one it teaches about
// is worse than no lesson.
//
// The model is genuinely useful for the part it is good at: the teaching prose
// and the shape of a course. It just does not get to be the authority on what
// the Bible says.

import type { Course, Lesson, Passage } from './bibleCourses'
import { validateCourse } from './bibleCourses'

/** A chapter's verse numbers, or null when the book/chapter does not exist. */
export type VerseResolver = (bookId: string, chapter: number) => Promise<number[] | null>

export const GENERATED_PREFIX = 'gen-'

/** Generated courses are marked in the id itself, so nothing else has to
 *  carry a flag to know a course was not authored and hand-checked. */
export function isGeneratedId(id: string): boolean {
  return String(id || '').startsWith(GENERATED_PREFIX)
}

export function generatedId(topic: string): string {
  const slug = String(topic || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'course'
  return `${GENERATED_PREFIX}${slug}-${Date.now().toString(36)}`
}

// Colours generated courses can take. Kept away from the shipped palette so a
// generated course is visually distinguishable from an authored one at a
// glance, without needing a badge to say so.
const GEN_ACCENTS = ['#8ea8c3', '#a89bb8', '#94b8a8', '#c3a68e', '#9aa8c9', '#b8a894']

export function accentFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return GEN_ACCENTS[h % GEN_ACCENTS.length]
}

// ── The prompt ──────────────────────────────────────────────────────────────

/**
 * What the model is asked for.
 *
 * The book-id table matters more than it looks: without it the model emits
 * "GEN"/"Gen"/"Genesis"/"Ge" interchangeably and roughly a third of the
 * passages fail to resolve for no reason other than naming. The instruction to
 * stay inside well-known chapters is there for the same reason — the further
 * into the minor prophets it reaches, the more it invents verse numbers.
 */
export function buildCoursePrompt(topic: string, existingTitles: string[] = []): string {
  const avoid = existingTitles.length
    ? `\n\nCourses that already exist — pick a genuinely different angle from all of these:\n${existingTitles.map(t => `- ${t}`).join('\n')}`
    : ''

  return `You are writing a study course for a Bible reading app. The translation is the World English Bible (WEB).

TOPIC: ${topic}

Return ONE JSON object and nothing else — no prose before or after, no markdown fence.

Shape:
{
  "title": "Short course title",
  "blurb": "One sentence, under 140 characters, saying what the course covers.",
  "lessons": [
    {
      "id": "01",
      "title": "Lesson title",
      "subtitle": "The passage in human form, e.g. Luke 15",
      "teaching": ["paragraph", "paragraph"],
      "passages": [
        { "bookId": "LUK", "chapter": 15, "from": 11, "to": 32, "label": "Luke 15:11-32" }
      ],
      "memory": ["LUK.15.20"]
    }
  ]
}

HARD RULES
1. Between 4 and 6 lessons. Lesson ids are "01", "02", … in order.
2. bookId is the three-character code from this list ONLY:
   GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA
   PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC
   MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM
   HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV
3. Every passage must be a real, continuous range that EXISTS. "to" must not be
   past the end of that chapter. If you are not certain a verse number exists,
   use a smaller range you are certain of. A wrong reference fails the whole
   course.
4. "memory" holds 1-2 references in BOOK.CHAPTER.VERSE form (e.g. "ROM.8.28"),
   and each must fall inside one of that lesson's own passages.
5. Each lesson has 2 or 3 teaching paragraphs. Each paragraph is at least 200
   characters of real prose — what the text says, and the historical setting it
   was written into. No bullet points, no headings, no filler.
6. Doctrinally neutral. Teach what the text says. Where Christian traditions
   differ materially, say that they differ and give the main views fairly
   rather than settling it.
7. Do not quote scripture at length in the teaching text — the app renders the
   passages itself from the real translation.${avoid}`
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Pull the course object out of whatever the model actually returned.
 *
 * Models wrap JSON in fences, prefix it with "Here is the course:", and append
 * a cheerful closing line, in any combination. Brace-matching from the first
 * `{` survives all of that, and survives braces inside string values, which a
 * greedy regex does not.
 */
export function parseCourseJson(raw: string): any | null {
  const text = String(raw || '')
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

/** Fill in what the app needs and the model was not asked for. */
export function shapeCourse(parsed: any, topic: string): Course | null {
  if (!parsed || typeof parsed !== 'object') return null
  const id = generatedId(parsed.title || topic)
  const lessons: Lesson[] = (Array.isArray(parsed.lessons) ? parsed.lessons : []).map((l: any, i: number) => ({
    id: typeof l?.id === 'string' && l.id ? l.id : String(i + 1).padStart(2, '0'),
    title: String(l?.title || '').trim(),
    subtitle: typeof l?.subtitle === 'string' ? l.subtitle : undefined,
    teaching: Array.isArray(l?.teaching) ? l.teaching.filter((p: any) => typeof p === 'string' && p.trim()) : [],
    passages: Array.isArray(l?.passages) ? l.passages.map(shapePassage).filter(Boolean) as Passage[] : [],
    memory: Array.isArray(l?.memory) ? l.memory.filter((r: any) => typeof r === 'string') : [],
  }))
  return {
    id,
    title: String(parsed.title || topic).trim().slice(0, 80),
    blurb: String(parsed.blurb || '').trim().slice(0, 200),
    accent: accentFor(id),
    lessons,
  }
}

function shapePassage(p: any): Passage | null {
  if (!p || typeof p !== 'object') return null
  const bookId = String(p.bookId || '').toUpperCase()
  const chapter = Number(p.chapter)
  const from = Number(p.from)
  const to = Number(p.to)
  if (!/^[A-Z0-9]{3}$/.test(bookId)) return null
  if (!Number.isInteger(chapter) || !Number.isInteger(from) || !Number.isInteger(to)) return null
  return {
    bookId, chapter, from, to,
    label: String(p.label || `${bookId} ${chapter}:${from}-${to}`).slice(0, 60),
  }
}

// ── Checking it against the actual Bible ────────────────────────────────────

/**
 * Every reference in the course, resolved against the bundled text.
 *
 * Returns a list of problems in plain sentences. Empty means every passage and
 * every memory verse in the course points at scripture that actually exists.
 *
 * The resolver is injected so this is testable without loading the Bible.
 */
export async function checkAgainstScripture(course: Course, resolve: VerseResolver): Promise<string[]> {
  const errors: string[] = []
  // Chapters are looked up once each; a six-lesson course otherwise re-reads
  // the same book a dozen times.
  const cache = new Map<string, number[] | null>()
  const chapterVerses = async (bookId: string, chapter: number) => {
    const key = `${bookId}.${chapter}`
    if (!cache.has(key)) cache.set(key, await resolve(bookId, chapter))
    return cache.get(key) ?? null
  }

  for (const lesson of course.lessons) {
    const where = `Lesson ${lesson.id} ("${lesson.title || '?'}")`
    const covered = new Set<string>()

    for (const p of lesson.passages) {
      const verses = await chapterVerses(p.bookId, p.chapter)
      if (!verses) { errors.push(`${where}: ${p.label} — ${p.bookId} ${p.chapter} does not exist.`); continue }
      if (p.from > p.to) { errors.push(`${where}: ${p.label} — the range runs backwards.`); continue }
      const present = new Set(verses)
      const missing: number[] = []
      for (let v = p.from; v <= p.to; v++) {
        if (present.has(v)) covered.add(`${p.bookId}.${p.chapter}.${v}`)
        else missing.push(v)
      }
      if (missing.length) {
        const last = verses[verses.length - 1]
        errors.push(`${where}: ${p.label} — verse${missing.length > 1 ? 's' : ''} ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''} do not exist (that chapter ends at ${last}).`)
      }
    }

    for (const ref of lesson.memory) {
      const m = /^([A-Z0-9]{3})\.(\d+)\.(\d+)$/.exec(ref)
      if (!m) { errors.push(`${where}: "${ref}" is not a reference.`); continue }
      const verses = await chapterVerses(m[1], Number(m[2]))
      if (!verses || !verses.includes(Number(m[3]))) {
        errors.push(`${where}: memory verse ${ref} does not exist.`)
        continue
      }
      // A memory verse outside the lesson's own reading is a quiz question
      // about something the lesson never showed you.
      if (!covered.has(ref)) errors.push(`${where}: memory verse ${ref} is not inside the lesson's passages.`)
    }
  }
  return errors
}

export interface GenerationResult {
  ok: boolean
  course?: Course
  /** Why it was rejected, in sentences fit to show the user. */
  errors?: string[]
}

/**
 * One end-to-end attempt: ask, parse, shape, validate, verify.
 *
 * `ask` is injected rather than imported so the whole pipeline can be tested
 * against canned model output.
 */
export async function generateCourse(
  topic: string,
  ask: (prompt: string) => Promise<string>,
  resolve: VerseResolver,
  existingTitles: string[] = [],
): Promise<GenerationResult> {
  let raw: string
  try {
    raw = await ask(buildCoursePrompt(topic, existingTitles))
  } catch {
    return { ok: false, errors: ['The AI provider could not be reached. Check Settings → AI.'] }
  }

  const parsed = parseCourseJson(raw)
  if (!parsed) return { ok: false, errors: ['The model did not return usable JSON. Try again.'] }

  const course = shapeCourse(parsed, topic)
  if (!course) return { ok: false, errors: ['The model returned JSON, but not a course.'] }

  // Structural check first — the same validator the shipped courses pass.
  const structural = validateCourse(course)
  if (structural.length) return { ok: false, errors: structural }

  // Then the one that matters: does the scripture it cites exist?
  const scripture = await checkAgainstScripture(course, resolve)
  if (scripture.length) return { ok: false, errors: scripture }

  return { ok: true, course }
}
