import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, GraduationCap, Loader2, Lock, Sparkles, Trash2, X } from 'lucide-react'
import {
  addCustomCourse, courseProgress, getCourses, lessonKey, onCoursesChanged, removeCustomCourse,
  type LessonBook, type Passage,
} from '../../services/bibleCourses'
import { generateCourse, isGeneratedId, type VerseResolver } from '../../services/bibleCourseGen'
import { getBook } from '../../services/bibleService'
import { streamChat } from '../../services/streamingChat'
import LessonView from './LessonView'

// Four across, five down. The catalogue outgrew a scrolling list, and a wall
// of twenty-plus cards is worse than a page of twenty you can hold in one
// glance — so the shelf is paged rather than made taller.
const PER_ROW = 4
const ROWS = 5
export const COURSES_PER_PAGE = PER_ROW * ROWS

interface Props {
  lessons: LessonBook
  inLab: (ref: string) => boolean
  onComplete: (courseId: string, lessonId: string, score: number, total: number) => void
  onAddToLab: (refs: string[]) => void
  onOpenReader: (ref: string) => void
  onReadPassages: (views: Passage[], focusRef?: string | null, index?: number) => void
  onAskAI?: (question: string) => void
}

// Three authored courses, six lessons each. The lessons are readable in any
// order — nothing is locked — because gating a devotional course behind a quiz
// score would be the wrong kind of pressure entirely.
export default function Classroom({ lessons, inLab, onComplete, onAddToLab, onOpenReader, onReadPassages, onAskAI }: Props) {
  // Re-read on change so a freshly generated course appears without a reload.
  const [revision, setRevision] = useState(0)
  useEffect(() => onCoursesChanged(() => setRevision(r => r + 1)), [])
  const courses = useMemo(() => getCourses(), [revision])
  const [generating, setGenerating] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [openCourse, setOpenCourse] = useState<string | null>(null)
  const [openLesson, setOpenLesson] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(courses.length / COURSES_PER_PAGE))
  // Clamped rather than trusted: a course removed from the JSON must not leave
  // the reader stranded on a page that no longer exists.
  const current = Math.min(page, pageCount - 1)
  const shown = useMemo(
    () => courses.slice(current * COURSES_PER_PAGE, current * COURSES_PER_PAGE + COURSES_PER_PAGE),
    [courses, current],
  )

  // The bundled text is the authority on what exists. The model proposes
  // references; this is what decides whether they are real.
  const resolveVerses: VerseResolver = useCallback(async (bookId, chapter) => {
    try {
      const book = await getBook(bookId)
      const ch = book.chapters[chapter - 1]
      return ch ? ch.map(v => v.v) : null
    } catch {
      return null
    }
  }, [])

  const [genError, setGenError] = useState<string[] | null>(null)

  const generate = useCallback(async (topic: string) => {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await generateCourse(
        topic,
        async prompt => {
          // preferCloud: the course has to come back as strict JSON, and small
          // local models fumble that badly enough to fail most attempts.
          const r = await streamChat([{ role: 'user', content: prompt }], { preferCloud: true }, () => {})
          return r?.content || ''
        },
        resolveVerses,
        courses.map(c => c.title),
      )
      if (res.ok && res.course) {
        addCustomCourse(res.course)
        setGenOpen(false)
        setPage(Math.floor(courses.length / COURSES_PER_PAGE))
      } else {
        setGenError(res.errors || ['The course could not be generated.'])
      }
    } finally {
      setGenerating(false)
    }
  }, [courses, resolveVerses])

  const course = courses.find(c => c.id === openCourse)
  const lesson = course?.lessons.find(l => l.id === openLesson)

  if (course && lesson) {
    return (
      <LessonView
        course={course}
        lesson={lesson}
        completed={!!lessons[lessonKey(course.id, lesson.id)]?.completedAt}
        inLab={inLab}
        onBack={() => setOpenLesson(null)}
        onComplete={(score, total) => onComplete(course.id, lesson.id, score, total)}
        onAddToLab={onAddToLab}
        onOpenReader={onOpenReader}
        onReadPassages={onReadPassages}
        onAskAI={onAskAI}
      />
    )
  }

  if (course) {
    const p = courseProgress(course, lessons)
    return (
      <div className="mx-auto w-full max-w-3xl">
        <button onClick={() => setOpenCourse(null)} className="mb-5 flex items-center gap-1.5 text-[11px] font-semibold opacity-55 hover:opacity-100">
          <ArrowLeft size={12} /> All courses
        </button>
        <h1 className="text-2xl font-bold" style={{ color: 'rgb(var(--ds-text-1, var(--ds-text-2)))' }}>{course.title}</h1>
        <p className="mt-1 mb-5 text-[13px] opacity-60">{course.blurb}</p>
        <ProgressBar fraction={p.fraction} accent={course.accent} label={`${p.done} of ${p.total} lessons`} />

        <div className="mt-6 flex flex-col gap-2">
          {course.lessons.map((l, i) => {
            const done = !!lessons[lessonKey(course.id, l.id)]?.completedAt
            return (
              <button key={l.id} onClick={() => setOpenLesson(l.id)}
                className="flex items-center gap-4 rounded-xl px-4 py-3.5 text-left transition-all"
                style={{
                  background: done ? `${course.accent}0e` : 'var(--ds-glass-xs)',
                  border: `1px solid ${done ? `${course.accent}30` : 'var(--ds-border-sm)'}`,
                }}>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
                  style={{ background: `${course.accent}1c`, color: course.accent }}>
                  {done ? <Check size={13} /> : i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold" style={{ color: 'rgb(var(--ds-text-2))' }}>{l.title}</div>
                  <div className="text-[11px] opacity-50">{l.subtitle} · {l.passages.map(p => p.label).join(' · ')}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'rgb(var(--ds-text-1, var(--ds-text-2)))' }}>Classroom</h1>
          <p className="mt-1 text-[13px] opacity-60">
            Work through a course at your own pace. Every lesson is teaching text, the passages it is about,
            and a short quiz built from the verses themselves.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {courses.length > 0 && (
            <div className="text-[11px] font-semibold opacity-45">
              {courses.length} courses · {courses.reduce((n, c) => n + c.lessons.length, 0)} lessons
            </div>
          )}
          <button onClick={() => { setGenError(null); setGenOpen(true) }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11.5px] font-semibold transition-all"
            style={{ background: 'rgba(167,139,250,0.14)', border: '1px solid rgba(167,139,250,0.32)', color: '#a78bfa' }}>
            <Sparkles size={13} /> Generate a course
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map(c => {
          const p = courseProgress(c, lessons)
          return (
            <button key={c.id} onClick={() => setOpenCourse(c.id)}
              className="group relative flex flex-col rounded-2xl p-4 text-left transition-all"
              style={{ background: `${c.accent}0c`, border: `1px solid ${c.accent}2a` }}>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ background: `${c.accent}1e`, color: c.accent }}>
                  {p.complete ? <Check size={17} /> : isGeneratedId(c.id) ? <Sparkles size={16} /> : <GraduationCap size={17} />}
                </div>
                {/* A generated course says so on its face. It was written by a
                    model and checked only for whether its references exist —
                    not for whether its teaching is any good. */}
                {isGeneratedId(c.id) && (
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                    style={{ background: 'rgba(167,139,250,0.16)', color: '#a78bfa' }}>AI</span>
                )}
                {isGeneratedId(c.id) && (
                  <span role="button" tabIndex={-1}
                    onClick={e => { e.stopPropagation(); removeCustomCourse(c.id) }}
                    title="Delete this course"
                    className="ml-auto rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100">
                    <Trash2 size={12} />
                  </span>
                )}
              </div>
              <div className="text-[13px] font-bold leading-snug" style={{ color: 'rgb(var(--ds-text-2))' }}>{c.title}</div>
              {/* Fixed-height blurb so the progress bars line up across a row
                  regardless of how long each course's description runs. */}
              <p className="mt-1 mb-3 line-clamp-3 min-h-[3.2em] text-[11px] leading-relaxed opacity-60">{c.blurb}</p>
              <div className="mt-auto">
                <ProgressBar fraction={p.fraction} accent={c.accent} label={`${p.done}/${p.total}`} compact />
              </div>
            </button>
          )
        })}
      </div>

      {pageCount > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0}
            title="Previous page"
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity disabled:opacity-25"
            style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: pageCount }, (_, i) => (
            <button key={i} onClick={() => setPage(i)}
              title={`Page ${i + 1}`}
              className="h-8 min-w-8 rounded-lg px-2.5 text-[11.5px] font-bold transition-all"
              style={i === current
                ? { background: 'rgba(230,200,110,0.16)', border: '1px solid rgba(230,200,110,0.32)', color: '#e6c86e' }
                : { background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-4))' }}>
              {i + 1}
            </button>
          ))}
          <button onClick={() => setPage(Math.min(pageCount - 1, current + 1))} disabled={current === pageCount - 1}
            title="Next page"
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity disabled:opacity-25"
            style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {genOpen && (
        <GenerateModal
          busy={generating}
          errors={genError}
          onClose={() => setGenOpen(false)}
          onGenerate={generate}
        />
      )}

      {courses.length === 0 && (
        <div className="rounded-2xl px-6 py-10 text-center"
          style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
          <Lock size={22} className="mx-auto mb-3 opacity-25" />
          <div className="text-sm font-semibold opacity-70">No courses could be loaded</div>
          <p className="mt-1 text-[12px] opacity-50">The course file shipped with this build could not be read.</p>
        </div>
      )}
    </div>
  )
}

