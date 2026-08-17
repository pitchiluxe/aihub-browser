import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { formatRef, parseRef } from '../../services/bibleService'
import { requestBibleVerse } from '../../services/bibleNavigation'
import PassageModal, { verseView, type PassageView } from '../bible/PassageModal'
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
interface Reading { views: PassageView[]; index: number; focusRef: string | null }

export default function BibleStudyPage() {
  const { study, loaded, update } = useBibleStudy()
  const focusOrOpenPage = useBrowserStore(s => s.focusOrOpenPage)
  const [room, setRoom] = useState<Room>('today')
  const [marks, setMarks] = useState<DeskMarks>(EMPTY_MARKS)
  const [celebrating, setCelebrating] = useState<Badge[]>([])
  const [reading, setReading] = useState<Reading | null>(null)

  // The whole marks object, including the fields this page never shows
  // (lastRead). Saving a verse has to write the file back whole, and merging
  // onto a partial copy is how a reading position or a note quietly vanishes.
  const marksRef = useRef<any>({ ...EMPTY_MARKS, lastRead: null })
  // Never write from a slate we failed to read — same rule the reader follows.
  const marksSafe = useRef(false)

  const today = dayKey()
  const todayRef = useMemo(() => verseForDay(new Date()), [today])

  useEffect(() => {
    ;(window as any).electronAPI?.bible?.getMarks?.()
      .then((m: any) => {
        marksRef.current = { highlights: m?.highlights || {}, saved: m?.saved || [], notes: m?.notes || {}, lastRead: m?.lastRead ?? null }
        marksSafe.current = m?.status !== 'unreadable'
        setMarks({ highlights: marksRef.current.highlights, saved: marksRef.current.saved, notes: marksRef.current.notes })
      })
      .catch(() => {})
  }, [])

  /** The one path every marks write in this page goes through. */
  const persistMarks = useCallback((mutate: (current: any) => any) => {
    const next = mutate(marksRef.current)
    marksRef.current = next
    setMarks({ highlights: next.highlights, saved: next.saved, notes: next.notes })
    if (!marksSafe.current) return
    ;(window as any).electronAPI?.bible?.setMarks?.(next).catch(() => {})
  }, [])

  // Saving from the study room writes the same list the reader's own Save
  // button writes, so a verse kept here shows up there and in Saved verses.
  const toggleSaveVerse = useCallback((ref: string) => {
    persistMarks(current => {
      const exists = (current.saved || []).some((s: any) => s.ref === ref)
      return {
        ...current,
        saved: exists
          ? current.saved.filter((s: any) => s.ref !== ref)
          : [{ ref, ts: Date.now() }, ...(current.saved || [])],
      }
    })
  }, [persistMarks])

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

  // "Read it" anywhere in the study rooms opens the passage over this page, on
  // the reader's own paper — it never opens a tab. Losing your place in a
  // lesson or a reading plan to go and look at one verse is not a trade worth
  // making, and every trip used to leave another Bible tab behind.
  const readPassages = useCallback((views: PassageView[], focusRef?: string | null, index = 0) => {
    const usable = views.filter(Boolean)
    if (!usable.length) return
    setReading({ views: usable, index, focusRef: focusRef ?? null })
  }, [])

  const readVerse = useCallback((ref: string) => {
    const view = verseView(ref, formatRef(ref))
    if (view) readPassages([view], ref)
  }, [readPassages])

  // The one path that does change tabs, and only because the reader asked for
  // it by name. The verse is handed over explicitly — the marks file's
  // lastRead only carries a book and a chapter, and on its own it would land
  // the reader on the closed cover instead of the verse they clicked. The
  // Bible tab is FOCUSED rather than duplicated.
  const openInBible = useCallback((ref: string) => {
    const parsed = parseRef(ref)
    setReading(null)
    if (parsed && marksSafe.current) {
      persistMarks(current => ({ ...current, lastRead: { book: parsed.bookId, chapter: parsed.chapter } }))
    }
    if (parsed) requestBibleVerse(ref)
    focusOrOpenPage('aihub://bible', 'bible')
  }, [focusOrOpenPage, persistMarks])

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
            saved={marks.saved.some(s => s.ref === todayRef)}
            onMeditate={meditate}
            onRead={readVerse}
            onToggleSave={toggleSaveVerse}
            onAddToLab={ref => addToLab([ref])}
          />
        ) : room === 'study' ? (
          <StudyDesk
            marks={marks}
            plans={study.plans}
            onAdvancePlan={(planId, day) => commit(c => advancePlan(c, planId, day, Date.now()))}
            onOpenReader={readVerse}
            onReadPassages={readPassages}
            onAddToLab={addToLab}
            inLab={inLab}
          />
        ) : room === 'classroom' ? (
          <Classroom
            lessons={study.lessons}
            inLab={inLab}
            onComplete={completeLesson}
            onAddToLab={addToLab}
            onOpenReader={readVerse}
            onReadPassages={readPassages}
            onAskAI={askAI}
          />
        ) : room === 'lab' ? (
          <Lab
            verses={study.verses as VerseBook}
            onGrade={gradeVerse}
            onRemove={ref => commit(c => removeVerse(c, ref))}
            onOpenReader={readVerse}
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

      {/* Scripture, over whatever room asked for it. Closing it puts the reader
          straight back on the plan or the lesson they were working through. */}
      {reading && (
        <PassageModal
          views={reading.views}
          startIndex={reading.index}
          focusRef={reading.focusRef}
          highlights={marks.highlights}
          notes={marks.notes}
          savedRefs={marks.saved.map(s => s.ref)}
          onClose={() => setReading(null)}
          onOpenInBible={openInBible}
          onToggleSave={toggleSaveVerse}
          onAddToLab={ref => addToLab([ref])}
          inLab={inLab}
        />
      )}

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
