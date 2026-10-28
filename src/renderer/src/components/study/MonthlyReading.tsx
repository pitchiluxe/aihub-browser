import React, { useEffect, useMemo, useState } from 'react'
import { BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { formatRef, getTranslationMeta, parseRef } from '../../services/bibleService'
import { monthlyPlan, monthName, type MonthDay } from '../../services/bibleMonthlyPlan'
import { plural, useBibleLang } from '../../services/bibleLang'
import { verseText } from '../../services/verseText'
import type { Passage } from '../../services/bibleCourses'
import type { PlanProgress } from '../../services/bibleStudyStore'
import ListenButton from '../bible/ListenButton'

interface Props {
  plans: Record<string, PlanProgress>
  onAdvancePlan: (planId: string, day: number) => void
  onReadPassages: (views: Passage[], focusRef?: string | null, index?: number) => void
  onOpenReader: (ref: string) => void
}

const GOLD = '#e6c86e'

/** "1 Thessalonians 5:16–18" from three consecutive refs. */
function rangeLabel(refs: string[]): string {
  const first = formatRef(refs[0])
  if (refs.length < 2) return first
  const last = parseRef(refs[refs.length - 1])
  return last ? `${first}–${last.verse}` : first
}

// The month's reading: one theme, one verse to carry, and a chapter or two for
// every day of the month. Opens on the current month; the arrows step to the
// next one so the reader can see what is coming before it starts.
export default function MonthlyReading({ plans, onAdvancePlan, onReadPassages, onOpenReader }: Props) {
  const { lang, t } = useBibleLang()
  const now = new Date()
  const [offset, setOffset] = useState(0)
  const target = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const year = target.getFullYear()
  const month = target.getMonth() + 1
  const plan = useMemo(() => monthlyPlan(year, month, lang), [year, month, lang])
  const { theme, days } = plan

  const isCurrent = offset === 0
  const todayDate = now.getDate()
  // Progress is a count of days read in order — the same shape every other
  // plan in the desk keeps, so the store needs nothing new.
  const done = Math.min(plans[plan.id]?.day || 0, days.length)
  const finished = done >= days.length
  const next: MonthDay | undefined = days[done]
  const behind = isCurrent ? Math.max(0, todayDate - 1 - done) : 0
  const [viewing, setViewing] = useState<number | null>(null)
  const shown = viewing != null ? days[viewing - 1] : next

  const [verse, setVerse] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setVerse(null)
    Promise.all(theme.verses.map(verseText)).then(parts => {
      if (live) setVerse(parts.filter(Boolean).join(' '))
    })
    return () => { live = false }
  }, [theme])

  useEffect(() => { setViewing(null) }, [plan.id])

  const name = monthName(month, lang)
  const monthLabel = `${name} ${year}`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setOffset(o => o - 1)} title={t('Previous month', 'Mois précédent')}
          className="rounded-lg p-1.5 opacity-50 hover:opacity-100"><ChevronLeft size={15} /></button>
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: 'rgb(var(--ds-text-4))' }}>
          <CalendarDays size={13} /> {monthLabel}
          {!isCurrent && (
            <button onClick={() => setOffset(0)}
              className="ml-1 rounded-full px-2 py-0.5 text-[10px] normal-case tracking-normal"
              style={{ background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-3))' }}>
              {t('back to this month', 'revenir à ce mois-ci')}
            </button>
          )}
        </div>
        <button onClick={() => setOffset(o => o + 1)} title={t('Next month', 'Mois suivant')}
          data-testid="next-month"
          className="rounded-lg p-1.5 opacity-50 hover:opacity-100"><ChevronRight size={15} /></button>
      </div>

      <div className="rounded-2xl p-7"
        style={{
          background: 'linear-gradient(160deg, rgba(230,200,110,0.11), rgba(230,200,110,0.025))',
          border: '1px solid rgba(230,200,110,0.24)',
        }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[22px] font-bold leading-tight"
              style={{ fontFamily: 'Georgia, "Iowan Old Style", serif', color: 'rgb(var(--ds-text-1))' }}>
              {theme.title}
            </div>
            <div className="mt-1 text-[12px] opacity-60">{theme.tagline}</div>
          </div>
          {done > 0 && (
            <button onClick={() => onAdvancePlan(plan.id, 0)} title={t('Start the month over', 'Recommencer le mois')}
              className="shrink-0 rounded-lg p-1.5 opacity-40 hover:opacity-90"><RotateCcw size={12} /></button>
          )}
        </div>

        <div className="mt-5">
          {verse === null ? (
            <div className="flex items-center gap-2 text-sm opacity-60"><Loader2 size={14} className="animate-spin" /> {t('Finding it…', 'Recherche…')}</div>
          ) : (
            <>
              <blockquote className="selectable-text"
                style={{
                  fontFamily: 'Georgia, "Iowan Old Style", serif',
                  fontSize: 'clamp(16px, 2vw, 19px)', lineHeight: 1.7, color: 'rgb(var(--ds-text-2))',
                }}>
                {verse || t('That verse could not be found in this translation.', 'Ce verset est introuvable dans cette version.')}
              </blockquote>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={() => onOpenReader(theme.verses[0])}
                  className="text-sm font-semibold" style={{ color: GOLD }}>
                  {rangeLabel(theme.verses)}
                </button>
                <span className="text-[11px] opacity-50">{getTranslationMeta().name} · {t('verse for the month', 'verset du mois')}</span>
                <ListenButton text={verse} reference={rangeLabel(theme.verses)} label={t('Listen', 'Écouter')} />
              </div>
            </>
          )}
        </div>

        <p className="mt-5 text-[13px] leading-relaxed" style={{ color: 'rgb(var(--ds-text-3))' }}>{theme.intro}</p>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--ds-glass-md)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(done / days.length) * 100}%`, background: GOLD }} />
          </div>
          <span className="text-[10.5px] font-semibold opacity-55">{done}/{days.length} {t('days', 'jours')}</span>
        </div>
      </div>

      {/* The day's reading — the next unread day, or one picked from the calendar. */}
      {finished && viewing == null ? (
        <div className="flex items-center gap-2 rounded-2xl px-5 py-4 text-[13px] font-semibold"
          style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.28)', color: '#34d399' }}>
          <Check size={15} /> {t(`You read all of ${name}. Well done, good and faithful reader.`, `Vous avez lu tout le mois de ${name}. C’est bien, bon et fidèle lecteur.`)}
        </div>
      ) : shown && (
        <div className="rounded-2xl p-5" style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: GOLD }}>
              {lang === 'fr' ? `${shown.date} ${name}` : `${name} ${shown.date}`}
              {isCurrent && shown.date === todayDate && <span className="ml-2 normal-case tracking-normal opacity-70">· {t('today', 'aujourd’hui')}</span>}
            </div>
            {behind > 0 && viewing == null && (
              <span className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c' }}>
                {lang === 'fr' ? `${plural(lang, behind, ['', ''], ['jour', 'jours'])} à rattraper` : `${plural(lang, behind, ['day', 'days'], ['', ''])} to catch up`}
              </span>
            )}
          </div>
          <div className="mt-1.5 text-[17px] font-bold" style={{ color: 'rgb(var(--ds-text-2))' }}>{shown.label}</div>
          <p className="mt-2 flex gap-2 text-[12.5px] italic leading-relaxed opacity-70">
            <Sparkles size={13} className="mt-0.5 shrink-0" style={{ color: GOLD }} /> {shown.focus}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => onReadPassages(shown.passages)}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
              style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
              <BookOpen size={13} /> {t('Read it', 'Lire')}
            </button>
            {shown === next && (
              <button onClick={() => onAdvancePlan(plan.id, done + 1)}
                className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
                style={{ background: 'rgba(230,200,110,0.16)', border: '1px solid rgba(230,200,110,0.32)', color: GOLD }}>
                <Check size={13} /> {t(`Mark ${name} ${shown.date} read`, `Marquer le ${shown.date} ${name} comme lu`)}
              </button>
            )}
            {viewing != null && (
              <button onClick={() => setViewing(null)}
                className="rounded-xl px-3.5 py-2 text-xs font-semibold opacity-60 hover:opacity-100">
                {t('Back to my next reading', 'Revenir à ma prochaine lecture')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* The whole month at a glance. Read days are filled; today is ringed. */}
      <div className="rounded-2xl p-4" style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d, i) => {
            const read = i < done
            const today = isCurrent && d.date === todayDate
            const selected = shown?.date === d.date
            return (
              <button key={d.date} onClick={() => setViewing(d.date)} title={d.label}
                className="flex flex-col items-start rounded-lg px-2 py-1.5 text-left transition-all"
                style={{
                  background: read ? 'rgba(230,200,110,0.16)' : selected ? 'var(--ds-glass-md)' : 'transparent',
                  border: `1px solid ${today ? GOLD : selected ? 'rgba(230,200,110,0.4)' : 'var(--ds-border-sm)'}`,
                }}>
                <span className="flex w-full items-center justify-between text-[11px] font-bold"
                  style={{ color: read ? GOLD : 'rgb(var(--ds-text-3))' }}>
                  {d.date} {read && <Check size={10} />}
                </span>
                <span className="w-full truncate text-[9.5px] opacity-55">{d.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
