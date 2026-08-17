import { describe, it, expect } from 'vitest'
import {
  accentFor, buildCoursePrompt, checkAgainstScripture, generateCourse,
  generatedId, isGeneratedId, parseCourseJson, shapeCourse,
  type VerseResolver,
} from './bibleCourseGen'
import type { Course } from './bibleCourses'

// A tiny stand-in Bible: John 3 has 36 verses, Romans 8 has 39, nothing else
// exists. Injected so the pipeline can be tested without loading real books.
const BIBLE: Record<string, number> = { 'JHN.3': 36, 'ROM.8': 39, 'LUK.15': 32 }
const resolve: VerseResolver = async (bookId, chapter) => {
  const n = BIBLE[`${bookId}.${chapter}`]
  return n ? Array.from({ length: n }, (_, i) => i + 1) : null
}

const goodCourse = (): Course => ({
  id: 'gen-test-1',
  title: 'A Generated Course',
  blurb: 'Something short.',
  accent: '#8ea8c3',
  lessons: [{
    id: '01',
    title: 'The Prodigal',
    teaching: ['x'.repeat(220), 'y'.repeat(220)],
    passages: [{ bookId: 'LUK', chapter: 15, from: 11, to: 32, label: 'Luke 15:11-32' }],
    memory: ['LUK.15.20'],
  }],
})

describe('generated ids', () => {
  it('marks a generated course in the id itself', () => {
    expect(isGeneratedId(generatedId('Faith and Doubt'))).toBe(true)
    expect(isGeneratedId('life-of-christ')).toBe(false)
  })

  it('slugs the topic and stays unique per call', async () => {
    const a = generatedId('Faith & Doubt!')
    expect(a).toMatch(/^gen-faith-doubt-/)
    await new Promise(r => setTimeout(r, 2))
    expect(generatedId('Faith & Doubt!')).not.toBe(a)
  })

  it('falls back to a usable id when the topic has no letters', () => {
    expect(generatedId('!!!')).toMatch(/^gen-course-/)
  })

  it('gives a stable accent for a given id', () => {
    expect(accentFor('gen-a')).toBe(accentFor('gen-a'))
  })
})

describe('the prompt', () => {
  it('names the topic and pins the book-id vocabulary', () => {
    // Without the id table the model mixes GEN/Gen/Genesis/Ge and a third of
    // the passages fail to resolve for no reason other than naming.
    const p = buildCoursePrompt('The Psalms of Ascent')
    expect(p).toContain('The Psalms of Ascent')
    expect(p).toContain('PSA')
    expect(p).toContain('BOOK.CHAPTER.VERSE')
  })

  it('lists existing titles so a new course is not a duplicate', () => {
    const p = buildCoursePrompt('Grace', ['Romans: The Gospel, Argued'])
    expect(p).toContain('Romans: The Gospel, Argued')
  })
})

describe('parsing what the model returned', () => {
  it('reads a bare JSON object', () => {
    expect(parseCourseJson('{"title":"A"}')).toEqual({ title: 'A' })
  })

  it('reads through a markdown fence and a chatty preamble', () => {
    const raw = 'Sure! Here is the course:\n```json\n{"title":"A"}\n```\nHope that helps!'
    expect(parseCourseJson(raw)).toEqual({ title: 'A' })
  })

  it('is not fooled by a brace inside a string value', () => {
    expect(parseCourseJson('{"blurb":"a } brace","n":1}')).toEqual({ blurb: 'a } brace', n: 1 })
  })

  it('returns null on truncated or absent JSON rather than throwing', () => {
    expect(parseCourseJson('{"title":')).toBeNull()
    expect(parseCourseJson('no json at all')).toBeNull()
    expect(parseCourseJson('')).toBeNull()
  })
})

