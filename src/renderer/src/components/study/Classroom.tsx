import React, { useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, GraduationCap, Lock } from 'lucide-react'
import { courseProgress, getCourses, lessonKey, type LessonBook, type Passage } from '../../services/bibleCourses'
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
  const courses = getCourses()
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
        {courses.length > 0 && (
          <div className="text-[11px] font-semibold opacity-45">
            {courses.length} courses · {courses.reduce((n, c) => n + c.lessons.length, 0)} lessons
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map(c => {
          const p = courseProgress(c, lessons)
          return (
            <button key={c.id} onClick={() => setOpenCourse(c.id)}
              className="flex flex-col rounded-2xl p-4 text-left transition-all"
              style={{ background: `${c.accent}0c`, border: `1px solid ${c.accent}2a` }}>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ background: `${c.accent}1e`, color: c.accent }}>
                {p.complete ? <Check size={17} /> : <GraduationCap size={17} />}
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
