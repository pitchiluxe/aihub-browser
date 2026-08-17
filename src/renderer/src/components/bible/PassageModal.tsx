import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, ExternalLink,
  FlaskConical, Loader2, Maximize2, Minimize2, X,
} from 'lucide-react'
import { getBookMeta, getChapter, refKey, type Verse } from '../../services/bibleService'
import { useBibleSettings } from '../../services/bibleSettings'
import VerseText from './VerseText'

export interface PassageView {
  bookId: string
  chapter: number
  from: number
  to: number
  /** How the passage is written for a human — "Luke 2:1–20". */
  label: string
}

interface Props {
  views: PassageView[]
  /** Which passage to open on, and which verse to ring inside it. */
  startIndex?: number
  focusRef?: string | null
  highlights: Record<string, string>
  notes: Record<string, string>
  savedRefs: string[]
  onClose: () => void
  /** Leave the popup for the full reader, at this verse. */
  onOpenInBible: (ref: string) => void
  onToggleSave: (ref: string) => void
  onAddToLab?: (ref: string) => void
  inLab?: (ref: string) => boolean
}

/**
 * Scripture, on the page, without leaving the room you were in.
 *
 * Every study room used to answer "read it" by opening the Bible in a new tab,
 * which both lost the reader's place in the lesson or the plan and left a
 * graveyard of identical Bible tabs behind. This is the same text on the same
 * paper — literally the reader's own <VerseText> and .bible-paper, honouring
 * the same font-scale, justification and verse-number preferences — shown over
 * whatever room asked for it. Close it and you are back exactly where you were,
 * with the plan's "mark done" button still under your cursor.
 *
 * The full reader is still one click away for anyone who wants it; that is the
 * one path here that changes tabs, and only because the reader asked.
 */