describe('shaping', () => {
  it('fills in id, accent and lesson numbering the model was not asked for', () => {
    const c = shapeCourse({ title: 'T', blurb: 'B', lessons: [{ title: 'L', teaching: ['p'], passages: [], memory: [] }] }, 'topic')
    expect(c!.id).toMatch(/^gen-/)
    expect(c!.accent).toMatch(/^#/)
    expect(c!.lessons[0].id).toBe('01')
  })

  it('drops a malformed passage instead of carrying it forward', () => {
    const c = shapeCourse({
      title: 'T', lessons: [{ title: 'L', teaching: ['p'], memory: [], passages: [
        { bookId: 'Genesis', chapter: 1, from: 1, to: 3 },   // not a 3-char id
        { bookId: 'GEN', chapter: 1, from: 1, to: 3, label: 'Genesis 1:1-3' },
      ] }],
    }, 'topic')
    expect(c!.lessons[0].passages).toHaveLength(1)
    expect(c!.lessons[0].passages[0].bookId).toBe('GEN')
  })

  it('upper-cases a lowercase book id rather than failing it', () => {
    const c = shapeCourse({ title: 'T', lessons: [{ title: 'L', teaching: ['p'], memory: [], passages: [{ bookId: 'gen', chapter: 1, from: 1, to: 2 }] }] }, 't')
    expect(c!.lessons[0].passages[0].bookId).toBe('GEN')
  })
})

describe('checking against the actual Bible', () => {
  it('passes a course whose every reference resolves', async () => {
    expect(await checkAgainstScripture(goodCourse(), resolve)).toEqual([])
  })

  it('catches a verse past the end of the chapter', async () => {
    // The failure mode this whole module exists for: a plausible-looking
    // reference to a verse that is not there.
    const c = goodCourse()
    c.lessons[0].passages[0].to = 40
    const errors = await checkAgainstScripture(c, resolve)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('do not exist')
    expect(errors[0]).toContain('ends at 32')
  })

  it('catches a book or chapter that does not exist', async () => {
    const c = goodCourse()
    c.lessons[0].passages[0] = { bookId: 'PSA', chapter: 151, from: 1, to: 3, label: 'Psalm 151' }
    const errors = await checkAgainstScripture(c, resolve)
    expect(errors[0]).toContain('does not exist')
  })

  it('catches a backwards range', async () => {
    const c = goodCourse()
    c.lessons[0].passages[0].from = 30
    c.lessons[0].passages[0].to = 11
    expect((await checkAgainstScripture(c, resolve))[0]).toContain('runs backwards')
  })

  it('catches a memory verse that does not exist', async () => {
    const c = goodCourse()
    c.lessons[0].memory = ['LUK.15.99']
    expect((await checkAgainstScripture(c, resolve))[0]).toContain('does not exist')
  })

  it('catches a memory verse outside the lesson’s own reading', async () => {
    // A quiz question about something the lesson never showed you.
    const c = goodCourse()
    c.lessons[0].memory = ['JHN.3.16']
    expect((await checkAgainstScripture(c, resolve))[0]).toContain('not inside')
  })

  it('catches a memory entry that is not a reference at all', async () => {
    const c = goodCourse()
    c.lessons[0].memory = ['John 3:16']
    expect((await checkAgainstScripture(c, resolve))[0]).toContain('is not a reference')
  })
})

describe('the whole pipeline', () => {
  const model = (json: unknown) => async () => JSON.stringify(json)

  const payload = (over: Record<string, unknown> = {}) => ({
    title: 'The Lost and Found',
    blurb: 'One parable, read closely.',
    lessons: [{
      id: '01',
      title: 'The Prodigal',
      subtitle: 'Luke 15',
      teaching: ['a'.repeat(220), 'b'.repeat(220)],
      passages: [{ bookId: 'LUK', chapter: 15, from: 11, to: 32, label: 'Luke 15:11-32' }],
      memory: ['LUK.15.20'],
    }],
    ...over,
  })

  it('returns a usable course when the model behaves', async () => {
    const res = await generateCourse('parables', model(payload()), resolve)
    expect(res.ok).toBe(true)
    expect(res.course!.title).toBe('The Lost and Found')
    expect(res.course!.id).toMatch(/^gen-/)
  })

  it('rejects the course when a reference does not resolve', async () => {
    const bad = payload({
      lessons: [{
        id: '01', title: 'T', teaching: ['a'.repeat(220), 'b'.repeat(220)],
        passages: [{ bookId: 'LUK', chapter: 15, from: 11, to: 99, label: 'Luke 15:11-99' }],
        memory: ['LUK.15.20'],
      }],
    })
    const res = await generateCourse('parables', model(bad), resolve)
    expect(res.ok).toBe(false)
    // Rejected, not silently repaired: a lesson re-pointed at a different
    // verse than the one it teaches about is worse than no lesson.
    expect(res.course).toBeUndefined()
    expect(res.errors!.join(' ')).toContain('do not exist')
  })

  it('rejects a course that fails the structural validator', async () => {
    const res = await generateCourse('x', model(payload({ lessons: [] })), resolve)
    expect(res.ok).toBe(false)
    expect(res.errors!.length).toBeGreaterThan(0)
  })

  it('reports unusable model output rather than throwing', async () => {
    const res = await generateCourse('x', async () => 'I am afraid I cannot do that.', resolve)
    expect(res.ok).toBe(false)
    expect(res.errors![0]).toContain('usable JSON')
  })

  it('reports a provider failure in words the user can act on', async () => {
    const res = await generateCourse('x', async () => { throw new Error('ECONNREFUSED') }, resolve)
    expect(res.ok).toBe(false)
    expect(res.errors![0]).toContain('Settings')
  })
})
