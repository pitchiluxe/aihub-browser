import React, { useMemo, useState } from 'react'
import { Check, FlaskConical, Play, Trash2 } from 'lucide-react'
import { formatRef } from '../../services/bibleService'
import { BOX_INTERVAL_DAYS, allVerses, dueVerses, labStats, nextDueAt, type Box, type VerseBook } from '../../services/bibleSrs'
import { exerciseForBox } from '../../services/bibleQuiz'
import DrillRunner from './DrillRunner'

interface Props {
  verses: VerseBook
  onGrade: (ref: string, correct: boolean) => void
  onRemove: (ref: string) => void
  onOpenReader: (ref: string) => void
}

const BOX_LABEL: Record<Box, string> = {
  1: 'Just started', 2: 'Coming back', 3: 'Getting there', 4: 'Nearly kept', 5: 'Known by heart',
}

const EXERCISE_LABEL: Record<string, string> = {
  'choose-text': 'recognise', 'fill-blank': 'one word', 'first-letters': 'first letters',
  'scramble': 'order', 'type-recall': 'from memory',
}

function whenDue(dueAt: number, now: number): string {
  if (dueAt <= now) return 'due now'
  const days = Math.ceil((dueAt - now) / 86_400_000)
  return days <= 1 ? 'tomorrow' : `in ${days} days`
}

// The drill room. Only what the scheduler says is due — reviewing everything
// every day is what makes people quit once the list gets past forty verses.
export default function Lab({ verses, onGrade, onRemove, onOpenReader }: Props) {
  const now = Date.now()
  const [drilling, setDrilling] = useState(false)
  const [seed, setSeed] = useState(0)
  const [summary, setSummary] = useState<{ answered: number; correct: number } | null>(null)

  const stats = useMemo(() => labStats(verses, now), [verses, now])
  // Snapshotted when the drill starts. Grading mutates `verses`, which would
  // otherwise re-sort the queue underneath the person answering it.
  const [queue, setQueue] = useState<{ ref: string; box: Box }[]>([])

  const startDrill = () => {
    const due = dueVerses(verses, Date.now())
    if (!due.length) return
    setQueue(due.map(ref => ({ ref, box: (verses[ref]?.box || 1) as Box })))
    setSeed(Date.now())
    setSummary(null)
    setDrilling(true)
  }

  if (drilling && queue.length) {
    return (
      <DrillRunner
        queue={queue}
        seed={seed}
        onGrade={onGrade}
        onDone={result => { setDrilling(false); setSummary(result) }}
        onQuit={() => setDrilling(false)}
      />
    )
  }

  const shelf = allVerses(verses)
  const next = nextDueAt(verses)

  return (
    <div className="mx-auto w-full max-w-3xl">
      {summary && (
        <div className="mb-5 rounded-2xl px-5 py-4"
          style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#34d399' }}>
            <Check size={15} /> {summary.correct} of {summary.answered} kept
          </div>
          <p className="mt-1 text-[12px] opacity-65">
            Anything you missed comes back tomorrow. Nothing is lost.
          </p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="In the Lab" value={stats.total} />
        <Stat label="Due now" value={stats.due} accent={stats.due > 0} />
        <Stat label="Known by heart" value={stats.mastered} />
      </div>

      {stats.total === 0 ? (
        <Empty />
      ) : stats.due > 0 ? (
        <button onClick={startDrill}
          className="mb-7 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold transition-all"
          style={{ background: 'rgba(230,200,110,0.16)', border: '1px solid rgba(230,200,110,0.35)', color: '#e6c86e' }}>
          <Play size={15} /> Drill {stats.due} verse{stats.due === 1 ? '' : 's'}
        </button>
      ) : (
        <div className="mb-7 rounded-2xl px-5 py-4 text-center"
          style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
          <div className="text-sm font-semibold" style={{ color: 'rgb(var(--ds-text-3))' }}>Nothing is due</div>
          <p className="mt-1 text-[12px] opacity-55">
            {next ? `Next verse comes back ${whenDue(next, now)}.` : 'Add a verse to begin.'}
          </p>
        </div>
      )}

      {shelf.length > 0 && (
        <>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] opacity-45">Your verses</div>
          <div className="flex flex-col gap-1.5">
            {shelf.map(ref => {
              const p = verses[ref]
              const box = (p?.box || 1) as Box
              return (
                <div key={ref}
                  className="group flex items-center gap-3 rounded-xl px-3.5 py-2.5"
                  style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
                  <button onClick={() => onOpenReader(ref)}
                    className="flex-1 text-left text-[13px] font-semibold"
                    style={{ color: 'rgb(var(--ds-text-2))' }}>
                    {formatRef(ref)}
                  </button>
                  <div className="flex items-center gap-1" title={`Box ${box} — reviewed every ${BOX_INTERVAL_DAYS[box]} days`}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <span key={n} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: n <= box ? '#e6c86e' : 'var(--ds-glass-md)',
                      }} />
                    ))}
                  </div>
                  <span className="w-28 text-right text-[10.5px] opacity-50">{BOX_LABEL[box]}</span>
                  <span className="w-20 text-right text-[10.5px] opacity-40">
                    {EXERCISE_LABEL[exerciseForBox(box)]}
                  </span>
                  <span className="w-16 text-right text-[10.5px] opacity-40">{whenDue(p?.dueAt || 0, now)}</span>
                  <button onClick={() => onRemove(ref)} title="Remove from the Lab"
                    className="rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100">
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl px-4 py-3"
      style={{
        background: accent ? 'rgba(230,200,110,0.10)' : 'var(--ds-glass-xs)',
        border: `1px solid ${accent ? 'rgba(230,200,110,0.28)' : 'var(--ds-border-sm)'}`,
      }}>
      <div className="text-xl font-bold" style={{ color: accent ? '#e6c86e' : 'rgb(var(--ds-text-2))' }}>{value}</div>
      <div className="text-[10.5px] uppercase tracking-wider opacity-45">{label}</div>
    </div>
  )
}

function Empty() {
  return (
    <div className="rounded-2xl px-6 py-10 text-center"
      style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
      <FlaskConical size={26} className="mx-auto mb-3 opacity-25" />
      <div className="text-sm font-semibold" style={{ color: 'rgb(var(--ds-text-3))' }}>Nothing to drill yet</div>
      <p className="mx-auto mt-2 max-w-sm text-[12px] leading-relaxed opacity-55">
        Add today's verse, or finish a lesson in the Classroom — its memory verses land here.
        A verse comes back the day before you would have forgotten it, not every day.
      </p>
    </div>
  )
}
