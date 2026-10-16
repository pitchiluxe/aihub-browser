/**
 * What every kind of deck shares — a turntable, a CDJ jog wheel, a
 * controller jog: something that turns with the music, and a surface the
 * hand scratches and nudges.
 *
 * The turn is a compositor animation (the GPU spins the layer at the deck's
 * speed without the page producing frames), re-aligned ten times a second and
 * every frame only while a hand is on it. See Platter.tsx for why.
 */
import React, { useEffect, useRef } from 'react'
import type { Deck } from './engine/DjEngine'
import { useRafThrottled } from './controls'

export const DEG_PER_SEC = 200 // 33⅓ rpm
/** Further off than this the layer jumps instead of easing (seek, cue, hot cue). */
const SNAP_DEG = 40
/** One turn, in milliseconds. */
export const REV_MS = (360 / DEG_PER_SEC) * 1000
/** Track position (degrees of turn) → time within one turn of the spin animation. */
export const angleMs = (deg: number) => ((((deg % 360) + 360) % 360) / 360) * REV_MS

/**
 * Spins `spinRef` with the track. `onTick` runs on the same throttled clock
 * with the song's progress (0..1) — the turntable moves its tonearm with it.
 */
export function useDeckSpin(deck: Deck, spinRef: React.RefObject<HTMLElement | SVGElement>, onTick?: (progress: number) => void): void {
  const spin = useRef<Animation | null>(null)
  useEffect(() => {
    const el = spinRef.current as Element | null
    if (!el) return
    const a = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: REV_MS, iterations: Infinity })
    a.pause()
    spin.current = a
    return () => { a.cancel(); spin.current = null }
  }, [spinRef])

  const loaded = !!deck.track
  useRafThrottled(() => {
    const a = spin.current
    if (a) {
      const target = angleMs(loaded ? deck.time * DEG_PER_SEC : 0)
      if (loaded && deck.playing && !deck.held) {
        if (Math.abs(a.playbackRate - deck.rate) > 1e-4) a.updatePlaybackRate(deck.rate)
        if (a.playState !== 'running') { a.currentTime = target; a.play() }
        else {
          let diff = target - (Number(a.currentTime) % REV_MS)
          if (diff > REV_MS / 2) diff -= REV_MS
          if (diff < -REV_MS / 2) diff += REV_MS
          // A seek, cue or hot cue moves it; small clock wobble does not.
          if (Math.abs(diff) > REV_MS * (SNAP_DEG / 360) / 4) a.currentTime = target
        }
      } else {
        if (a.playState === 'running') a.pause()
        a.currentTime = target
      }
    }
    onTick?.(deck.duration ? Math.min(1, deck.time / deck.duration) : 0)
  }, deck.held ? 0 : 100)
}

/**
 * Hand on the jog: the inner area holds the music like vinyl and scratches;
 * the outer rim (beyond `rimFrom` of the radius) nudges the tempo while it
 * plays. Spread the returned handlers on the round surface.
 */
export function useScratch(deck: Deck, rootRef: React.RefObject<HTMLElement>, rimFrom = 0.8) {
  const drag = useRef<{ mode: 'scratch' | 'bend'; last: number; lastT: number; pos: number } | null>(null)
  const centre = () => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, half: r.width / 2 }
  }
  const angleAt = (e: React.PointerEvent) => {
    const k = centre()
    return Math.atan2(e.clientY - k.y, e.clientX - k.x) * 180 / Math.PI
  }
  const radiusAt = (e: React.PointerEvent) => {
    const k = centre()
    return Math.hypot(e.clientX - k.x, e.clientY - k.y) / k.half
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (!deck.track || e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const mode = deck.playing && radiusAt(e) > rimFrom ? 'bend' : 'scratch'
    drag.current = { mode, last: angleAt(e), lastT: performance.now(), pos: deck.time }
    if (mode === 'scratch') deck.grab()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const a = angleAt(e)
    let delta = a - d.last
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    const now = performance.now()
    const dt = Math.max(1, now - d.lastT)
    d.last = a
    d.lastT = now
    if (d.mode === 'scratch') {
      d.pos += delta / DEG_PER_SEC
      deck.scratchTo(d.pos)
    } else deck.setBend((delta / dt) * 0.35) // deg/ms → ±bend
  }
  /** Hand off — also when the pointer is lost (window blur, capture stolen). */
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.mode === 'bend') deck.setBend(0)
    else deck.release()
  }
  return { onPointerDown, onPointerMove, onPointerUp: onUp, onPointerCancel: onUp, onLostPointerCapture: onUp }
}

/**
 * A straight touch strip: drag along it to scratch (a held deck) or, while
 * playing, to nudge the tempo — the screen deck has no platter to turn.
 * One strip-width of travel is one turn of a record.
 */
export function useStripScratch(deck: Deck, stripRef: React.RefObject<HTMLElement>) {
  const drag = useRef<{ x: number; t: number; pos: number; mode: 'scratch' | 'bend' } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!deck.track || e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    // Holding Shift (or a paused deck) scratches; a playing deck nudges.
    const mode = deck.playing && !e.shiftKey ? 'bend' : 'scratch'
    drag.current = { x: e.clientX, t: performance.now(), pos: deck.time, mode }
    if (mode === 'scratch') deck.grab()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = stripRef.current
    if (!d || !el) return
    const w = Math.max(1, el.getBoundingClientRect().width)
    const dx = e.clientX - d.x
    const now = performance.now()
    const dt = Math.max(1, now - d.t)
    d.x = e.clientX
    d.t = now
    const deg = (dx / w) * 360
    if (d.mode === 'scratch') { d.pos += deg / DEG_PER_SEC; deck.scratchTo(d.pos) }
    else deck.setBend((deg / dt) * 0.35)
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.mode === 'bend') deck.setBend(0)
    else deck.release()
  }
  return { onPointerDown, onPointerMove, onPointerUp: onUp, onPointerCancel: onUp, onLostPointerCapture: onUp }
}
