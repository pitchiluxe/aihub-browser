import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, Sparkles, Search } from 'lucide-react'
import { getBookMeta, getBooks, getChapter, parseRef, type Verse } from '../../services/bibleService'
import VerseText from '../bible/VerseText'
import BookSpread from '../bible/BookSpread'
import PageLeaf from '../bible/PageLeaf'
import VerseActions from '../bible/VerseActions'
import ShareSheet from '../bible/ShareSheet'
import NoteEditor from '../bible/NoteEditor'
import SavedVerses from '../bible/SavedVerses'
import BibleAssistant from '../bible/BibleAssistant'
import BookCover from '../bible/BookCover'
import VerseSearch from '../bible/VerseSearch'
import { useBibleSettings } from '../../services/bibleSettings'

// Shape persisted by the main process (see `bible:getMarks` / `bible:setMarks`
// in src/main/index.ts) — highlights, saved verses, notes and the last
// reading position, all keyed by verse ref (`BOOK.CHAPTER.VERSE`).
interface BibleMarks {
  highlights: Record<string, string>
  saved: { ref: string; ts: number }[]
  notes: Record<string, string>
  lastRead: { book: string; chapter: number } | null
}
const EMPTY_MARKS: BibleMarks = { highlights: {}, saved: [], notes: {}, lastRead: null }

// The spread always shows two consecutive chapters, so a completed turn moves
// by a whole sheet — two chapters, not one.
const STEP = 2
// How far the pointer must travel horizontally before we decide it is a page
// turn rather than a click on a verse or a vertical scroll.
const DRAG_THRESHOLD_PX = 14
const FLICK_PX_PER_EVENT = 6
const TURN_MS = 420

// Spreads are always anchored on an odd-numbered left page (base, base+1).
// `chapter` itself is not guaranteed to be odd — a "go to chapter" jump, a
// search result, or a restored reading position can land on any integer — so
// every place that turns `chapter` into a spread or a turn target reads it
// through this normalisation instead of assuming the invariant holds.
const toSpreadBase = (ch: number) => (ch % 2 === 1 ? ch : ch - 1)