export default function PassageModal({
  views, startIndex = 0, focusRef, highlights, notes, savedRefs,
  onClose, onOpenInBible, onToggleSave, onAddToLab, inLab,
}: Props) {
  const [settings] = useBibleSettings()
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(views.length - 1, 0)))
  // A passage is a window on a chapter; the chapter is always there behind it.
  // Expanding reads the rest without ever leaving this sheet.
  const [whole, setWhole] = useState(false)
  const [chapterOffset, setChapterOffset] = useState(0)
  const [verses, setVerses] = useState<Verse[] | null>(null)
  const [selected, setSelected] = useState<string | null>(focusRef ?? null)

  const view = views[index]
  const meta = view ? getBookMeta(view.bookId) : undefined
  // chapterOffset walks off the passage; it is clamped to the book so the last
  // chapter of Jude cannot page into nothing.
  const chapter = useMemo(() => {
    if (!view || !meta) return view?.chapter ?? 1
    return Math.max(1, Math.min(meta.chapters, view.chapter + chapterOffset))
  }, [view, meta, chapterOffset])
  const offChapter = chapter !== view?.chapter

  useEffect(() => { setSelected(focusRef ?? null) }, [focusRef])

  useEffect(() => {
    if (!view) return
    let live = true
    setVerses(null)
    getChapter(view.bookId, chapter)
      .then(vs => { if (live) setVerses(vs) })
      .catch(() => { if (live) setVerses([]) })
    return () => { live = false }
  }, [view?.bookId, chapter])

  // Showing the whole chapter, or just the verses the room pointed at.
  const shown = useMemo(() => {
    if (!verses) return null
    if (whole || offChapter) return verses
    return verses.filter(v => v.v >= view.from && v.v <= view.to)
  }, [verses, whole, offChapter, view?.from, view?.to])

  const goPassage = useCallback((delta: number) => {
    const target = index + delta
    if (target < 0 || target >= views.length) return false
    setIndex(target)
    setChapterOffset(0)
    setWhole(false)
    setSelected(null)
    return true
  }, [index, views.length])

  const goChapter = useCallback((delta: number) => {
    if (!meta) return
    const target = chapter + delta
    if (target < 1 || target > meta.chapters) return
    setChapterOffset(target - (view?.chapter ?? 1))
    setSelected(null)
  }, [meta, chapter, view?.chapter])

  // One pair of arrows for both axes: step through the passages the room gave
  // us first, and only walk into neighbouring chapters once those run out.
  // Two separate sets of arrows for "next passage" and "next chapter" is more
  // honest about the model and much worse to use.
  const prev = useCallback(() => {
    if (offChapter || whole) { goChapter(-1); return }
    if (!goPassage(-1)) goChapter(-1)
  }, [offChapter, whole, goChapter, goPassage])

  const next = useCallback(() => {
    if (offChapter || whole) { goChapter(1); return }
    if (!goPassage(1)) goChapter(1)
  }, [offChapter, whole, goChapter, goPassage])

  // Esc closes and the arrow keys page. The reader expects both, and a popup
  // you can only dismiss with the mouse is a popup that traps you mid-lesson.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     { e.stopPropagation(); onClose() }
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft')  prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, next, prev])

  if (!view) return null

  const bookName = meta?.name || view.bookId
  const heading = offChapter ? `${bookName} ${chapter}` : view.label
  const savedSet = new Set(savedRefs)
  const selectedSaved = !!selected && savedSet.has(selected)
  const canPrev = index > 0 || chapter > 1
  const canNext = index < views.length - 1 || (!!meta && chapter < meta.chapters)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-8"
        style={{ background: 'rgba(8,6,3,0.72)', backdropFilter: 'blur(10px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.97 }}
          transition={{ type: 'spring', damping: 30, stiffness: 340 }}
          onClick={e => e.stopPropagation()}
          className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
          style={{ boxShadow: '0 30px 90px rgba(0,0,0,0.65)', border: '1px solid rgba(230,200,110,0.28)' }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-3 px-5 py-3"
            style={{ background: 'var(--ds-panel-bg)', borderBottom: '1px solid rgba(230,200,110,0.16)' }}>
            <BookOpen size={15} style={{ color: '#e6c86e' }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold" style={{ color: 'rgb(var(--ds-text-2))' }}>{heading}</div>
              <div className="text-[10.5px] opacity-45">
                World English Bible
                {views.length > 1 && !offChapter && ` · passage ${index + 1} of ${views.length}`}
              </div>
            </div>
            <button
              onClick={() => { setWhole(w => !w); setChapterOffset(0) }}
              title={whole || offChapter ? 'Just the passage' : 'Read the whole chapter'}
              className="rounded-lg p-1.5 opacity-55 transition-opacity hover:opacity-100"
              style={{ border: '1px solid var(--ds-border-sm)' }}
            >
              {whole || offChapter ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button onClick={onClose} title="Close (Esc)"
              className="rounded-lg p-1.5 opacity-55 transition-opacity hover:opacity-100"
              style={{ border: '1px solid var(--ds-border-sm)' }}>
              <X size={14} />
            </button>
          </div>

          {/* The page itself — the reader's own paper and prose settings. */}
          <div
            className={`min-h-0 flex-1 overflow-y-auto ${settings.paper === 'clean' ? 'bible-paper bible-paper-clean' : 'bible-paper'}`}
            style={{
              padding: '32px clamp(24px, 5vw, 56px)',
              ['--bible-font-scale' as any]: settings.fontScale,
              ['--bible-align' as any]: settings.justify ? 'justify' : 'left',
            }}
          >
            {shown === null ? (
              <div className="flex items-center gap-2 py-10 text-sm opacity-60">
                <Loader2 size={14} className="animate-spin" /> Turning to the page…
              </div>
            ) : shown.length === 0 ? (
              <p className="py-10 text-sm opacity-60">That passage is not in this translation.</p>
            ) : (
              <>
                <div className="mb-5 text-center text-[11px] font-bold uppercase tracking-[0.3em]"
                  style={{ color: 'rgba(120,82,38,0.55)' }}>
                  {bookName} {chapter}
                </div>
                <VerseText
                  bookId={view.bookId}
                  chapter={chapter}
                  verses={shown}
                  highlights={highlights}
                  notes={notes}
                  selectedRef={selected}
                  showNumbers={settings.verseNumbers}
                  onSelectVerse={ref => setSelected(cur => (cur === ref ? null : ref))}
                />
              </>
            )}
          </div>

          {/* Footer — navigation, and what you can do with the verse you tapped */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3"
            style={{ background: 'var(--ds-panel-bg)', borderTop: '1px solid rgba(230,200,110,0.16)' }}>
            <button onClick={prev} disabled={!canPrev}
              className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-25"
              style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
              <ChevronLeft size={13} /> Back
            </button>
            <button onClick={next} disabled={!canNext}
              className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-25"
              style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
              Next <ChevronRight size={13} />
            </button>

            <div className="flex-1" />

            {selected ? (
              <>
                <span className="text-[10.5px] font-semibold opacity-45">
                  {selected.split('.')[2] ? `verse ${selected.split('.')[2]}` : ''}
                </span>
                <button onClick={() => onToggleSave(selected)}
                  className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
                  style={selectedSaved
                    ? { background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }
                    : { background: 'rgba(230,200,110,0.14)', border: '1px solid rgba(230,200,110,0.3)', color: '#e6c86e' }}>
                  {selectedSaved ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
                  {selectedSaved ? 'Saved' : 'Save verse'}
                </button>
                {onAddToLab && (
                  <button onClick={() => onAddToLab(selected)} disabled={inLab?.(selected)}
                    className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                    style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
                    <FlaskConical size={12} /> {inLab?.(selected) ? 'In the Lab' : 'Learn it'}
                  </button>
                )}
              </>
            ) : (
              <span className="text-[10.5px] opacity-40">Tap a verse to save it or learn it by heart</span>
            )}

            <button
              onClick={() => onOpenInBible(selected || refKey(view.bookId, chapter, whole || offChapter ? 1 : view.from))}
              title="Open this passage in the full Bible reader"
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
              style={{ background: 'rgba(230,200,110,0.1)', border: '1px solid rgba(230,200,110,0.24)', color: '#e6c86e' }}>
              <ExternalLink size={12} /> Open in the Bible
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

/** A single verse as a one-verse passage — what most rooms hand this popup. */
export function verseView(ref: string, label: string): PassageView | null {
  const m = /^([A-Z0-9]{3})\.(\d+)\.(\d+)$/.exec(ref || '')
  if (!m) return null
  const verse = Number(m[3])
  return { bookId: m[1], chapter: Number(m[2]), from: verse, to: verse, label }
}
