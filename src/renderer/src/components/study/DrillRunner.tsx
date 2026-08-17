import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Loader2, X } from 'lucide-react'
import { formatRef, parseRef } from '../../services/bibleService'
import { buildExercise, checkAnswer, type Exercise } from '../../services/bibleQuiz'
import { distractorPool, quizVerse } from '../../services/verseText'
import type { Box } from '../../services/bibleSrs'

interface Props {
  /** The queue, in the order the scheduler handed it over. */
  queue: { ref: string; box: Box }[]
  /** Stable per session, so a card does not reshuffle if the panel re-renders. */
  seed: number
  onGrade: (ref: string, correct: boolean) => void
  onDone: (result: { answered: number; correct: number }) => void
  onQuit: () => void
}

// One card at a time. No timer, no failure sound, no streak-loss messaging —
// a missed verse simply comes back tomorrow, and the drill should feel like
// devotion rather than an exam.
export default function DrillRunner({ queue, seed, onGrade, onDone, onQuit }: Props) {
  const [index, setIndex] = useState(0)
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [loading, setLoading] = useState(true)
  const [typed, setTyped] = useState('')
  const [chosen, setChosen] = useState<number | null>(null)
  const [order, setOrder] = useState<string[]>([])
  const [verdict, setVerdict] = useState<null | boolean>(null)
  const [correctCount, setCorrectCount] = useState(0)

  const current = queue[index]

  useEffect(() => {
    if (!current) return
    let live = true
    setLoading(true)
    setExercise(null)
    setTyped(''); setChosen(null); setOrder([]); setVerdict(null)
    ;(async () => {
      const parsed = parseRef(current.ref)
      const [verse, pool] = await Promise.all([
        quizVerse(current.ref),
        parsed ? distractorPool(parsed.bookId) : Promise.resolve([]),
      ])
      if (!live) return
      if (!verse) {
        // The verse no longer resolves (a reference saved by an older build).
        // Skip it rather than showing an empty card.
        setLoading(false)
        next(false, true)
        return
      }
      const ex = buildExercise(verse, pool, current.box, seed)
      setExercise(ex)
      setOrder(ex.phrases || [])
      setLoading(false)
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.ref])

  const response = useMemo(() => {
    if (!exercise) return ''
    switch (exercise.type) {
      case 'choose-text': return chosen ?? -1
      case 'scramble':    return order
      default:            return typed
    }
  }, [exercise, chosen, order, typed])

  const canSubmit = exercise
    ? exercise.type === 'choose-text' ? chosen !== null
      : exercise.type === 'scramble' ? order.length === (exercise.orderedPhrases?.length || 0)
      : typed.trim().length > 0
    : false

  const submit = () => {
    if (!exercise || verdict !== null) return
    const ok = checkAnswer(exercise, response as any)
    setVerdict(ok)
    if (ok) setCorrectCount(c => c + 1)
    onGrade(exercise.ref, ok)
  }

  const next = (_ok = false, skipped = false) => {
    const answered = index + (skipped ? 0 : 1)
    if (index + 1 >= queue.length) {
      onDone({ answered, correct: correctCount })
      return
    }
    setIndex(i => i + 1)
  }

  const movePhrase = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return
    const copy = order.slice()
    const [item] = copy.splice(from, 1)
    copy.splice(to, 0, item)
    setOrder(copy)
  }

  if (!current) return null

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-50">
          Verse {index + 1} of {queue.length}
        </div>
        <button onClick={onQuit} className="rounded-lg px-2 py-1 text-[11px] opacity-55 hover:opacity-100">
          Finish later
        </button>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--ds-glass-sm)' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${(index / queue.length) * 100}%`, background: '#e6c86e' }} />
      </div>

      <div className="mt-6 rounded-2xl p-6"
        style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>

        {loading || !exercise ? (
          <div className="flex items-center gap-2 py-10 text-sm opacity-60">
            <Loader2 size={14} className="animate-spin" /> Loading the verse…
          </div>
        ) : (
          <>
            <div className="mb-1 text-sm font-bold" style={{ color: '#e6c86e' }}>{formatRef(exercise.ref)}</div>
            <div className="mb-5 text-[13px] opacity-65">{exercise.instruction}</div>

            {exercise.type === 'choose-text' && (
              <div className="flex flex-col gap-2">
                {exercise.options!.map((opt, i) => {
                  const isChosen = chosen === i
                  const reveal = verdict !== null
                  const isAnswer = i === exercise.answerIndex
                  return (
                    <button
                      key={i}
                      onClick={() => verdict === null && setChosen(i)}
                      className="selectable-text rounded-xl px-4 py-3 text-left text-[13px] leading-relaxed transition-all"
                      style={{
                        background: reveal && isAnswer ? 'rgba(52,211,153,0.12)'
                          : reveal && isChosen ? 'rgba(248,113,113,0.10)'
                          : isChosen ? 'rgba(230,200,110,0.12)' : 'var(--ds-glass-sm)',
                        border: `1px solid ${reveal && isAnswer ? 'rgba(52,211,153,0.4)'
                          : reveal && isChosen ? 'rgba(248,113,113,0.35)'
                          : isChosen ? 'rgba(230,200,110,0.35)' : 'var(--ds-border-sm)'}`,
                        color: 'rgb(var(--ds-text-2))',
                      }}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            )}

            {exercise.type === 'fill-blank' && (
              <>
                <p className="selectable-text mb-4 text-[15px] leading-relaxed"
                  style={{ fontFamily: 'Georgia, serif', color: 'rgb(var(--ds-text-2))' }}>
                  {exercise.masked}
                </p>
                <input
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') (verdict === null ? submit() : next()) }}
                  placeholder="The missing word…"
                  disabled={verdict !== null}
                  autoFocus
                  className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))', userSelect: 'text' }}
                />
              </>
            )}

            {(exercise.type === 'first-letters' || exercise.type === 'type-recall') && (
              <>
                {exercise.skeleton && (
                  <p className="mb-4 text-[15px] leading-loose"
                    style={{ fontFamily: 'ui-monospace, Consolas, monospace', color: 'rgb(var(--ds-text-3))', letterSpacing: '0.03em' }}>
                    {exercise.skeleton}
                  </p>
                )}
                <textarea
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  rows={4}
                  placeholder="Type it out…"
                  disabled={verdict !== null}
                  autoFocus
                  className="w-full resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))', userSelect: 'text' }}
                />
              </>
            )}

            {exercise.type === 'scramble' && (
              <div className="flex flex-col gap-2">
                {order.map((phrase, i) => (
                  <div key={`${phrase}-${i}`}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px]"
                    style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
                    <span className="flex flex-col">
                      <button onClick={() => movePhrase(i, i - 1)} disabled={i === 0 || verdict !== null}
                        className="px-1 text-[10px] leading-none opacity-60 disabled:opacity-20">▲</button>
                      <button onClick={() => movePhrase(i, i + 1)} disabled={i === order.length - 1 || verdict !== null}
                        className="px-1 text-[10px] leading-none opacity-60 disabled:opacity-20">▼</button>
                    </span>
                    <span className="selectable-text flex-1" style={{ color: 'rgb(var(--ds-text-2))' }}>{phrase}</span>
                  </div>
                ))}
              </div>
            )}

            {verdict !== null && (
              <div className="mt-5 rounded-xl px-4 py-3"
                style={{
                  background: verdict ? 'rgba(52,211,153,0.08)' : 'rgba(230,200,110,0.08)',
                  border: `1px solid ${verdict ? 'rgba(52,211,153,0.25)' : 'rgba(230,200,110,0.25)'}`,
                }}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold"
                  style={{ color: verdict ? '#34d399' : '#e6c86e' }}>
                  {verdict ? <><Check size={13} /> That is it</> : <><X size={13} /> Not quite — it comes back tomorrow</>}
                </div>
                <p className="selectable-text text-[13px] leading-relaxed" style={{ fontFamily: 'Georgia, serif', color: 'rgb(var(--ds-text-2))' }}>
                  {exercise.fullText}
                </p>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              {verdict === null ? (
                <button onClick={submit} disabled={!canSubmit}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-35"
                  style={{ background: 'rgba(230,200,110,0.18)', border: '1px solid rgba(230,200,110,0.35)', color: '#e6c86e' }}>
                  Check
                </button>
              ) : (
                <button onClick={() => next()} autoFocus
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold"
                  style={{ background: 'rgba(230,200,110,0.18)', border: '1px solid rgba(230,200,110,0.35)', color: '#e6c86e' }}>
                  {index + 1 >= queue.length ? 'Finish' : 'Next'} <ArrowRight size={13} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