export default function BiblePage() {
  const [bookId, setBookId] = useState('JHN')
  const [chapter, setChapter] = useState(3)
  const [selectedRef, setSelectedRef] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  // The book starts closed. Opening it is the one bit of ceremony in the app,
  // and it also hides the first-load chapter fetch behind something to look at.
  const [coverOpen, setCoverOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [bibleSettings] = useBibleSettings()

  // Highlights, saved verses, notes and reading position. `marks` drives
  // rendering; `marksRef` mirrors it synchronously and is what every write
  // reads from, so a write that lands later (e.g. the debounced reading-
  // position write below) is always building on top of the latest edit
  // rather than a copy captured when its effect last ran.
  const [marks, setMarks] = useState<BibleMarks>(EMPTY_MARKS)
  const marksRef = useRef<BibleMarks>(EMPTY_MARKS)
  const highlights = marks.highlights

  // Distinct from `marks.lastRead` being null: EMPTY_MARKS also has a null
  // `lastRead`, so content alone can't tell "not loaded yet" apart from
  // "loaded, nothing saved". The restore effect needs that distinction so a
  // first-time reader (genuinely no saved position) still gets `restored`
  // flipped to true and starts persisting their position going forward.
  const [marksLoaded, setMarksLoaded] = useState(false)

  // If the marks could not be read, we must not write: persisting a blank
  // slate would erase the reader's highlights, notes and saved verses — the
  // one thing in this app they cannot get back.
  const [marksSafeToWrite, setMarksSafeToWrite] = useState(false)
  const [marksError, setMarksError] = useState(false)

  useEffect(() => {
    window.electronAPI.bible.getMarks()
      .then((m: BibleMarks & { status?: string }) => {
        marksRef.current = m
        setMarks(m)
        if (m?.status === 'unreadable') setMarksError(true)
        else setMarksSafeToWrite(true)
      })
      .catch(() => setMarksError(true))
      .finally(() => setMarksLoaded(true))
  }, [])

  // The one path every mark write goes through: compute `next` off the ref
  // (never off a closed-over `marks`), commit it to the ref before anything
  // else runs, then mirror it into state for rendering and push it to disk.
  const persist = useCallback((update: (current: BibleMarks) => BibleMarks) => {
    const next = update(marksRef.current)
    marksRef.current = next
    setMarks(next)
    // Never write from a slate we didn't successfully load — see above.
    if (!marksSafeToWrite) return
    window.electronAPI.bible.setMarks(next).catch(() => {})
  }, [marksSafeToWrite])

  const highlightVerse = useCallback((color: string | null) => {
    if (!selectedRef) return
    persist(current => {
      const nextHighlights = { ...current.highlights }
      if (color) nextHighlights[selectedRef] = color
      else delete nextHighlights[selectedRef]
      return { ...current, highlights: nextHighlights }
    })
  }, [selectedRef, persist])

  const toggleSave = useCallback(() => {
    if (!selectedRef) return
    persist(current => {
      const exists = current.saved.some(s => s.ref === selectedRef)
      return {
        ...current,
        saved: exists
          ? current.saved.filter(s => s.ref !== selectedRef)
          : [{ ref: selectedRef, ts: Date.now() }, ...current.saved],
      }
    })
  }, [selectedRef, persist])

  // Editing happens in <NoteEditor>; this is only the write. An empty string
  // clears the note, which is how the editor's "Clear note" button works.
  const saveNote = useCallback((text: string) => {
    if (!selectedRef) return
    persist(current => {
      const nextNotes = { ...current.notes }
      if (text.trim()) nextNotes[selectedRef] = text.trim()
      else delete nextNotes[selectedRef]
      return { ...current, notes: nextNotes }
    })
    setNoteOpen(false)
  }, [selectedRef, persist])

  const removeSaved = useCallback((ref: string) => {
    persist(current => ({ ...current, saved: current.saved.filter(s => s.ref !== ref) }))
  }, [persist])

  // Restore the last reading position exactly once, as soon as marks have
  // arrived (successfully or not — see `marksLoaded` above). `restored` is
  // flipped unconditionally on that first pass, whether or not there was a
  // saved position to restore, so it both (a) never fires again and fights
  // the user's own navigation, and (b) doesn't get stuck open forever for a
  // first-time reader who has no `lastRead` yet, which would otherwise leave
  // the debounced write below permanently disarmed.
  // toSpreadBase() (below) normalises any chapter — including a saved even
  // one — to a valid spread, so handing it a raw restored chapter is safe;
  // we still clamp to the target book's own chapter count and bail on an
  // unknown book id, since a saved position can predate a book's data.
  // `restored` must be state, not a ref. As a ref it flipped true synchronously
  // inside this effect, while `setBookId`/`setChapter` below only take effect on
  // the next render — so the debounced writer downstream could fire in between
  // and persist the DEFAULT position over the reader's real one. Losing your
  // place every session is exactly the bug that produced. As state, the writer
  // cannot see `restored` until the restored position has actually rendered.
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    if (restored || !marksLoaded) return
    if (!marks.lastRead) { setRestored(true); return }
    const { book: savedBook, chapter: savedChapter } = marks.lastRead
    const meta = getBookMeta(savedBook)
    if (!meta) { setRestored(true); return }
    setBookId(savedBook)
    setChapter(Math.max(1, Math.min(meta.chapters, savedChapter)))
    setRestored(true)
  }, [marksLoaded, marks.lastRead])

  // Write the reading position back, debounced. Goes through `persist`, so it
  // reads and writes via `marksRef` like every other mark change — it can
  // never clobber a highlight/save/note made during the debounce window, and
  // it can never itself be clobbered by one that lands after it fires.
  useEffect(() => {
    if (!restored) return
    const id = window.setTimeout(() => {
      persist(current => ({ ...current, lastRead: { book: bookId, chapter } }))
    }, 800)
    return () => window.clearTimeout(id)
  }, [restored, bookId, chapter, persist])

  // A small window of chapters around the spread: the two visible pages plus
  // the faces the turning leaf reveals on either side. The book the chapters
  // came from is stored alongside them, because chapter number alone does not
  // identify a page: after a book change the loader is async, and a cache
  // keyed only by number would keep rendering the old book's chapter 1 under
  // the new book's heading — long enough for a click to bind a verse ref to
  // the wrong book. `chapterVerses` below refuses to serve another book's
  // text at all, so during that window the page is simply empty.
  const [pages, setPages] = useState<{ book: string; chapters: Record<number, Verse[]> }>(
    { book: bookId, chapters: {} },
  )
  const chapterVerses = (ch: number): Verse[] =>
    (pages.book === bookId ? pages.chapters[ch] : undefined) ?? []

  // Text of the currently selected verse, looked up from the `pages` cache.
  // Falls back to '' if the containing chapter hasn't loaded into the cache
  // yet — the share sheet still renders fine with an empty quote.
  const selectedVerseText = (() => {
    if (!selectedRef) return ''
    const parsed = parseRef(selectedRef)
    if (!parsed || parsed.bookId !== bookId) return ''
    return chapterVerses(parsed.chapter).find(v => v.v === parsed.verse)?.t ?? ''
  })()

  const [shareOpen, setShareOpen] = useState(false)

  // ── The turn ──────────────────────────────────────────────────────────────
  // The page owns the whole gesture: which way the sheet is going, how far
  // over it is, and whether it is easing to rest. Keeping it here (rather than
  // in the leaf) is what makes the sheet track the finger from the first
  // pixel — the pointer is already captured by the time the leaf mounts.
  const [turning, setTurning] = useState<'next' | 'prev' | null>(null)
  const [angle, setAngle] = useState(0)             // 0 → 180 degrees
  const [animating, setAnimating] = useState(false) // easing to a resting angle

  const angleRef = useRef(0)
  const dragRef = useRef<{ startX: number; width: number; velocity: number; lastX: number } | null>(null)
  const settleTimer = useRef<number | null>(null)
  const spreadRef = useRef<HTMLDivElement>(null)

  const prefersReduced = useRef(
    typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  ).current

  const book = getBooks().find(b => b.id === bookId)
  const lastChapter = book?.chapters ?? 1

  // The base of the currently settled (or settling) spread — see
  // `toSpreadBase`. Everything that positions the spread or the turning leaf
  // reads from this, not from `chapter` directly.
  const spreadBase = toSpreadBase(chapter)

  useEffect(() => {
    let cancelled = false
    // Two behind and three ahead of the base. The window has to cover every
    // chapter that can be on screen during a turn, not just the settled
    // spread: the leaf's two faces (`base+1` / `base+2` forward, `base` /
    // `base-1` back) and — since the half under the lifted sheet already
    // shows what the turn will reveal — `base+3` forward and `base-2` back.
    const wanted = [spreadBase - 2, spreadBase - 1, spreadBase, spreadBase + 1, spreadBase + 2, spreadBase + 3]
      .filter(c => c >= 1 && c <= lastChapter)
    Promise.all(wanted.map(async c => [c, await getChapter(bookId, c)] as const))
      .then(entries => { if (!cancelled) setPages({ book: bookId, chapters: Object.fromEntries(entries) }) })
    return () => { cancelled = true }
  }, [bookId, spreadBase, lastChapter])

  const canTurn = useCallback((dir: 'next' | 'prev') => {
    if (dir === 'prev') return spreadBase > 1
    return spreadBase + 1 < lastChapter
  }, [spreadBase, lastChapter])

  // Land the turn: ease the sheet to its resting angle, then commit or undo.
  // The one and only place a turn ends, so it can never fire twice or hang.
  const settle = useCallback((complete: boolean) => {
    if (settleTimer.current !== null) return    // already settling
    const resting = complete ? 180 : 0
    angleRef.current = resting
    dragRef.current = null
    if (prefersReduced) {
      setAnimating(false)
      setAngle(0)
    } else {
      setAnimating(true)
      setAngle(resting)
    }
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null
      setAnimating(false)
      setAngle(0)
      angleRef.current = 0
      endTurnRef.current(complete)
    }, prefersReduced ? 0 : TURN_MS)
  }, [prefersReduced])

  // `endTurn` is defined below but `settle` is referenced by handlers declared
  // above it; a ref keeps the ordering honest without a forward declaration.
  const endTurnRef = useRef<(completed: boolean) => void>(() => {})

  // The one entry point for starting a turn. `originX` present means a finger
  // is driving it; absent means the sheet animates itself.
  const startTurn = useCallback((dir: 'next' | 'prev', originX?: number, width?: number) => {
    if (turning || settleTimer.current !== null) return   // never two sheets at once
    if (!canTurn(dir)) return
    angleRef.current = 0
    setAngle(0)
    if (originX == null) {
      // Button or arrow key: nothing is holding the sheet, so it turns itself.
      dragRef.current = null
      setTurning(dir)
      // Two frames, so the 0-degree start style is committed before the flip
      // and the transition actually runs rather than snapping.
      requestAnimationFrame(() => requestAnimationFrame(() => settle(true)))
    } else {
      dragRef.current = { startX: originX, width: width || 1, velocity: 0, lastX: originX }
      setAnimating(false)
      setTurning(dir)
    }
  }, [turning, canTurn, settle])

  const endTurn = useCallback((completed: boolean) => {
    setTurning(null)
    if (!completed) return
    // The selected verse is about to leave the spread, so its action bar and
    // share sheet would be acting on something the reader can no longer see —
    // and once its chapter falls out of the prefetch window the sheet would
    // quote an empty string. A cancelled turn keeps the selection.
    setSelectedRef(null)
    setNoteOpen(false)
    setShareOpen(false)
    setChapter(c => {
      // Normalise the same way `spreadBase` does: the turn moves the base
      // that was actually on screen, regardless of whether `c` itself was
      // odd when the turn started.
      const base = toSpreadBase(c)
      const target = turning === 'prev' ? base - STEP : base + STEP
      return Math.max(1, Math.min(lastChapter, target))
    })
  }, [turning, lastChapter])

  endTurnRef.current = endTurn

  // A turn in flight must not outlive the page.
  useEffect(() => () => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
  }, [])

  // Buttons and arrow keys both come through startTurn, so they inherit the
  // same boundary guards and the same "one turn at a time" rule.
  //
  // Special pages are never unmounted — App.tsx keeps every one of them
  // mounted and hides the inactive ones with `display: none` — so this
  // window-level listener outlives the tab being on screen. Without the
  // visibility gate, an arrow key pressed on the homepage or in Settings
  // would turn pages in the hidden reader and the debounced position write
  // would persist the drift. `offsetParent` is null exactly when the element
  // or an ancestor is `display: none`, which is the mechanism App.tsx uses.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return
      // Ctrl+F is checked before the modifier bail-out below, which exists to
      // keep plain arrow-key turns from firing during app shortcuts.
      if ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); setSearchOpen(true); return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (e.key === 'ArrowRight') startTurn('next')
      if (e.key === 'ArrowLeft') startTurn('prev')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startTurn])

  // Drag detection lives on the spread rather than on the leaf, because the
  // leaf does not exist until we have decided a turn has begun. We wait for a
  // decisively horizontal movement so that clicking a verse and scrolling a
  // page both still work.
  const pressed = useRef<{ x: number; y: number } | null>(null)

  const captured = useRef<{ el: HTMLElement; id: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (turning || settleTimer.current !== null) return
    pressed.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // Already turning: this move is the drag itself, so advance the sheet.
    const drag = dragRef.current
    if (drag && turning) {
      drag.velocity = e.clientX - drag.lastX
      drag.lastX = e.clientX
      const travelled = turning === 'next' ? drag.startX - e.clientX : e.clientX - drag.startX
      const ratio = Math.max(0, Math.min(1, travelled / drag.width))
      angleRef.current = ratio * 180
      // Under reduced motion the sheet stays flat; the drag still navigates.
      if (!prefersReduced) setAngle(angleRef.current)
      return
    }

    const from = pressed.current
    if (!from || turning) return
    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (Math.abs(dx) < DRAG_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return
    pressed.current = null
    // Capture here rather than on pointerdown: capture also retargets the
    // compatibility mouse events, so taking it before the gesture is known to
    // be a drag would swallow the click that selects a verse.
    const el = e.currentTarget as HTMLElement
    try {
      el.setPointerCapture(e.pointerId)
      captured.current = { el, id: e.pointerId }
    } catch {
      captured.current = null
    }
    // Half the spread is how far the finger travels for a full 180 degrees.
    const half = (spreadRef.current?.offsetWidth ?? 2) / 2
    startTurn(dx < 0 ? 'next' : 'prev', from.x, half)
    // Apply this very move immediately, so the sheet is already lifted by the
    // pixel that started the turn rather than waiting for the next event.
    const d = dragRef.current
    if (d) {
      const travelled = Math.abs(dx)
      angleRef.current = Math.max(0, Math.min(1, travelled / d.width)) * 180
      if (!prefersReduced) setAngle(angleRef.current)
    }
  }

  // pointerup, pointercancel and lostpointercapture all land here; whichever
  // arrives first consumes the release and the rest are inert.
  const signalRelease = () => {
    pressed.current = null
    const cap = captured.current
    captured.current = null
    if (cap) {
      try {
        if (cap.el.hasPointerCapture(cap.id)) cap.el.releasePointerCapture(cap.id)
      } catch {
        /* the pointer is already gone; the decision below is what matters */
      }
    }
    const drag = dragRef.current
    if (!drag || !turning) return
    const flicked = turning === 'next'
      ? drag.velocity < -FLICK_PX_PER_EVENT
      : drag.velocity > FLICK_PX_PER_EVENT
    settle(angleRef.current > 90 || flicked)
  }

  const releasePress = () => { pressed.current = null }

  // Jump to a saved verse. `chapter` is set raw and clamped to the book, the
  // same as the reading-position restore — `toSpreadBase` normalises it into
  // a spread, so an even chapter lands correctly. Refused mid-turn for the
  // same reason the book dropdown is locked: the sheet in flight would land
  // its completion on the new position.
  const gotoRef = useCallback((ref: string) => {
    if (turning) return
    const parsed = parseRef(ref)
    if (!parsed) return
    const meta = getBookMeta(parsed.bookId)
    if (!meta) return
    setBookId(parsed.bookId)
    setChapter(Math.max(1, Math.min(meta.chapters, parsed.chapter)))
    setSelectedRef(ref)
    setSavedOpen(false)
  }, [turning])

  const page = (ch: number) => {
    if (ch < 1 || ch > lastChapter) return null      // blank leaf past the end of the book
    return (
      <div className="flex h-full flex-col">
        <div className="mb-4 shrink-0 text-xs uppercase tracking-widest opacity-45">{book?.name} {ch}</div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <VerseText
            showNumbers={bibleSettings.verseNumbers}
            bookId={bookId}
            chapter={ch}
            verses={chapterVerses(ch)}
            highlights={highlights}
            notes={marks.notes}
            selectedRef={selectedRef}
            onSelectVerse={setSelectedRef}
          />
        </div>
      </div>
    )
  }

  // Forward: the right-hand sheet lifts, its recto is the page you were
  // reading and its verso is the chapter that becomes the new left page.
  // Backward: the left-hand sheet lifts and reveals the chapter before it.
  // Both are expressed off `spreadBase` (the left page of the settled
  // spread), not off `chapter`, so the geometry holds for any starting
  // chapter, odd or even.
  const leafFaces = turning === 'prev'
    ? { front: page(spreadBase), back: page(spreadBase - 1) }
    : { front: page(spreadBase + 1), back: page(spreadBase + 2) }

  // While a sheet is in flight, the half it lifts off already shows what the
  // turn will reveal, exactly as a real book does — otherwise that half sits
  // there showing the page still printed on the sheet above it for the whole
  // 90-180 window, then pops when the turn lands. At 0 degrees the leaf's
  // front face covers that half pixel-for-pixel, so swapping its content at
  // turn start is invisible; at 180 degrees the leaf's back face covers the
  // *other* half, whose content likewise matches the settled spread. Cancel is
  // safe too: `turning` clears in the same commit that unmounts the leaf.
  // Based on `spreadBase` rather than `chapter` for the same reason as above.
  const spreadLeft = turning === 'prev' ? spreadBase - 2 : spreadBase
  const spreadRight = turning === 'next' ? spreadBase + 3 : spreadBase + 1

  if (!coverOpen && bibleSettings.showCover) {
    return (
      <div ref={rootRef} className="relative h-full bg-aihub-bg text-aihub-text">
        <BookCover
          onOpen={() => setCoverOpen(true)}
          // Only offer to "continue" once the saved position has actually been
          // restored — before that, `chapter` is still the default and the
          // cover would promise a page the reader never left off on.
          subtitle={restored && marks.lastRead && book ? `Continue — ${book.name} ${chapter}` : 'Click to open'}
        />
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex h-full bg-aihub-bg text-aihub-text">
      <div className="flex min-w-0 flex-1 flex-col p-8">
      <div className="mb-4 flex shrink-0 items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold">{book?.name} {chapter}</h1>
        <select
          value={bookId}
          onChange={e => {
            setBookId(e.target.value); setChapter(1)
            setSelectedRef(null); setNoteOpen(false); setShareOpen(false)
          }}
          // Locked mid-turn: the sheet already in flight would otherwise land
          // its completion on the new book and step past chapter 1.
          disabled={!!turning}
          className="bg-aihub-surface border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
        >
          {getBooks().map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button
          onClick={() => startTurn('prev')}
          disabled={!canTurn('prev') || !!turning}
          className="px-3 py-1.5 rounded-lg bg-aihub-surface border border-aihub-border/40 text-sm disabled:opacity-40"
        >Prev</button>
        <button
          onClick={() => startTurn('next')}
          disabled={!canTurn('next') || !!turning}
          className="px-3 py-1.5 rounded-lg bg-aihub-surface border border-aihub-border/40 text-sm disabled:opacity-40"
        >Next</button>
        <button
          onClick={() => setSearchOpen(true)}
          title="Search the Bible (Ctrl+F)"
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-aihub-border/40 bg-aihub-surface px-3 py-1.5 text-sm"
        >
          <Search size={14} /> Search
        </button>
        <button
          onClick={() => setAiOpen(o => !o)}
          title="Study with AI"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium"
          style={aiOpen
            ? { background: 'rgb(var(--ds-accent) / 0.9)', color: '#fff' }
            : { background: 'rgb(var(--ds-accent) / 0.14)', color: 'rgb(var(--ds-accent-soft))' }}
        >
          <Sparkles size={14} /> Ask
        </button>
        <button
          onClick={() => setSavedOpen(true)}
          title="Saved verses"
          className="flex items-center gap-1.5 rounded-lg border border-aihub-border/40 bg-aihub-surface px-3 py-1.5 text-sm"
        >
          <Bookmark size={14} /> Saved
          {marks.saved.length > 0 && (
            <span className="rounded-full bg-aihub-accent/20 px-1.5 text-[10px] font-bold text-aihub-accent">
              {marks.saved.length}
            </span>
          )}
        </button>
      </div>

      <div
        ref={spreadRef}
        className="min-h-0 flex-1"
        style={{
          ['--bible-font-scale' as any]: bibleSettings.fontScale,
          ['--bible-align' as any]: bibleSettings.justify ? 'justify' : 'left',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={signalRelease}
        onPointerCancel={signalRelease}
        onLostPointerCapture={signalRelease}
        onPointerLeave={releasePress}
      >
        <BookSpread
          left={page(spreadLeft)}
          right={page(spreadRight)}
          leafSide={turning === 'prev' ? 'left' : 'right'}
          paper={bibleSettings.paper}
          leaf={turning ? (
            <PageLeaf
              direction={turning}
              angle={angle}
              animating={animating && bibleSettings.animateTurn}
              durationMs={TURN_MS}
              paper={bibleSettings.paper}
              front={leafFaces.front}
              back={leafFaces.back}
            />
          ) : null}
        />
      </div>
      </div>

      <VerseSearch open={searchOpen} onClose={() => setSearchOpen(false)} onGoto={gotoRef} />

      <BibleAssistant
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        bookId={bookId}
        bookName={book?.name ?? ''}
        chapter={chapter}
        selectedRef={selectedRef}
        onOpenRef={gotoRef}
      />

      {/* A read failure must never be silent: the reader would keep marking
          verses believing they were being kept, and nothing would be saved. */}
      {marksError && (
        <div
          className="pointer-events-none absolute inset-x-0 top-2 z-50 mx-auto w-fit rounded-xl px-4 py-2 text-xs font-medium"
          style={{ background: 'rgba(239,68,68,0.16)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}
        >
          Couldn’t read your saved highlights and verses, so nothing is being saved right now — your existing marks are untouched. Reopen the Bible to retry.
        </div>
      )}

      {selectedRef && (
        <VerseActions
          verseRef={selectedRef}
          currentColor={marks.highlights[selectedRef]}
          isSaved={marks.saved.some(s => s.ref === selectedRef)}
          onHighlight={highlightVerse}
          onSave={toggleSave}
          hasNote={!!marks.notes[selectedRef]}
          onNote={() => setNoteOpen(true)}
          onShare={() => setShareOpen(true)}
          onClose={() => { setShareOpen(false); setNoteOpen(false); setSelectedRef(null) }}
        />
      )}

      {noteOpen && selectedRef && (
        <NoteEditor
          verseRef={selectedRef}
          initial={marks.notes[selectedRef] ?? ''}
          onSave={saveNote}
          onClose={() => setNoteOpen(false)}
        />
      )}

      {shareOpen && selectedRef && (
        <ShareSheet
          verseRef={selectedRef}
          text={selectedVerseText}
          onClose={() => setShareOpen(false)}
        />
      )}

      {savedOpen && (
        <SavedVerses
          saved={marks.saved}
          notes={marks.notes}
          onOpen={gotoRef}
          onRemove={removeSaved}
          onClose={() => setSavedOpen(false)}
        />
      )}
    </div>
  )
}
