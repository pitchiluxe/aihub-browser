// Courses and reading plans — loading, validating, and tracking progress.
//
// Both ship as JSON assets rather than code, so a fourth course is a data
// change. Validation is therefore not optional: a malformed asset must be
// reported as a broken course, never rendered as an empty lesson that looks
// like the reader's fault.

import coursesAsset from '../assets/study/courses.json'
import plansAsset from '../assets/study/plans.json'

export interface Passage {
  bookId: string
  chapter: number
  from: number
  to: number
  /** How the passage is written for a human — "Luke 2:1–20". */
  label: string
}

export interface Lesson {
  id: string
  title: string
  subtitle?: string
  /** Paragraphs of teaching prose. */
  teaching: string[]
  passages: Passage[]
  /** Verses this lesson is worth remembering — the end-of-lesson quiz is
   *  built from these, and they are what "add to Lab" adds. */
  memory: string[]
}

export interface Course {
  id: string
  title: string
  blurb: string
  accent: string
  lessons: Lesson[]
}

export interface ReadingPlan {
  id: string
  title: string
  blurb: string
  /** One entry per day; each is a list of passages to read that day. */
  days: { label: string; passages: Passage[] }[]
}

// ── Validation ──────────────────────────────────────────────────────────────

function isPassage(p: any): p is Passage {
  return !!p
    && typeof p.bookId === 'string' && /^[A-Z0-9]{3}$/.test(p.bookId)
    && Number.isInteger(p.chapter) && p.chapter >= 1
    && Number.isInteger(p.from) && p.from >= 1
    && Number.isInteger(p.to) && p.to >= p.from
    && typeof p.label === 'string' && p.label.length > 0
}

const REF = /^[A-Z0-9]{3}\.\d+\.\d+$/

/** Every problem with a course, as sentences. Empty means it is usable. */
export function validateCourse(raw: any): string[] {
  const errors: string[] = []
  const where = raw?.id ? `course "${raw.id}"` : 'a course'
  if (!raw || typeof raw !== 'object') return [`${where} is not an object`]
  if (typeof raw.id !== 'string' || !raw.id) errors.push(`${where} has no id`)
  if (typeof raw.title !== 'string' || !raw.title) errors.push(`${where} has no title`)
  if (!Array.isArray(raw.lessons) || raw.lessons.length === 0) {
    errors.push(`${where} has no lessons`)
    return errors
  }
  const seen = new Set<string>()
  for (const lesson of raw.lessons) {
    const lw = `${where} lesson "${lesson?.id ?? '?'}"`
    if (typeof lesson?.id !== 'string' || !lesson.id) { errors.push(`${lw} has no id`); continue }
    if (seen.has(lesson.id)) errors.push(`${lw} is a duplicate id`)
    seen.add(lesson.id)
    if (typeof lesson.title !== 'string' || !lesson.title) errors.push(`${lw} has no title`)
    if (!Array.isArray(lesson.teaching) || !lesson.teaching.length) errors.push(`${lw} has no teaching text`)
    else if (lesson.teaching.some((t: any) => typeof t !== 'string' || !t.trim())) errors.push(`${lw} has an empty paragraph`)
    if (!Array.isArray(lesson.passages) || !lesson.passages.length) errors.push(`${lw} has no passages`)
    else if (!lesson.passages.every(isPassage)) errors.push(`${lw} has a malformed passage`)
    if (!Array.isArray(lesson.memory) || !lesson.memory.length) errors.push(`${lw} has no memory verses`)
    else if (!lesson.memory.every((r: any) => typeof r === 'string' && REF.test(r))) errors.push(`${lw} has a malformed memory reference`)
  }
  return errors
}

// ── Loading ─────────────────────────────────────────────────────────────────

let loaded: Course[] | null = null
let loadErrors: string[] = []

function load(): Course[] {
  if (loaded) return loaded
  const raw = (coursesAsset as any)?.courses
  const list = Array.isArray(raw) ? raw : []
  const good: Course[] = []
  for (const course of list) {
    const errors = validateCourse(course)
    // A broken course is dropped rather than half-rendered. Its errors are kept
    // so `courseLoadErrors()` can say so out loud instead of the room simply
    // looking emptier than it should.
    if (errors.length) { loadErrors = loadErrors.concat(errors); continue }
    good.push(course as Course)
  }
  loaded = good
  return good
}

export function getCourses(): Course[] {
  return load()
}

export function courseLoadErrors(): string[] {
  load()
  return loadErrors
}

export function getCourse(id: string): Course | undefined {
  return load().find(c => c.id === id)
}

export function getLesson(courseId: string, lessonId: string): Lesson | undefined {
  return getCourse(courseId)?.lessons.find(l => l.id === lessonId)
}

export function getPlans(): ReadingPlan[] {
  const raw = (plansAsset as any)?.plans
  return Array.isArray(raw) ? (raw as ReadingPlan[]) : []
}

export function getPlan(id: string): ReadingPlan | undefined {
  return getPlans().find(p => p.id === id)
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface LessonProgress { completedAt: number; score: number; total: number }
export type LessonBook = Record<string, LessonProgress>

/** The key a lesson's progress is stored under: `life-of-christ/03`. */
export function lessonKey(courseId: string, lessonId: string): string {
  return `${courseId}/${lessonId}`
}

export interface CourseProgress {
  done: number
  total: number
  /** 0–1. */
  fraction: number
  complete: boolean
  /** The next lesson to open, or null when the course is finished. */
  nextLessonId: string | null
}

export function courseProgress(course: Course, lessons: LessonBook | undefined): CourseProgress {
  const book = lessons || {}
  const total = course.lessons.length
  const done = course.lessons.filter(l => book[lessonKey(course.id, l.id)]?.completedAt).length
  const next = course.lessons.find(l => !book[lessonKey(course.id, l.id)]?.completedAt)
  return {
    done, total,
    fraction: total ? done / total : 0,
    complete: total > 0 && done === total,
    nextLessonId: next?.id ?? null,
  }
}

export function completedCourses(lessons: LessonBook | undefined): string[] {
  return load().filter(c => courseProgress(c, lessons).complete).map(c => c.id)
}

export function lessonsCompleted(lessons: LessonBook | undefined): number {
  return Object.values(lessons || {}).filter(p => p?.completedAt).length
}

/** Every verse a lesson asks the reader to remember, across a whole course. */
export function courseMemoryVerses(course: Course): string[] {
  return Array.from(new Set(course.lessons.flatMap(l => l.memory)))
}
