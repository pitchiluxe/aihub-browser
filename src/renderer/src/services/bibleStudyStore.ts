// The study room's state, and the one path every write goes through.
//
// Same discipline as the reader's marks (see BiblePage): mutate off a ref
// rather than a closed-over copy, and never write from a slate we did not
// successfully load — persisting blankness over real progress is the one bug
// that would actually cost someone something here.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LessonBook, LessonProgress } from './bibleCourses'
import type { VerseBook } from './bibleSrs'
import type { StreakState } from './bibleRewards'

export interface PlanProgress { day: number; startedAt: number }

export interface StudyState {
  verses: VerseBook
  lessons: LessonBook
  streak: StreakState
  badges: string[]
  plans: Record<string, PlanProgress>
}

export function emptyStudy(): StudyState {
  return { verses: {}, lessons: {}, streak: { days: [], best: 0 }, badges: [], plans: {} }
}

export interface StudyStore {
  study: StudyState
  loaded: boolean
  /** False when the file could not be read — the UI goes read-only rather than
   *  quietly overwriting progress it failed to see. */
  safeToWrite: boolean
  error: boolean
  update: (fn: (current: StudyState) => StudyState) => void
}

export function useBibleStudy(): StudyStore {
  const [study, setStudy] = useState<StudyState>(emptyStudy)
  const [loaded, setLoaded] = useState(false)
  const [safeToWrite, setSafeToWrite] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef<StudyState>(study)
  // Writes are debounced: a drill answers, grades, promotes and re-queues in
  // the same tick, and a fast reader can finish a card a second. One write per
  // burst instead of four.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const api = (window as any).electronAPI?.bible
    if (!api?.getStudy) { setLoaded(true); return }
    api.getStudy()
      .then((s: StudyState & { status?: string }) => {
        const next: StudyState = {
          verses: s?.verses || {},
          lessons: s?.lessons || {},
          streak: s?.streak || { days: [], best: 0 },
          badges: s?.badges || [],
          plans: s?.plans || {},
        }
        ref.current = next
        setStudy(next)
        if (s?.status === 'unreadable') setError(true)
        else setSafeToWrite(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoaded(true))
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [])

  const update = useCallback((fn: (current: StudyState) => StudyState) => {
    const next = fn(ref.current)
    ref.current = next
    setStudy(next)
    if (!safeToWrite) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      ;(window as any).electronAPI?.bible?.setStudy?.(ref.current).catch(() => {})
    }, 400)
  }, [safeToWrite])

  return { study, loaded, safeToWrite, error, update }
}

// ── Pure helpers the rooms share ────────────────────────────────────────────

export function addVerses(state: StudyState, refs: string[], now: number): StudyState {
  const verses = { ...state.verses }
  let added = false
  for (const r of refs) {
    if (verses[r]) continue           // already learning it — leave its box alone
    verses[r] = { box: 1, dueAt: now, reviews: 0 }
    added = true
  }
  return added ? { ...state, verses } : state
}

export function removeVerse(state: StudyState, ref: string): StudyState {
  if (!state.verses[ref]) return state
  const verses = { ...state.verses }
  delete verses[ref]
  return { ...state, verses }
}

export function setLesson(state: StudyState, key: string, progress: LessonProgress): StudyState {
  const existing = state.lessons[key]
  // A retake never lowers a score — the lesson was understood once.
  if (existing && existing.score >= progress.score) return state
  return { ...state, lessons: { ...state.lessons, [key]: progress } }
}

export function advancePlan(state: StudyState, planId: string, day: number, now: number): StudyState {
  const existing = state.plans[planId]
  return {
    ...state,
    plans: { ...state.plans, [planId]: { day, startedAt: existing?.startedAt || now } },
  }
}
