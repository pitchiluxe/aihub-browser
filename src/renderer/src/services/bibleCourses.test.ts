import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  completedCourses, courseLoadErrors, courseMemoryVerses, courseProgress,
  getCourse, getCourses, getLesson, getPlans, lessonKey, lessonsCompleted,
  validateCourse, type LessonBook,
} from './bibleCourses'
import { COURSE_BADGE_IDS } from './bibleRewards'

const BIBLE_DIR = join(process.cwd(), 'src/renderer/src/assets/bible')
const index = JSON.parse(readFileSync(join(BIBLE_DIR, 'index.json'), 'utf-8'))
const bookById = new Map<string, any>(index.books.map((b: any) => [b.id, b]))
const cache = new Map<string, any>()

function chapterOf(bookId: string, chapter: number): { v: number; t: string }[] | null {
  const meta = bookById.get(bookId)
  if (!meta) return null
  if (!cache.has(bookId)) {
    cache.set(bookId, JSON.parse(readFileSync(join(BIBLE_DIR, `${meta.slug}.json`), 'utf-8')))
  }
  return cache.get(bookId).chapters[chapter - 1] ?? null
}

describe('the shipped courses', () => {
  const courses = getCourses()

  it('loads every shipped course, with no validation errors', () => {
    expect(courseLoadErrors()).toEqual([])
    expect(courses.map(c => c.id).sort()).toEqual([
      '1corinthians', '1john', '1samuel', 'acts', 'daniel',
      'ecclesiastes', 'ephesians', 'exodus', 'genesis', 'hebrews',
      'isaiah', 'james', 'job', 'john', 'jonah',
      'life-of-christ', 'matthew', 'parables', 'philippians', 'proverbs',
      'psalms', 'revelation', 'romans', 'ruth',
    ])
  })

  it('gives every course a distinct accent colour', () => {
    const accents = courses.map(c => c.accent)
    expect(new Set(accents).size).toBe(accents.length)
  })

  it('gives every course between four and eight lessons', () => {
    // Not a fixed six: a short book like Ruth or Jonah has four natural
    // divisions and padding it out to six would invent lessons the text does
    // not support. The range still catches a course truncated by a bad edit.
    for (const c of courses) {
      expect(c.lessons.length, c.id).toBeGreaterThanOrEqual(4)
      expect(c.lessons.length, c.id).toBeLessThanOrEqual(8)
    }
  })

  it('gives every lesson real teaching prose, not a placeholder', () => {
    for (const c of courses) {
      for (const l of c.lessons) {
        expect(l.teaching.length).toBeGreaterThanOrEqual(2)
        for (const p of l.teaching) expect(p.trim().length).toBeGreaterThan(120)
      }
    }
  })

  it('resolves every passage in every lesson to real verses', () => {
    const broken: string[] = []
    for (const c of courses) {
      for (const l of c.lessons) {
        for (const p of l.passages) {
          const chapter = chapterOf(p.bookId, p.chapter)
          if (!chapter) { broken.push(`${c.id}/${l.id} ${p.label}: no chapter`); continue }
          const nums = new Set(chapter.map(v => v.v))
          for (let v = p.from; v <= p.to; v++) {
            if (!nums.has(v)) broken.push(`${c.id}/${l.id} ${p.label}: no verse ${v}`)
          }
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('resolves every memory verse in every lesson', () => {
    const broken: string[] = []
    for (const c of courses) {
      for (const l of c.lessons) {
        for (const ref of l.memory) {
          const [book, ch, v] = ref.split('.')
          const chapter = chapterOf(book, Number(ch))
          if (!chapter || !chapter.some(x => x.v === Number(v))) broken.push(`${c.id}/${l.id} ${ref}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('uses lesson ids that are unique inside their course', () => {
    for (const c of courses) {
      expect(new Set(c.lessons.map(l => l.id)).size).toBe(c.lessons.length)
    }
  })

  it('has a badge waiting for each course id, and no badge without a course', () => {
    // The badge ids in bibleRewards are `course-<id>`. A course added to the
    // JSON without a badge would silently award nothing on completion, and a
    // badge left behind by a renamed course could never be earned at all.
    expect(courses.map(c => c.id).sort()).toEqual([...COURSE_BADGE_IDS].sort())
  })
})

describe('validateCourse', () => {
  const good = getCourse('parables')!

  it('accepts a shipped course', () => {
    expect(validateCourse(good)).toEqual([])
  })

  it('rejects a course with no lessons', () => {
    expect(validateCourse({ id: 'x', title: 'X', lessons: [] })).toContain('course "x" has no lessons')
  })

  it('names a lesson missing its teaching text', () => {
    const bad = { ...good, id: 'bad', lessons: [{ ...good.lessons[0], teaching: [] }] }
    expect(validateCourse(bad).join(' ')).toMatch(/no teaching text/)
  })

  it('catches a malformed passage rather than rendering an empty reading', () => {
    const bad = { ...good, id: 'bad', lessons: [{ ...good.lessons[0], passages: [{ bookId: 'JHN', chapter: 3, from: 5, to: 2, label: 'x' }] }] }
    expect(validateCourse(bad).join(' ')).toMatch(/malformed passage/)
  })

  it('catches a memory reference that is not a reference', () => {
    const bad = { ...good, id: 'bad', lessons: [{ ...good.lessons[0], memory: ['John 3:16'] }] }
    expect(validateCourse(bad).join(' ')).toMatch(/malformed memory reference/)
  })

  it('catches duplicate lesson ids, which would collide in progress storage', () => {
    const bad = { ...good, id: 'bad', lessons: [good.lessons[0], good.lessons[0]] }
    expect(validateCourse(bad).join(' ')).toMatch(/duplicate id/)
  })
})

describe('progress', () => {
  const course = getCourse('life-of-christ')!
  const done = (n: number): LessonBook => Object.fromEntries(
    course.lessons.slice(0, n).map(l => [lessonKey(course.id, l.id), { completedAt: 1, score: 3, total: 3 }]),
  )

  it('counts nothing done on a fresh start and points at the first lesson', () => {
    const p = courseProgress(course, {})
    expect(p.done).toBe(0)
    expect(p.total).toBe(6)
    expect(p.complete).toBe(false)
    expect(p.nextLessonId).toBe(course.lessons[0].id)
  })

  it('points at the first unfinished lesson', () => {
    expect(courseProgress(course, done(2)).nextLessonId).toBe(course.lessons[2].id)
  })

  it('reports complete only when every lesson is done', () => {
    expect(courseProgress(course, done(5)).complete).toBe(false)
    const all = courseProgress(course, done(6))
    expect(all.complete).toBe(true)
    expect(all.fraction).toBe(1)
    expect(all.nextLessonId).toBeNull()
  })

  it('lists finished courses for the badge check', () => {
    expect(completedCourses(done(6))).toEqual(['life-of-christ'])
    expect(completedCourses(done(3))).toEqual([])
  })

  it('counts lessons across every course', () => {
    expect(lessonsCompleted(done(4))).toBe(4)
    expect(lessonsCompleted(undefined)).toBe(0)
  })

  it('handles an undefined progress book without throwing', () => {
    expect(courseProgress(course, undefined).done).toBe(0)
  })
})

describe('lookups and reading plans', () => {
  it('finds a lesson by course and id', () => {
    expect(getLesson('parables', '02')?.title).toMatch(/Prodigal/i)
    expect(getLesson('parables', 'nope')).toBeUndefined()
    expect(getCourse('nope')).toBeUndefined()
  })

  it('gathers the memory verses of a course without duplicates', () => {
    const verses = courseMemoryVerses(getCourse('psalms')!)
    expect(new Set(verses).size).toBe(verses.length)
    expect(verses.length).toBeGreaterThan(10)
  })

  it('ships reading plans whose every passage resolves', () => {
    const plans = getPlans()
    expect(plans.length).toBeGreaterThanOrEqual(3)
    const broken: string[] = []
    for (const plan of plans) {
      expect(plan.days.length).toBeGreaterThan(0)
      for (const day of plan.days) {
        for (const p of day.passages) {
          const chapter = chapterOf(p.bookId, p.chapter)
          if (!chapter) { broken.push(`${plan.id} ${p.label}`); continue }
          const nums = new Set(chapter.map(v => v.v))
          for (let v = p.from; v <= p.to; v++) if (!nums.has(v)) broken.push(`${plan.id} ${p.label}:${v}`)
        }
      }
    }
    expect(broken).toEqual([])
  })
})
