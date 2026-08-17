import React, { useEffect, useState } from 'react'
import { BookOpen, Check, FlaskConical, Highlighter, NotebookPen, RotateCcw } from 'lucide-react'
import { formatRef } from '../../services/bibleService'
import { getPlans, type Passage, type ReadingPlan } from '../../services/bibleCourses'
import { passageVerses } from '../../services/verseText'
import type { PlanProgress } from '../../services/bibleStudyStore'

export interface DeskMarks {
  highlights: Record<string, string>
  saved: { ref: string; ts: number }[]
  notes: Record<string, string>
}

interface Props {
  marks: DeskMarks
  plans: Record<string, PlanProgress>
  onAdvancePlan: (planId: string, day: number) => void
  onOpenReader: (ref: string) => void
  /** Opens the day's reading in the passage popup, on the reader's own paper. */
  onReadPassages: (views: Passage[], focusRef?: string | null, index?: number) => void
  onAddToLab: (refs: string[]) => void
  inLab: (ref: string) => boolean
}

type Tab = 'plans' | 'saved' | 'highlights' | 'notes'

// The self-directed desk. It reads the reader's own marks rather than keeping
// a second copy of them — a verse saved here and a verse saved in the reader
// are the same verse, and there is no second source of truth to drift.
export default function StudyDesk({ marks, plans, onAdvancePlan, onOpenReader, onReadPassages, onAddToLab, inLab }: Props) {
  const [tab, setTab] = useState<Tab>('plans')
  const highlighted = Object.keys(marks.highlights || {})
  const noted = Object.keys(marks.notes || {})

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: 'plans',      label: 'Reading plans', count: getPlans().length },
    { id: 'saved',      label: 'Saved',         count: marks.saved?.length || 0 },
    { id: 'highlights', label: 'Highlighted',   count: highlighted.length },
    { id: 'notes',      label: 'Notes',         count: noted.length },
  ]

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="rounded-xl px-3 py-1.5 text-[11.5px] font-semibold transition-all"
            style={tab === t.id
              ? { background: 'rgba(230,200,110,0.16)', border: '1px solid rgba(230,200,110,0.32)', color: '#e6c86e' }
              : { background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-4))' }}>
            {t.label} <span className="opacity-50">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === 'plans' && (
        <div className="flex flex-col gap-3">
          {getPlans().map(plan => (
            <PlanCard key={plan.id} plan={plan} progress={plans[plan.id]}
              onAdvance={day => onAdvancePlan(plan.id, day)} onRead={onReadPassages} />
          ))}
        </div>
      )}

      {tab === 'saved' && (
        <RefList
          refs={(marks.saved || []).map(s => s.ref)}
          empty="Nothing saved yet. Tap a verse in the reader and choose Save."
          icon={<BookOpen size={22} />}
          onOpenReader={onOpenReader}
          onAddToLab={onAddToLab}
          inLab={inLab}
        />
      )}

      {tab === 'highlights' && (
        <RefList
          refs={highlighted}
          colors={marks.highlights}
          empty="No highlights yet."
          icon={<Highlighter size={22} />}
          onOpenReader={onOpenReader}
          onAddToLab={onAddToLab}
          inLab={inLab}
        />
      )}

      {tab === 'notes' && (
        noted.length === 0 ? (
          <Empty icon={<NotebookPen size={22} />} text="No notes yet. Write one against a verse in the reader." />
        ) : (
          <div className="flex flex-col gap-2">
            {noted.map(ref => (
              <div key={ref} className="rounded-xl px-4 py-3"
                style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
                <button onClick={() => onOpenReader(ref)} className="mb-1.5 text-[12px] font-bold" style={{ color: '#e6c86e' }}>
                  {formatRef(ref)}
                </button>
                <p className="selectable-text whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: 'rgb(var(--ds-text-2))' }}>
                  {marks.notes[ref]}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

function PlanCard({ plan, progress, onAdvance, onRead }: {
  plan: ReadingPlan
  progress?: PlanProgress
  onAdvance: (day: number) => void
  onRead: (views: Passage[], focusRef?: string | null, index?: number) => void
}) {
  const day = Math.min(progress?.day || 0, plan.days.length)
  const done = day >= plan.days.length
  const today = plan.days[Math.min(day, plan.days.length - 1)]
  const [preview, setPreview] = useState<string>('')

  useEffect(() => {
    let live = true
    setPreview('')
    if (!today) return
    passageVerses(today.passages[0]).then(vs => {
      if (live && vs.length) setPreview(vs[0].t.slice(0, 150))
    })
    return () => { live = false }
  }, [plan.id, day])

  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold" style={{ color: 'rgb(var(--ds-text-2))' }}>{plan.title}</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed opacity-55">{plan.blurb}</p>
        </div>
        {day > 0 && (
          <button onClick={() => onAdvance(0)} title="Start over"
            className="shrink-0 rounded-lg p-1.5 opacity-40 hover:opacity-90">
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--ds-glass-md)' }}>
          <div className="h-full rounded-full" style={{ width: `${(day / plan.days.length) * 100}%`, background: '#e6c86e' }} />
        </div>
        <span className="text-[10.5px] font-semibold opacity-55">{day}/{plan.days.length}</span>
      </div>

      {done ? (
        <div className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#34d399' }}>
          <Check size={13} /> Finished
        </div>
      ) : (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold" style={{ color: '#e6c86e' }}>
            {today.label} · {today.passages.map(p => p.label).join(', ')}
          </div>
          {preview && <p className="mb-3 text-[11.5px] italic leading-relaxed opacity-45">“{preview}…”</p>}
          <div className="flex gap-2">
            {/* The whole day's reading, in one popup you can page through. It
                opens over this card rather than in the Bible tab, so closing it
                puts "mark done" straight back under the cursor. */}
            <button onClick={() => onRead(today.passages)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
              style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
              <BookOpen size={12} /> Read it
            </button>
            <button onClick={() => onAdvance(day + 1)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
              style={{ background: 'rgba(230,200,110,0.14)', border: '1px solid rgba(230,200,110,0.3)', color: '#e6c86e' }}>
              <Check size={12} /> Mark {today.label} done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RefList({ refs, colors, empty, icon, onOpenReader, onAddToLab, inLab }: {
  refs: string[]
  colors?: Record<string, string>
  empty: string
  icon: React.ReactNode
  onOpenReader: (ref: string) => void
  onAddToLab: (refs: string[]) => void
  inLab: (ref: string) => boolean
}) {
  if (!refs.length) return <Empty icon={icon} text={empty} />
  const addable = refs.filter(r => !inLab(r))
  return (
    <>
      {addable.length > 0 && (
        <button onClick={() => onAddToLab(addable)}
          className="mb-3 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
          style={{ background: 'rgba(230,200,110,0.12)', border: '1px solid rgba(230,200,110,0.28)', color: '#e6c86e' }}>
          <FlaskConical size={12} /> Send all {addable.length} to the Lab
        </button>
      )}
      <div className="flex flex-col gap-1.5">
        {refs.map(ref => (
          <div key={ref} className="group flex items-center gap-3 rounded-xl px-3.5 py-2.5"
            style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
            {colors?.[ref] && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[ref], flexShrink: 0 }} />
            )}
            <button onClick={() => onOpenReader(ref)} className="flex-1 text-left text-[13px] font-semibold"
              style={{ color: 'rgb(var(--ds-text-2))' }}>
              {formatRef(ref)}
            </button>
            <button onClick={() => onAddToLab([ref])} disabled={inLab(ref)}
              title={inLab(ref) ? 'Already in the Lab' : 'Learn by heart'}
              className="rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 disabled:!opacity-25">
              <FlaskConical size={12} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-2xl px-6 py-10 text-center"
      style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
      <div className="mx-auto mb-3 opacity-25">{icon}</div>
      <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed opacity-55">{text}</p>
    </div>
  )
}
