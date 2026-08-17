import React, { useEffect, useState } from 'react'
import { BookOpen, Check, FlaskConical, Flame, Loader2 } from 'lucide-react'
import { formatRef } from '../../services/bibleService'
import { verseText } from '../../services/verseText'

interface Props {
  verseRef: string
  meditatedToday: boolean
  streak: number
  inLab: boolean
  onMeditate: () => void
  onOpenReader: (ref: string) => void
  onAddToLab: (ref: string) => void
}

// The card the study page opens on. One verse, the same all day, with the three
// things you might want to do with it — sit with it, read around it, or learn
// it by heart. No AI, no network: the verse is chosen from the date alone.
export default function DailyVerseCard({
  verseRef, meditatedToday, streak, inLab, onMeditate, onOpenReader, onAddToLab,
}: Props) {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setText(null)
    verseText(verseRef).then(t => { if (live) setText(t) })
    return () => { live = false }
  }, [verseRef])

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: 'rgb(var(--ds-text-4))' }}>
          Verse for today
        </div>
        {streak > 0 && (
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c' }}>
            <Flame size={12} />
            {streak} day{streak === 1 ? '' : 's'} running
          </div>
        )}
      </div>

      <div className="rounded-2xl p-7"
        style={{
          background: 'linear-gradient(160deg, rgba(230,200,110,0.09), rgba(230,200,110,0.03))',
          border: '1px solid rgba(230,200,110,0.22)',
        }}>
        {text === null ? (
          <div className="flex items-center gap-2 py-6 text-sm opacity-60">
            <Loader2 size={14} className="animate-spin" /> Finding it…
          </div>
        ) : (
          <>
            <blockquote
              className="selectable-text"
              style={{
                fontFamily: 'Georgia, "Iowan Old Style", serif',
                fontSize: 'clamp(17px, 2.2vw, 22px)', lineHeight: 1.75,
                color: 'rgb(var(--ds-text-2))',
              }}
            >
              {text || 'That verse could not be found in this translation.'}
            </blockquote>
            <div className="mt-4 text-sm font-semibold" style={{ color: '#e6c86e' }}>
              {formatRef(verseRef)}
              <span className="ml-2 text-[11px] font-normal opacity-50">World English Bible</span>
            </div>
          </>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={onMeditate}
            disabled={meditatedToday}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all disabled:cursor-default"
            style={meditatedToday
              ? { background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }
              : { background: 'rgba(230,200,110,0.16)', border: '1px solid rgba(230,200,110,0.32)', color: '#e6c86e' }}
          >
            {meditatedToday ? <><Check size={13} /> Sat with it today</> : <>Meditate on this</>}
          </button>
          <button
            onClick={() => onOpenReader(verseRef)}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
            style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}
          >
            <BookOpen size={13} /> Open in reader
          </button>
          <button
            onClick={() => onAddToLab(verseRef)}
            disabled={inLab}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
            style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}
          >
            <FlaskConical size={13} /> {inLab ? 'In the Lab' : 'Learn by heart'}
          </button>
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed opacity-45">
        The same verse all day, chosen from the date — it will not change if you close the app and come back.
      </p>
    </div>
  )
}
