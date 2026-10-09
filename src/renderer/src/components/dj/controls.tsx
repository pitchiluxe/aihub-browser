/**
 * Hardware-style controls for AIHub DJ. All take a 0..1 value and report
 * 0..1 back; double-click returns a control to its detent.
 */
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Deck } from './engine/DjEngine'

/** Re-render when the deck reports a change. */
export function useDeck(deck: Deck): number {
  return useSyncExternalStore(deck.subscribe, deck.getVersion)
}

/** Run `cb` every animation frame while mounted. */
export function useRaf(cb: () => void): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    let id = 0
    const loop = () => { ref.current(); id = requestAnimationFrame(loop) }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
}

/**
 * Like useRaf, but at most once every `minMs`. The console's drawing shares
 * the GPU with the hidden YouTube players' video decoding; drawing every
 * display frame starved them and made the music stutter.
 */
export function useRafThrottled(cb: (now: number) => void, minMs: number): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    const sub: Sub = { cb: now => ref.current(now), minMs, last: 0 }
    subs.add(sub)
    schedule()
    return () => { subs.delete(sub) }
  }, [minMs])
}

/**
 * One shared clock for everything on the console that animates. Each part
 * asking for frames on its own schedule meant some part wanted almost every
 * display frame, so the page rendered ~60 times a second. Here every part
 * runs on the same frame, at most 30 times a second (every frame only while
 * something needs it, like a hand on a record).
 */
interface Sub { cb: (now: number) => void; minMs: number; last: number }
const subs = new Set<Sub>()
const BASE_MS = 33
let pending = false
function schedule(): void {
  if (pending || !subs.size) return
  pending = true
  const everyFrame = [...subs].some(s => s.minMs <= 0)
  if (everyFrame) requestAnimationFrame(run)
  else window.setTimeout(() => requestAnimationFrame(run), BASE_MS - 10)
}
function run(now: number): void {
  pending = false
  for (const s of subs) {
    if (s.minMs <= 0 || now - s.last >= s.minMs - 6) {
      s.last = now
      try { s.cb(now) } catch (e) { console.error(e) }
    }
  }
  schedule()
}

/** Highest canvas resolution the console draws at — sharp enough, half the raster work of 2×+. */
export const MAX_CANVAS_SCALE = 1.5

/**
 * A canvas's CSS size and its backing-store scale, measured when it resizes
 * instead of on every frame (a per-frame getBoundingClientRect forced layout
 * for every canvas, every frame).
 */
export function useCanvasBox(ref: React.RefObject<HTMLCanvasElement>) {
  const box = useRef({ w: 0, h: 0, k: 1 })
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const measure = () => {
      const w = cv.clientWidth
      const h = cv.clientHeight
      const rect = cv.getBoundingClientRect()
      // Device pixels including any CSS zoom on the console, capped.
      const k = Math.min(MAX_CANVAS_SCALE, (window.devicePixelRatio || 1) * (w ? rect.width / w : 1))
      box.current = { w, h, k }
      const bw = Math.round(w * k)
      const bh = Math.round(h * k)
      if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(cv)
    return () => ro.disconnect()
  }, [ref])
  return box
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Vertical drag (and wheel) editing shared by knobs and faders. */
function useDragValue(value: number, onChange: (v: number) => void, sensitivity: number, axis: 'y' | 'x' = 'y', invert = false) {
  const start = useRef<{ p: number; v: number } | null>(null)
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { p: axis === 'y' ? e.clientY : e.clientX, v: value }
    e.preventDefault()
  }, [value, axis])
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current) return
    const p = axis === 'y' ? e.clientY : e.clientX
    let d = (axis === 'y' ? start.current.p - p : p - start.current.p) / sensitivity
    if (invert) d = -d
    if (e.shiftKey) d *= 0.2 // fine adjust
    onChange(clamp01(start.current.v + d))
  }, [onChange, sensitivity, axis, invert])
  const onPointerUp = useCallback(() => { start.current = null }, [])
  const onWheel = useCallback((e: React.WheelEvent) => {
    const step = (e.shiftKey ? 0.005 : 0.025) * (e.deltaY < 0 ? 1 : -1) * (invert ? -1 : 1)
    onChange(clamp01(value + step))
  }, [value, onChange, invert])
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onWheel }
}

export function Knob({ value, onChange, label, size = 34, center = 0.5, defaultValue = 0.5, color = '#3b82f6', title }: {
  value: number
  onChange: (v: number) => void
  label?: string
  size?: number
  /** Where the value arc starts from — 0.5 for bipolar knobs, 0 for unipolar. */
  center?: number
  defaultValue?: number
  color?: string
  title?: string
}) {
  const drag = useDragValue(value, onChange, 160)
  const angle = -135 + value * 270
  const r = size / 2 - 3
  const arc = (from: number, to: number) => {
    const a0 = ((-135 + from * 270) - 90) * Math.PI / 180
    const a1 = ((-135 + to * 270) - 90) * Math.PI / 180
    const x0 = size / 2 + (r + 1.5) * Math.cos(a0), y0 = size / 2 + (r + 1.5) * Math.sin(a0)
    const x1 = size / 2 + (r + 1.5) * Math.cos(a1), y1 = size / 2 + (r + 1.5) * Math.sin(a1)
    const large = Math.abs(to - from) * 270 > 180 ? 1 : 0
    return `M${x0} ${y0} A${r + 1.5} ${r + 1.5} 0 ${large} ${to > from ? 1 : 0} ${x1} ${y1}`
  }
  return (
    <div className="dj-knob" title={title ?? label}>
      <svg width={size} height={size} {...drag} onDoubleClick={() => onChange(defaultValue)} role="slider"
        aria-label={title ?? label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
        <defs>
          <radialGradient id="dj-knob-g" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#c9ccd1" />
            <stop offset="100%" stopColor="#7d828a" />
          </radialGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r + 2.5} fill="#1d1f23" />
        {Math.abs(value - center) > 0.004 && (
          <path d={arc(Math.min(center, value), Math.max(center, value))} stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        )}
        <circle cx={size / 2} cy={size / 2} r={r - 1} fill="url(#dj-knob-g)" stroke="#55595f" strokeWidth={0.8} />
        <g transform={`rotate(${angle} ${size / 2} ${size / 2})`}>
          <rect x={size / 2 - 1.2} y={4} width={2.4} height={r * 0.55} rx={1} fill="#1b1d21" />
        </g>
      </svg>
      {label && <span className="dj-knob-label">{label}</span>}
    </div>
  )
}

