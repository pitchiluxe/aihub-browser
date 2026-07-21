import React, { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  front: React.ReactNode          // the face of the leaf as it lies on the book
  back: React.ReactNode           // the face revealed as the leaf swings over
  onComplete: () => void          // fired once the turn passes the point of no return
  onCancel: () => void            // fired when the leaf springs back
  direction: 'next' | 'prev'
  auto?: boolean                  // when true the leaf turns itself (button / keyboard)
  originX?: number                // clientX the drag began at; omit for an auto turn
}

const DURATION_MS = 420
const FLICK_PX_PER_EVENT = 6

// One turning sheet. Rotation is driven directly by pointer movement so the
// page tracks the finger, then either completes or springs back on release.
// Only `transform` and `opacity` animate, so the whole turn stays on the
// compositor.
//
// The component is a small one-shot state machine: it settles exactly once,
// into either `onComplete` or `onCancel`, and every timer, frame and listener
// it owns is torn down on unmount.
export default function PageLeaf({ front, back, onComplete, onCancel, direction, auto, originX }: Props) {
  const [angle, setAngle] = useState(0)          // 0 → 180 degrees
  const [dragging, setDragging] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const startX = useRef(originX ?? 0)
  const lastX = useRef(originX ?? 0)
  const velocity = useRef(0)
  const width = useRef(1)
  const angleRef = useRef(0)                     // pointer handlers read this, not state

  const settled = useRef(false)                  // guarantees one and only one outcome
  const timer = useRef<number | null>(null)
  const frame = useRef<number | null>(null)

  // The parent passes fresh closures on every render; holding them in a ref
  // keeps the mount effect from restarting (and re-arming its timer) whenever
  // the parent happens to re-render mid-turn.
  const callbacks = useRef({ onComplete, onCancel })
  callbacks.current = { onComplete, onCancel }

  const [prefersReduced] = useState(() =>
    typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )

  // The single exit. Snaps the leaf to its resting angle, lets the CSS
  // transition run, then hands control back to the page exactly once.
  const settle = useCallback((complete: boolean) => {
    if (settled.current) return
    settled.current = true
    setDragging(false)
    // Under reduced motion the leaf never rotates at all — it stays at 0
    // degrees, which is pixel-for-pixel the page already underneath it, and
    // the spread simply changes when the zero-length settle timer fires.
    if (!prefersReduced) {
      const resting = complete ? 180 : 0
      angleRef.current = resting
      setAngle(resting)
    }
    timer.current = window.setTimeout(() => {
      timer.current = null
      if (complete) callbacks.current.onComplete()
      else callbacks.current.onCancel()
    }, prefersReduced ? 0 : DURATION_MS)
  }, [prefersReduced])

  // Tear down anything still pending. Kept separate from the driving effect so
  // it runs on unmount no matter which path the leaf took.
  //
  // `settled` is released here as well. Under StrictMode the mount effects run
  // create → destroy → create, and a settle raised in the first pass would
  // otherwise leave the guard latched with its timer already cleared: the
  // second pass would early-return and the outcome would never fire at all.
  // Releasing it in the same cleanup that clears the timer keeps flag and
  // timer in step, so exactly one outcome is always in flight.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    timer.current = null
    frame.current = null
    settled.current = false
  }, [])

  // Mount-time driver, run once. Either the leaf animates itself (button or
  // arrow key) or it binds to the pointer that started the drag.
  useEffect(() => {
    width.current = rootRef.current?.offsetWidth || 1

    // Auto turn: nothing is holding the page, so flip it on the next frame and
    // let the CSS transition carry it. Under reduced motion there is no
    // animation to wait for — the page simply changes.
    if (auto || originX == null) {
      if (prefersReduced) {
        settle(true)
      } else {
        // Two frames, not one: a rAF callback runs before the style pass of the
        // frame it belongs to, and React flushes the state change in the
        // following microtask, so a single frame can hand the compositor 0 and
        // 180 degrees with no computed style in between and the transition
        // never starts. The second frame guarantees the 0-degree start style
        // has been committed first.
        frame.current = requestAnimationFrame(() => {
          frame.current = requestAnimationFrame(() => {
            frame.current = null
            settle(true)
          })
        })
      }
      return
    }

    // Drag turn: the pointerdown happened on the spread before this component
    // existed, so listen on the window rather than on our own subtree. That
    // also keeps the turn alive if the finger leaves the page.
    setDragging(true)

    const onMove = (e: PointerEvent) => {
      if (settled.current) return
      velocity.current = e.clientX - lastX.current
      lastX.current = e.clientX
      // Dragging right-to-left turns forward; the sign flips going back.
      const travelled = direction === 'next' ? startX.current - e.clientX : e.clientX - startX.current
      const ratio = Math.max(0, Math.min(1, travelled / width.current))
      // `angleRef` is the drag's progress and always tracks the finger, since
      // the release decision reads it. Only the rendered angle is withheld
      // under reduced motion, so the sheet never rotates while the drag still
      // navigates normally.
      angleRef.current = ratio * 180
      if (!prefersReduced) setAngle(angleRef.current)
    }

    const onRelease = () => {
      if (settled.current) return
      const flicked = direction === 'next'
        ? velocity.current < -FLICK_PX_PER_EVENT
        : velocity.current > FLICK_PX_PER_EVENT
      settle(angleRef.current > 90 || flicked)
    }

    // `blur` covers the case where the window loses focus mid-drag and no
    // pointerup or pointercancel ever arrives — without it the leaf would hang.
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onRelease)
    window.addEventListener('pointercancel', onRelease)
    window.addEventListener('blur', onRelease)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onRelease)
      window.removeEventListener('pointercancel', onRelease)
      window.removeEventListener('blur', onRelease)
    }
    // Intentionally mount-only: the leaf is created for one turn and discarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Deepest at the halfway point, where the sheet stands upright to the light.
  const shadow = Math.sin((angle / 180) * Math.PI) * 0.45
  const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
  const still = dragging || prefersReduced
  const transition = still ? 'none' : `transform ${DURATION_MS}ms ${easing}`
  const shadeTransition = still ? 'none' : `opacity ${DURATION_MS}ms ${easing}`

  // The leaf is purely a picture of the turn — the window listeners drive it,
  // so it must never swallow clicks meant for the page underneath.
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30" style={{ perspective: 2200 }}>
      <div
        className={`absolute inset-0 ${direction === 'next' ? 'origin-left' : 'origin-right'}`}
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateY(${direction === 'next' ? -angle : angle}deg)`,
          transition,
          willChange: 'transform',
          touchAction: 'none',
        }}
      >
        <div
          className="absolute inset-0 bible-paper overflow-hidden p-10"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {front}
          {/* Opacity-only so the shading rides the compositor with the rotation. */}
          <div
            className="pointer-events-none absolute inset-0 bg-black"
            style={{ opacity: shadow * 0.5, transition: shadeTransition, willChange: 'opacity' }}
          />
        </div>
        <div
          className="absolute inset-0 bible-paper overflow-hidden p-10"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          {back}
          <div
            className="pointer-events-none absolute inset-0 bg-black"
            style={{ opacity: shadow * 0.35, transition: shadeTransition, willChange: 'opacity' }}
          />
        </div>
      </div>
    </div>
  )
}
