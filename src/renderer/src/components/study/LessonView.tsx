import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, Check, FlaskConical, Loader2, Sparkles } from 'lucide-react'
import type { Course, Lesson, Passage } from '../../services/bibleCourses'
import { formatRef, parseRef } from '../../services/bibleService'
import { buildExercise, checkAnswer, type Exercise } from '../../services/bibleQuiz'
import { distractorPool, passageVerses, quizVerses } from '../../services/verseText'
import { useBibleSettings } from '../../services/bibleSettings'

interface Props {
  course: Course
  lesson: Lesson
  completed: boolean
  inLab: (ref: string) => boolean
  onBack: () => void
  onComplete: (score: number, total: number) => void
  onAddToLab: (refs: string[]) => void
  onOpenReader: (ref: string) => void
  /** Opens the lesson's passages in the popup, starting at the one clicked. */
  onReadPassages: (views: Passage[], focusRef?: string | null, index?: number) => void
  onAskAI?: (question: string) => void
}

type Stage = 'read' | 'quiz' | 'done'

// A lesson is teaching text, the passages it is about, and a short quiz built
// from the verses it asked you to remember. The quiz is generated from the
// bundled scripture, never written by a model — the wrong answers are other
// real verses from the same book.
export default function LessonView({
  course, lesson, completed, inLab, onBack, onComplete, onAddToLab, onOpenReader, onReadPassages, onAskAI,
}: Props) {
  const [settings] = useBibleSettings()
  const [stage, setStage] = useState<Stage>('read')
  const [passages, setPassages] = useState<Record<string, { ref: string; v: number; t: string }[]>>({})
  const [quiz, setQuiz] = useState<Exercise[] | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    let live = true
    setStage('read'); setQuiz(null); setAnswers([]); setRevealed(false); setPassages({})
    ;(async () => {
      const entries = await Promise.all(
        lesson.passages.map(async p => [p.label, await passageVerses(p)] as const),
      )
      if (live) setPassages(Object.fromEntries(entries))
    })()
    return () => { live = false }
  }, [course.id, lesson.id])

  const startQuiz = async () => {
    setStage('quiz')
    if (quiz) return
    const verses = await quizVerses(lesson.memory)
    const pools = await Promise.all(verses.map(v => {
      const parsed = parseRef(v.ref)
      return parsed ? distractorPool(parsed.bookId) : Promise.resolve([])
    }))
    // Box 1 for everyone: this is a check that you read the lesson, not a
    // memory test. The Lab is where a verse gets harder over time.
    setQuiz(verses.map((v, i) => buildExercise(v, pools[i], 1, i)))
    setAnswers(new Array(verses.length).fill(-1))
  }

  const score = useMemo(
    () => (quiz || []).reduce((n, ex, i) => n + (checkAnswer(ex, answers[i]) ? 1 : 0), 0),
    [quiz, answers],
  )

  const finish = () => {
    setRevealed(true)
    setStage('done')
    onComplete(score, quiz?.length || 0)
  }

  const memoryNotInLab = lesson.memory.filter(r => !inLab(r))

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <button onClick={onBack} className="mb-5 flex items-center gap-1.5 text-[11px] font-semibold opacity-55 hover:opacity-100">
        <ArrowLeft size={12} /> {course.title}
      </button>

      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: course.accent }}>
        {lesson.subtitle || `Lesson ${lesson.id}`}
      </div>
      <h1 className="mb-6 text-2xl font-bold" style={{ color: 'rgb(var(--ds-text-1, var(--ds-text-2)))' }}>
        {lesson.title}
      </h1>

      {stage === 'read' && (
        <>
          <div className="selectable-text flex flex-col gap-4">
            {lesson.teaching.map((para, i) => (
              <p key={i} style={{ fontSize: 14.5, lineHeight: 1.8, color: 'rgb(var(--ds-text-2))' }}>{para}</p>
            ))}
          </div>

          <div className="mt-8 mb-2 text-[11px] font-bold uppercase tracking-[0.16em] opacity-45">Read</div>
          <div className="flex flex-col gap-4">
            {/* Scripture in a lesson is scripture, so it gets the reader's own
                page — same paper, same serif column, same font-scale and
                justification the reader set. A lesson that renders verses as
                chrome-coloured body text quietly says they are just more of the
                lesson's prose, and they are not. */}
            {lesson.passages.map((p, pi) => (
              <div key={p.label} className="overflow-hidden rounded-2xl"
                style={{ border: '1px solid var(--ds-border-sm)' }}>
                <div className="flex items-center justify-between px-4 py-2"
                  style={{ background: 'var(--ds-glass-xs)' }}>
                  <div className="text-xs font-bold" style={{ color: course.accent }}>{p.label}</div>
                  <div className="flex gap-1.5">
                    <button onClick={() => onReadPassages(lesson.passages, null, pi)}
                      title="Read it on the page"
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold opacity-60 hover:opacity-100"
                      style={{ border: '1px solid var(--ds-border-sm)' }}>
                      <BookOpen size={11} /> Read it
                    </button>
                    {onAskAI && (
                      <button onClick={() => onAskAI(`Explain ${p.label} — what does it mean and what was going on when it was written?`)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold opacity-60 hover:opacity-100"
                        style={{ border: '1px solid var(--ds-border-sm)' }}>
                        <Sparkles size={11} /> Explain
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={settings.paper === 'clean' ? 'bible-paper bible-paper-clean' : 'bible-paper'}
                  style={{
                    padding: '22px 26px',
                    ['--bible-font-scale' as any]: settings.fontScale * 0.94,
                    ['--bible-align' as any]: settings.justify ? 'justify' : 'left',
                  }}
                >
                  {passages[p.label] ? (
                    <div className="bible-prose">
                      {passages[p.label].map(v => (
                        <span key={v.ref}>
                          {settings.verseNumbers && <sup className="mr-0.5 select-none opacity-50">{v.v}</sup>}
                          {v.t}{' '}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-3 text-xs" style={{ color: 'rgba(80,58,30,0.7)' }}>
                      <Loader2 size={12} className="animate-spin" /> Loading the passage…
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button onClick={startQuiz}
            className="mt-8 w-full rounded-2xl py-3.5 text-sm font-bold"
            style={{ background: `${course.accent}22`, border: `1px solid ${course.accent}45`, color: course.accent }}>
            {completed ? 'Take the quiz again' : 'I have read it — take the quiz'}
          </button>
        </>
      )}

      {stage !== 'read' && (
        <>
          {!quiz ? (
            <div className="flex items-center gap-2 py-8 text-sm opacity-60">
              <Loader2 size={14} className="animate-spin" /> Building the quiz from this lesson's verses…
            </div>
          ) : (
            <>
              <div className="mb-5 text-[13px] opacity-60">
                {revealed
                  ? `${score} of ${quiz.length} right.`
                  : 'Which verse is which? Every option is a real verse from the same book.'}
              </div>
              <div className="flex flex-col gap-6">
                {quiz.map((ex, qi) => (
                  <div key={ex.ref}>
                    <button onClick={() => onOpenReader(ex.ref)} title="Read it on the page"
                      className="mb-2 text-xs font-bold" style={{ color: course.accent }}>
                      {formatRef(ex.ref)}
                    </button>
                    <div className="flex flex-col gap-2">
                      {ex.options!.map((opt, oi) => {
                        const chosen = answers[qi] === oi
                        const isAnswer = oi === ex.answerIndex
                        return (
                          <button key={oi}
                            onClick={() => {
                              if (revealed) return
                              setAnswers(a => a.map((v, i) => (i === qi ? oi : v)))
                            }}
                            className="selectable-text rounded-xl px-4 py-2.5 text-left text-[12.5px] leading-relaxed"
                            style={{
                              background: revealed && isAnswer ? 'rgba(52,211,153,0.12)'
                                : revealed && chosen ? 'rgba(248,113,113,0.10)'
                                : chosen ? `${course.accent}18` : 'var(--ds-glass-sm)',
                              border: `1px solid ${revealed && isAnswer ? 'rgba(52,211,153,0.4)'
                                : revealed && chosen ? 'rgba(248,113,113,0.35)'
                                : chosen ? `${course.accent}45` : 'var(--ds-border-sm)'}`,
                              color: 'rgb(var(--ds-text-2))',
                            }}>
                            {opt}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {!revealed ? (
                <button onClick={finish}
                  disabled={answers.some(a => a < 0)}
                  className="mt-8 w-full rounded-2xl py-3.5 text-sm font-bold disabled:opacity-35"
                  style={{ background: `${course.accent}22`, border: `1px solid ${course.accent}45`, color: course.accent }}>
                  Finish the lesson
                </button>
              ) : (
                <div className="mt-8 rounded-2xl p-5"
                  style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.22)' }}>
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold" style={{ color: '#34d399' }}>
                    <Check size={15} /> Lesson finished
                  </div>
                  <p className="mb-4 text-[12.5px] leading-relaxed opacity-70">
                    {memoryNotInLab.length
                      ? `This lesson's verses can go into the Lab, where they will come back on a schedule until you know them.`
                      : `Its verses are already in the Lab.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {memoryNotInLab.length > 0 && (
                      <button onClick={() => onAddToLab(memoryNotInLab)}
                        className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
                        style={{ background: 'rgba(230,200,110,0.16)', border: '1px solid rgba(230,200,110,0.32)', color: '#e6c86e' }}>
                        <FlaskConical size={13} /> Add {memoryNotInLab.length} verse{memoryNotInLab.length === 1 ? '' : 's'} to the Lab
                      </button>
                    )}
                    <button onClick={onBack}
                      className="rounded-xl px-3.5 py-2 text-xs font-semibold"
                      style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
                      Back to the course
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