function ProgressBar({ fraction, accent, label, compact }: {
  fraction: number; accent: string; label: string; compact?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--ds-glass-md)' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${Math.round(fraction * 100)}%`, background: accent }} />
      </div>
      <span className={`${compact ? 'text-[10.5px]' : 'text-[11px]'} font-semibold opacity-55`}>{label}</span>
    </div>
  )
}

// ── The generator ────────────────────────────────────────────────────────────

const TOPIC_IDEAS = [
  'The prayers of the Bible',
  'Money and generosity',
  'The women of the Gospels',
  'Rest and the Sabbath',
  'Forgiveness, from Joseph to the cross',
  'The prophets and justice',
  'Suffering and lament',
  'The kingdom parables',
]

function GenerateModal({ busy, errors, onClose, onGenerate }: {
  busy: boolean
  errors: string[] | null
  onClose: () => void
  onGenerate: (topic: string) => void
}) {
  const [topic, setTopic] = useState('')

  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-6"
      style={{ background: 'rgba(8,6,3,0.72)', backdropFilter: 'blur(8px)' }}
      onClick={() => { if (!busy) onClose() }}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl p-5"
        style={{ background: 'var(--ds-panel-bg)', border: '1px solid rgba(167,139,250,0.28)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}>

        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={16} style={{ color: '#a78bfa' }} />
          <div className="flex-1 text-sm font-bold" style={{ color: 'rgb(var(--ds-text-2))' }}>Generate a course</div>
          <button onClick={onClose} disabled={busy} className="opacity-50 hover:opacity-100 disabled:opacity-20">
            <X size={15} />
          </button>
        </div>
        <p className="mb-4 text-[11.5px] leading-relaxed opacity-55">
          The model writes the lessons. It does not get to decide what the Bible says —
          every passage and memory verse is checked against the bundled text first, and a
          course citing a verse that does not exist is rejected rather than patched.
        </p>

        <label className="mb-1.5 block text-[11px] font-semibold opacity-60">What should it be about?</label>
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && topic.trim() && !busy) onGenerate(topic.trim()) }}
          placeholder="e.g. The parables of Luke"
          disabled={busy}
          autoFocus
          className="w-full rounded-xl px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))', userSelect: 'text' }}
        />

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {TOPIC_IDEAS.map(t => (
            <button key={t} onClick={() => setTopic(t)} disabled={busy}
              className="rounded-lg px-2 py-1 text-[10.5px] transition-all disabled:opacity-40"
              style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-4))' }}>
              {t}
            </button>
          ))}
        </div>

        {errors && errors.length > 0 && (
          <div className="mt-4 rounded-xl p-3"
            style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.28)' }}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: '#f87171' }}>
              <AlertTriangle size={12} /> Not saved
            </div>
            <ul className="flex flex-col gap-1">
              {errors.slice(0, 5).map((e, i) => (
                <li key={i} className="text-[11px] leading-relaxed opacity-75">{e}</li>
              ))}
            </ul>
            <p className="mt-2 text-[10.5px] opacity-50">Try again — the next attempt usually lands.</p>
          </div>
        )}

        <button
          onClick={() => onGenerate(topic.trim())}
          disabled={busy || !topic.trim()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all disabled:opacity-35"
          style={{ background: 'rgba(167,139,250,0.20)', border: '1px solid rgba(167,139,250,0.38)', color: '#a78bfa' }}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> Writing and checking it…</> : <>Generate</>}
        </button>
        {busy && (
          <p className="mt-2 text-center text-[10.5px] opacity-45">
            This takes a while — the whole course is written in one pass.
          </p>
        )}
      </div>
    </div>
  )
}
