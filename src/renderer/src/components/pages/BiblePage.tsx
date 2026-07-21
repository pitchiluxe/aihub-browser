import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getBooks, getChapter, type Verse } from '../../services/bibleService'
import VerseText from '../bible/VerseText'
import BookSpread from '../bible/BookSpread'
import PageLeaf from '../bible/PageLeaf'

// The spread always shows two consecutive chapters, so a completed turn moves
// by a whole sheet — two chapters, not one.
const STEP = 2
// How far the pointer must travel horizontally before we decide it is a page
// turn rather than a click on a verse or a vertical scroll.
const DRAG_THRESHOLD_PX = 14

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

  // A small window of chapters around the spread: the two visible pages plus
  // the faces the turning leaf reveals on either side.
  const [pages, setPages] = useState<Record<number, Verse[]>>({})

  const [turning, setTurning] = useState<'next' | 'prev' | null>(null)
  const [autoTurn, setAutoTurn] = useState(false)   // true when a button/key started the turn
  const [dragOriginX, setDragOriginX] = useState<number | null>(null)

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
      .then(entries => { if (!cancelled) setPages(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [bookId, spreadBase, lastChapter])

  const canTurn = useCallback((dir: 'next' | 'prev') => {
    if (dir === 'prev') return spreadBase > 1
    return spreadBase + 1 < lastChapter
  }, [spreadBase, lastChapter])

  // The one entry point for starting a turn. `originX` present means a finger
  // is driving it; absent means the leaf animates itself.
  const startTurn = useCallback((dir: 'next' | 'prev', originX?: number) => {
    if (turning) return                       // never two sheets in flight at once
    if (!canTurn(dir)) return
    setAutoTurn(originX == null)
    setDragOriginX(originX ?? null)
    setTurning(dir)
  }, [turning, canTurn])

  const endTurn = useCallback((completed: boolean) => {
    setTurning(null)
    setAutoTurn(false)
    setDragOriginX(null)
    if (!completed) return
    setChapter(c => {
      // Normalise the same way `spreadBase` does: the turn moves the base
      // that was actually on screen, regardless of whether `c` itself was
      // odd when the turn started.
      const base = toSpreadBase(c)
      const target = turning === 'prev' ? base - STEP : base + STEP
      return Math.max(1, Math.min(lastChapter, target))
    })
  }, [turning, lastChapter])

  // Buttons and arrow keys both come through startTurn, so they inherit the
  // same boundary guards and the same "one turn at a time" rule.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  // Capture is attempted the instant a turn starts, so the release is
  // normally guaranteed to come back to this element even if the finger
  // leaves the window. But `setPointerCapture` can throw (see the try/catch
  // below), and release delivery must not depend on it succeeding — so
  // `awaitingRelease` tracks "a drag turn is waiting for its release" on its
  // own, independent of whether `captured` ever got populated. `releaseSignal`
  // hands the release to the leaf, which may not have bound its own window
  // listeners yet — its mount effect is passive and can be flushed after the
  // pointer has already come up.
  const captured = useRef<{ el: HTMLElement; id: number } | null>(null)
  const awaitingRelease = useRef(false)
  const [releaseSignal, setReleaseSignal] = useState(0)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    pressed.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerMove = (e: React.PointerEvent) => {
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
    // Set regardless of whether capture above succeeded — the leaf still
    // needs its release signal either way.
    awaitingRelease.current = true
    startTurn(dx < 0 ? 'next' : 'prev', from.x)
  }

  // pointerup, pointercancel and lostpointercapture all land here; whichever
  // arrives first consumes the pending release and the rest are inert.
  const signalRelease = () => {
    pressed.current = null
    if (!awaitingRelease.current) return
    awaitingRelease.current = false
    const cap = captured.current
    captured.current = null
    if (cap) {
      try {
        if (cap.el.hasPointerCapture(cap.id)) cap.el.releasePointerCapture(cap.id)
      } catch {
        /* the pointer is already gone; the signal below is what matters */
      }
    }
    setReleaseSignal(s => s + 1)
  }

  const releasePress = () => { pressed.current = null }

  const page = (ch: number) => {
    if (ch < 1 || ch > lastChapter) return null      // blank leaf past the end of the book
    return (
      <div className="flex h-full flex-col">
        <div className="mb-4 shrink-0 text-xs uppercase tracking-widest opacity-45">{book?.name} {ch}</div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <VerseText
            bookId={bookId}
            chapter={ch}
            verses={pages[ch] ?? []}
            highlights={{}}
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

  return (
    <div className="flex h-full flex-col bg-aihub-bg text-aihub-text p-8">
      <div className="mb-4 flex shrink-0 items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold">{book?.name} {chapter}</h1>
        <select
          value={bookId}
          onChange={e => { setBookId(e.target.value); setChapter(1); setSelectedRef(null) }}
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
      </div>

      <div
        className="min-h-0 flex-1"
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
          leaf={turning ? (
            <PageLeaf
              key={`${bookId}-${chapter}-${turning}`}
              direction={turning}
              auto={autoTurn}
              originX={dragOriginX ?? undefined}
              releaseSignal={releaseSignal}
              front={leafFaces.front}
              back={leafFaces.back}
              onComplete={() => endTurn(true)}
              onCancel={() => endTurn(false)}
            />
          ) : null}
        />
      </div>
    </div>
  )
}
