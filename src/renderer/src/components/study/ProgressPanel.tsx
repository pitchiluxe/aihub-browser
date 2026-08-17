import React from 'react'
import { Award, Flame, Lock } from 'lucide-react'
import { BADGES, currentStreak, unlockedStyles } from '../../services/bibleRewards'
import { labStats, type VerseBook } from '../../services/bibleSrs'
import { dayKey } from '../../services/dailyVerse'
import { completedCourses, lessonsCompleted, type LessonBook } from '../../services/bibleCourses'
import type { StreakState } from '../../services/bibleRewards'

interface Props {
  verses: VerseBook
  lessons: LessonBook
  streak: StreakState
  badges: string[]
}

const BOX_TITLE = ['', 'Just started', 'Coming back', 'Getting there', 'Nearly kept', 'Known by heart']

// What has actually been done. No score, no level, no leaderboard — three
// honest counts and a wall of badges, some of which open up a reader style.
export default function ProgressPanel({ verses, lessons, streak, badges }: Props) {
  const today = dayKey()
  const stats = labStats(verses, Date.now())
  const current = currentStreak(streak.days, today)
  const unlocks = unlockedStyles(badges)
  const held = new Set(badges)

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card icon={<Flame size={15} />} value={current} label={current === 1 ? 'day running' : 'days running'}
          note={streak.best > current ? `best ${streak.best}` : 'your best yet'} accent="#fb923c" />
        <Card icon={<Award size={15} />} value={stats.mastered} label="verses known by heart"
          note={`${stats.total} in the Lab`} accent="#e6c86e" />
        <Card icon={<Award size={15} />} value={lessonsCompleted(lessons)} label="lessons finished"
          note={`${completedCourses(lessons).length} of 3 courses`} accent="#7dd3a0" />
      </div>

      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] opacity-45">How well you know them</div>
      <div className="mb-7 rounded-2xl p-5" style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
        {stats.total === 0 ? (
          <p className="text-[12.5px] opacity-50">Nothing in the Lab yet.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {([1, 2, 3, 4, 5] as const).map(box => (
              <div key={box} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-[11px] opacity-55">{BOX_TITLE[box]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--ds-glass-md)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${(stats.byBox[box] / stats.total) * 100}%`,
                      background: box === 5 ? '#34d399' : '#e6c86e',
                      opacity: 0.35 + box * 0.13,
                    }} />
                </div>
                <span className="w-6 text-right text-[11px] font-semibold opacity-55">{stats.byBox[box]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] opacity-45">
        Badges <span className="opacity-60">{badges.length}/{BADGES.length}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {BADGES.map(badge => {
          const earned = held.has(badge.id)
          return (
            <div key={badge.id} className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{
                background: earned ? 'rgba(230,200,110,0.08)' : 'var(--ds-glass-xs)',
                border: `1px solid ${earned ? 'rgba(230,200,110,0.25)' : 'var(--ds-border-sm)'}`,
              }}>
              <div className="mt-0.5 shrink-0" style={{ color: earned ? '#e6c86e' : 'rgb(var(--ds-text-4))', opacity: earned ? 1 : 0.35 }}>
                {earned ? <Award size={15} /> : <Lock size={13} />}
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold" style={{ color: earned ? 'rgb(var(--ds-text-2))' : 'rgb(var(--ds-text-4))' }}>
                  {badge.name}
                </div>
                <div className="text-[11px] opacity-50">{badge.requirement}</div>
                {badge.unlock && (
                  <div className="mt-1 text-[10.5px] font-semibold" style={{ color: earned ? '#7dd3a0' : 'rgb(var(--ds-text-4))', opacity: earned ? 1 : 0.5 }}>
                    {earned ? 'Unlocked: ' : 'Unlocks: '}{badge.unlock.label}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {(unlocks.papers.length > 0 || unlocks.covers.length > 0) && (
        <p className="mt-4 text-[11px] leading-relaxed opacity-45">
          Unlocked reader styles are available in Settings → Bible.
        </p>
      )}
    </div>
  )
}

function Card({ icon, value, label, note, accent }: {
  icon: React.ReactNode; value: number; label: string; note: string; accent: string
}) {
  return (
    <div className="rounded-2xl px-5 py-4" style={{ background: `${accent}0d`, border: `1px solid ${accent}28` }}>
      <div className="mb-2 flex items-center gap-1.5" style={{ color: accent }}>{icon}</div>
      <div className="text-2xl font-bold" style={{ color: 'rgb(var(--ds-text-2))' }}>{value}</div>
      <div className="text-[11px] opacity-55">{label}</div>
      <div className="mt-1 text-[10.5px] opacity-35">{note}</div>
    </div>
  )
}
