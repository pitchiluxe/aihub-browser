import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Award, BookOpen, FlaskConical, GraduationCap, Sun } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { dayKey, verseForDay } from '../../services/dailyVerse'
import { grade, labStats, type VerseBook } from '../../services/bibleSrs'
import {
  currentStreak, evaluateBadges, newlyEarned, recordDay, type Badge, type RewardFacts,
} from '../../services/bibleRewards'
import { completedCourses, lessonKey, lessonsCompleted } from '../../services/bibleCourses'
import {
  addVerses, advancePlan, removeVerse, setLesson, useBibleStudy, type StudyState,
} from '../../services/bibleStudyStore'
import { parseRef } from '../../services/bibleService'
import DailyVerseCard from '../study/DailyVerseCard'
import StudyDesk, { type DeskMarks } from '../study/StudyDesk'
import Classroom from '../study/Classroom'
import Lab from '../study/Lab'
import ProgressPanel from '../study/ProgressPanel'

type Room = 'today' | 'study' | 'classroom' | 'lab' | 'progress'

const ROOMS: { id: Room; label: string; icon: React.ReactNode }[] = [
  { id: 'today',     label: 'Today',     icon: <Sun size={14} /> },
  { id: 'study',     label: 'Study',     icon: <BookOpen size={14} /> },
  { id: 'classroom', label: 'Classroom', icon: <GraduationCap size={14} /> },
  { id: 'lab',       label: 'Lab',       icon: <FlaskConical size={14} /> },
  { id: 'progress',  label: 'Progress',  icon: <Award size={14} /> },
]

const EMPTY_MARKS: DeskMarks = { highlights: {}, saved: [], notes: {} }