export function VFader({ value, onChange, height = 120, defaultValue = 0.75, invert = false, className = '', title, ticks = 11 }: {
  value: number
  onChange: (v: number) => void
  height?: number
  defaultValue?: number
  /** Top of travel = 0 instead of 1 (pitch faders). */
  invert?: boolean
  className?: string
  title?: string
  ticks?: number
}) {
  const drag = useDragValue(value, onChange, height - 22, 'y', invert)
  const pos = invert ? value : 1 - value
  return (
    <div className={`dj-vfader ${className}`} style={{ height }} title={title} {...drag} onDoubleClick={() => onChange(defaultValue)}
      role="slider" aria-label={title} aria-valuenow={Math.round(value * 100)}>
      <div className="dj-vfader-ticks">
        {Array.from({ length: ticks }).map((_, i) => <i key={i} />)}
      </div>
      <div className="dj-vfader-slot" />
      <div className="dj-vfader-cap" style={{ top: `calc(${pos} * (100% - 22px))` }} />
    </div>
  )
}

export function HFader({ value, onChange, width = 150, defaultValue = 0.5, title }: {
  value: number
  onChange: (v: number) => void
  width?: number
  defaultValue?: number
  title?: string
}) {
  const drag = useDragValue(value, onChange, width - 18, 'x')
  return (
    <div className="dj-hfader" style={{ width }} title={title} {...drag} onDoubleClick={() => onChange(defaultValue)}
      role="slider" aria-label={title} aria-valuenow={Math.round(value * 100)}>
      <div className="dj-hfader-slot" />
      <div className="dj-hfader-cap" style={{ left: `calc(${value} * (100% - 18px))` }} />
    </div>
  )
}

export function LedButton({ on, onClick, children, color = 'green', className = '', title, onContextMenu }: {
  on?: boolean
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
  color?: 'green' | 'orange' | 'blue' | 'red' | 'red-text'
  className?: string
  title?: string
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  return (
    <button type="button" className={`dj-btn ${on ? `dj-on dj-on-${color}` : ''} ${className}`} onClick={onClick} title={title} onContextMenu={onContextMenu}>
      {children}
    </button>
  )
}

/** Segmented LED level meter fed by a dBFS reader. */
export function VuMeter({ read, height = 120, segments = 16, horizontal = false }: { read: () => number; height?: number; segments?: number; horizontal?: boolean }) {
  // The meter is a fully lit strip painted once, with a dark cover over the
  // unlit part and a peak marker — both moved with GPU transforms. Restyling
  // ~130 meter segments up to 30 times a second kept the whole console
  // repainting, which starved the YouTube players' video and made the music
  // stutter.
  const coverRef = useRef<HTMLDivElement>(null)
  const holdRef = useRef<HTMLDivElement>(null)
  const peak = useRef({ db: -96, at: 0 })
  const shown = useRef({ lit: -1, hold: -1 })
  useRafThrottled(() => {
    const cover = coverRef.current
    const holdEl = holdRef.current
    if (!cover || !holdEl) return
    const db = read()
    const now = performance.now()
    if (db > peak.current.db || now - peak.current.at > 900) peak.current = { db, at: now }
    const level = (d: number) => clamp01((d + 42) / 42) // -42 dB … 0 dB
    const lit = Math.round(level(db) * segments)
    const hold = Math.round(level(peak.current.db) * segments)
    if (lit === shown.current.lit && hold === shown.current.hold) return
    shown.current = { lit, hold }
    const off = 1 - lit / segments
    cover.style.transform = horizontal ? `scaleX(${off})` : `scaleY(${off})`
    // The peak marker is one segment tall/wide and steps in whole segments.
    holdEl.style.opacity = hold > lit ? '1' : '0'
    holdEl.style.transform = horizontal ? `translateX(${Math.max(0, hold - 1) * 100}%)` : `translateY(${(segments - Math.max(1, hold)) * 100}%)`
  }, 33)
  return (
    <div className={`dj-vu ${horizontal ? 'dj-vu-h' : ''}`} style={horizontal ? undefined : { height }}
      data-segments={segments}>
      {Array.from({ length: segments }).map((_, i) => <i key={i} className="lit" data-zone={i < 3 ? 'red' : i < 6 ? 'amber' : 'green'} />)}
      <div className="dj-vu-cover" ref={coverRef} />
      <div className="dj-vu-hold" ref={holdRef} style={{ [horizontal ? 'width' : 'height']: `${100 / segments}%` }} />
    </div>
  )
}

export function fmtTime(sec: number, tenths = true): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const t = Math.floor((sec * 10) % 10)
  return tenths ? `${m}:${String(s).padStart(2, '0')}.${t}` : `${m}:${String(s).padStart(2, '0')}`
}