// The study page is a shell: rooms and routing only. Each room is its own
// component, so this file never grows into the reader's 700-line shape — the
// two are different activities and deliberately do not share a component tree.
export default function BibleStudyPage() {
  const { study, loaded, update } = useBibleStudy()
  const addTab = useBrowserStore(s => s.addTab)
  const [room, setRoom] = useState<Room>('today')
  const [marks, setMarks] = useState<DeskMarks>(EMPTY_MARKS)
  const [celebrating, setCelebrating] = useState<Badge[]>([])

  const today = dayKey()
  const todayRef = useMemo(() => verseForDay(new Date()), [today])

  // Read-only here. The reader owns the marks file; the desk only shows what is
  // in it, and the one thing this page writes is the reading position, so
  // "open in reader" lands on the verse that was clicked.
  useEffect(() => {
    ;(window as any).electronAPI?.bible?.getMarks?.()
      .then((m: any) => setMarks({ highlights: m?.highlights || {}, saved: m?.saved || [], notes: m?.notes || {} }))
      .catch(() => {})
  }, [])

  const facts = useCallback((next: StudyState): RewardFacts => {
    const stats = labStats(next.verses, Date.now())
    return {
      masteredVerses: stats.mastered,
      totalVerses: stats.total,
      streakCurrent: currentStreak(next.streak.days, today),
      streakBest: next.streak.best,
      lessonsCompleted: lessonsCompleted(next.lessons),
      coursesCompleted: completedCourses(next.lessons),
    }
  }, [today])

  /**
   * Every mutation goes through here so badges are re-evaluated exactly once
   * per change. Doing it in a useEffect instead would race the debounced write
   * and could persist a state whose badges had not been recomputed yet.
   */
  const commit = useCallback((mutate: (current: StudyState) => StudyState) => {
    update(current => {
      const changed = mutate(current)
      if (changed === current) return current
      const badges = evaluateBadges(changed.badges, facts(changed))
      const fresh = newlyEarned(current.badges, badges)
      if (fresh.length) setTimeout(() => setCelebrating(fresh), 0)
      return badges.length === changed.badges.length ? changed : { ...changed, badges }
    })
  }, [update, facts])

  const meditate = useCallback(() => {
    commit(current => ({ ...current, streak: recordDay(current.streak, today) }))
  }, [commit, today])

  const addToLab = useCallback((refs: string[]) => {
    commit(current => addVerses(current, refs, Date.now()))
  }, [commit])

  const gradeVerse = useCallback((ref: string, correct: boolean) => {
    commit(current => ({
      ...current,
      verses: { ...current.verses, [ref]: grade(current.verses[ref], correct, Date.now()) },
    }))
  }, [commit])

  const completeLesson = useCallback((courseId: string, lessonId: string, score: number, total: number) => {
    commit(current => setLesson(current, lessonKey(courseId, lessonId), { completedAt: Date.now(), score, total }))
  }, [commit])

  // Opening the reader on a verse: write the position into the marks file the
  // reader restores from, then open its tab. No new channel, no shared state —
  // the reader already knows how to come back to where you were.
  const openReader = useCallback((ref: string) => {
    const parsed = parseRef(ref)
    const api = (window as any).electronAPI?.bible
    const go = () => addTab('aihub://bible', 'bible')
    if (!parsed || !api?.getMarks) { go(); return }
    api.getMarks()
      .then((m: any) => {
        if (m?.status === 'unreadable') return
        return api.setMarks({ ...m, lastRead: { book: parsed.bookId, chapter: parsed.chapter } })
      })
      .catch(() => {})
      .finally(go)
  }, [addTab])

  const askAI = useCallback((question: string) => {
    document.dispatchEvent(new CustomEvent('aihub-ai-send', { detail: { text: question, display: question } }))
  }, [])

  useEffect(() => {
    if (!celebrating.length) return
    const t = setTimeout(() => setCelebrating([]), 6000)
    return () => clearTimeout(t)
  }, [celebrating])

  const inLab = useCallback((ref: string) => !!study.verses[ref], [study.verses])
  const streakNow = currentStreak(study.streak.days, today)
  const dueCount = useMemo(() => labStats(study.verses, Date.now()).due, [study.verses])

  return (
    <div className="flex h-full flex-col overflow-hidden page-enter" style={{ background: 'var(--ds-page-bg)' }}>
      <div className="flex shrink-0 items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid rgba(230,200,110,0.12)' }}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(230,200,110,0.14)', border: '1px solid rgba(230,200,110,0.26)' }}>
            <GraduationCap size={18} style={{ color: '#e6c86e' }} />
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: 'rgb(var(--ds-text-2))' }}>Bible Study</div>
            <div className="text-xs opacity-50">A verse a day, courses, and a drill room that remembers for you</div>
          </div>
        </div>
        <div className="flex gap-1">
          {ROOMS.map(r => (
            <button key={r.id} onClick={() => setRoom(r.id)}
              className="relative flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11.5px] font-semibold transition-all"
              style={room === r.id
                ? { background: 'rgba(230,200,110,0.16)', border: '1px solid rgba(230,200,110,0.32)', color: '#e6c86e' }
                : { background: 'transparent', border: '1px solid transparent', color: 'rgb(var(--ds-text-4))' }}>
              {r.icon} {r.label}
              {r.id === 'lab' && dueCount > 0 && (
                <span className="ml-0.5 rounded-full px-1.5 text-[9.5px] font-bold"
                  style={{ background: '#e6c86e', color: '#241d0c' }}>{dueCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
        {!loaded ? null : room === 'today' ? (
          <DailyVerseCard
            verseRef={todayRef}
            meditatedToday={study.streak.days.includes(today)}
            streak={streakNow}
            inLab={inLab(todayRef)}
            onMeditate={meditate}
            onOpenReader={openReader}
            onAddToLab={ref => addToLab([ref])}
          />
        ) : room === 'study' ? (
          <StudyDesk
            marks={marks}
            plans={study.plans}
            onAdvancePlan={(planId, day) => commit(c => advancePlan(c, planId, day, Date.now()))}
            onOpenReader={openReader}
            onAddToLab={addToLab}
            inLab={inLab}
          />
        ) : room === 'classroom' ? (
          <Classroom
            lessons={study.lessons}
            inLab={inLab}
            onComplete={completeLesson}
            onAddToLab={addToLab}
            onOpenReader={openReader}
            onAskAI={askAI}
          />
        ) : room === 'lab' ? (
          <Lab
            verses={study.verses as VerseBook}
            onGrade={gradeVerse}
            onRemove={ref => commit(c => removeVerse(c, ref))}
            onOpenReader={openReader}
          />
        ) : (
          <ProgressPanel
            verses={study.verses as VerseBook}
            lessons={study.lessons}
            streak={study.streak}
            badges={study.badges}
          />
        )}
      </div>

      {/* A badge landing is worth one quiet card, not confetti. */}
      <AnimatePresence>
        {celebrating.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-5 py-4"
            style={{ background: 'var(--ds-panel-bg)', border: '1px solid rgba(230,200,110,0.35)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
            onClick={() => setCelebrating([])}
          >
            <div className="flex items-center gap-2.5">
              <Award size={18} style={{ color: '#e6c86e' }} />
              <div>
                <div className="text-[13px] font-bold" style={{ color: '#e6c86e' }}>
                  {celebrating.map(b => b.name).join(' · ')}
                </div>
                <div className="text-[11px] opacity-55">
                  {celebrating.find(b => b.unlock)
                    ? `Unlocked ${celebrating.filter(b => b.unlock).map(b => b.unlock!.label).join(' and ')} in Settings → Bible.`
                    : celebrating[0].requirement}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
