/**
 * Hardware-style controls for AIHub DJ. All take a 0..1 value and report
 * 0..1 back; double-click returns a control to its detent.
 */
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Deck } from './engine/DjEngine'
import { useDesign, type KnobKind } from './designs'

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
  const kind = useDesign().knob
  if (kind !== 'classic') {
    return <DesignKnob kind={kind} value={value} onChange={onChange} label={label} size={size} center={center} defaultValue={defaultValue} color={color} title={title} drag={drag} />
  }
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
  const c = size / 2
  // Knurled skirt: fine ridges around the cap edge that turn with it, so the
  // knob reads as machined metal and its rotation is visible all the way round.
  const ridges = Math.max(18, Math.round(size * 0.75))
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
          <linearGradient id="dj-knob-skirt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eceef0" />
            <stop offset="100%" stopColor="#80858c" />
          </linearGradient>
          <radialGradient id="dj-knob-spec" cx="35%" cy="28%" r="45%">
            <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#fff" stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle className="dj-knob-base" cx={c} cy={c} r={r + 2.5} fill="#1d1f23" />
        {Math.abs(value - center) > 0.004 && (
          <path d={arc(Math.min(center, value), Math.max(center, value))} stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        )}
        {/* Shadow the knob casts down-right onto the panel. */}
        <circle cx={c + 0.6} cy={c + 1.2} r={r - 0.6} fill="rgba(0,0,0,0.45)" />
        <g transform={`rotate(${angle} ${c} ${c})`}>
          <circle className="dj-knob-skirt" cx={c} cy={c} r={r - 1} fill="url(#dj-knob-skirt)" stroke="#0e0f11" strokeWidth={0.8} />
          {Array.from({ length: ridges }, (_, i) => {
            const a = (i / ridges) * Math.PI * 2
            return <line key={i} x1={c + Math.cos(a) * (r - 1.2)} y1={c + Math.sin(a) * (r - 1.2)}
              x2={c + Math.cos(a) * (r - 2.6)} y2={c + Math.sin(a) * (r - 2.6)} stroke="rgba(0,0,0,0.4)" strokeWidth={0.7} />
          })}
        </g>
        <circle className="dj-knob-cap" cx={c} cy={c} r={r - 2.6} fill="url(#dj-knob-g)" stroke="#6b7078" strokeWidth={0.6} />
        <ellipse cx={c - r * 0.18} cy={c - r * 0.3} rx={r * 0.5} ry={r * 0.32} fill="url(#dj-knob-spec)" />
        <g transform={`rotate(${angle} ${c} ${c})`}>
          {/* The pointer line is engraved: a dark groove with a lit lower lip. */}
          <rect className="dj-knob-lip" x={c - 1.1 + 0.5} y={4.6} width={2.2} height={r * 0.55} rx={1} fill="rgba(255,255,255,0.7)" />
          <rect className="dj-knob-ptr" x={c - 1.1} y={4} width={2.2} height={r * 0.55} rx={1} fill="#16181b" />
        </g>
      </svg>
      {label && <span className="dj-knob-label">{label}</span>}
    </div>
  )
}

/**
 * The design looks' knobs (designs.ts):
 *   chicken — a bakelite chicken-head pointer on a round skirt, as on valve
 *             amps and vintage mixers: the whole pointer turns.
 *   ledring — a flat rubber knob inside a ring of LEDs that light from the
 *             centre (bipolar) or from zero to the value, like a controller.
 */
function DesignKnob({ kind, value, onChange, label, size, center, defaultValue, color, title, drag }: {
  kind: KnobKind; value: number; onChange: (v: number) => void; label?: string; size: number; center: number
  defaultValue: number; color: string; title?: string; drag: ReturnType<typeof useDragValue>
}) {
  const c = size / 2
  const angle = -135 + value * 270
  const r = size / 2 - 3
  const body = kind === 'chicken' ? (
    <>
      <circle className="dj-knob-base" cx={c} cy={c} r={r + 2} fill="#141414" />
      {/* Scale dots around the skirt. */}
      {Array.from({ length: 11 }, (_, i) => {
        const a = ((-135 + i * 27) - 90) * Math.PI / 180
        return <circle key={i} cx={c + Math.cos(a) * (r + 0.5)} cy={c + Math.sin(a) * (r + 0.5)} r={0.7} fill="rgba(255,255,255,0.55)" />
      })}
      <circle cx={c + 0.6} cy={c + 1.4} r={r * 0.62} fill="rgba(0,0,0,0.45)" />
      <g transform={`rotate(${angle} ${c} ${c})`}>
        {/* The chicken head: round boss with a long tapered pointer. */}
        <path className="dj-knob-cap" d={`M${c - r * 0.42} ${c + r * 0.25} Q${c - r * 0.5} ${c - r * 0.35} ${c - r * 0.12} ${c - r * 0.92} L${c + r * 0.12} ${c - r * 0.92} Q${c + r * 0.5} ${c - r * 0.35} ${c + r * 0.42} ${c + r * 0.25} A${r * 0.45} ${r * 0.45} 0 0 1 ${c - r * 0.42} ${c + r * 0.25} Z`}
          fill="#f3e7cf" stroke="#3a2e12" strokeWidth={0.6} />
        <rect className="dj-knob-ptr" x={c - 0.8} y={c - r * 0.88} width={1.6} height={r * 0.6} rx={0.8} fill="#1d1c1a" />
        <ellipse cx={c - r * 0.12} cy={c - r * 0.1} rx={r * 0.18} ry={r * 0.32} fill="rgba(255,255,255,0.35)" />
      </g>
    </>
  ) : (
    <>
      <circle className="dj-knob-base" cx={c} cy={c} r={r + 2.5} fill="#0b0c0e" />
      {Array.from({ length: 15 }, (_, i) => {
        const v = i / 14
        const lo = Math.min(center, value) - 0.001, hi = Math.max(center, value) + 0.001
        const lit = v >= lo && v <= hi && Math.abs(value - center) > 0.02 || Math.abs(v - center) < 0.035
        const a = ((-135 + v * 270) - 90) * Math.PI / 180
        return <circle key={i} className={lit ? 'dj-ledk-on' : 'dj-ledk-off'} cx={c + Math.cos(a) * (r + 0.2)} cy={c + Math.sin(a) * (r + 0.2)} r={Math.max(1, size * 0.045)}
          fill={lit ? color : 'rgba(255,255,255,0.08)'} />
      })}
      <circle className="dj-knob-cap" cx={c} cy={c} r={r * 0.68} fill="#1c1d21" stroke="#000" strokeWidth={0.8} />
      <circle cx={c} cy={c} r={r * 0.68} fill="url(#dj-knob-spec)" opacity={0.35} />
      <g transform={`rotate(${angle} ${c} ${c})`}>
        <rect className="dj-knob-ptr" x={c - 1} y={c - r * 0.64} width={2} height={r * 0.34} rx={1} fill="#f4f4f6" />
      </g>
    </>
  )
  return (
    <div className={`dj-knob dj-knob-${kind}`} title={title ?? label}>
      <svg width={size} height={size} {...drag} onDoubleClick={() => onChange(defaultValue)} role="slider"
        aria-label={title ?? label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
        <defs>
          <radialGradient id="dj-knob-spec" cx="35%" cy="28%" r="45%">
            <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#fff" stopOpacity={0} />
          </radialGradient>
        </defs>
        {body}
      </svg>
      {label && <span className="dj-knob-label">{label}</span>}
    </div>
  )
}

/**
 * An analog VU meter: a needle over a printed scale, with VU ballistics (it
 * rises and falls over ~300 ms instead of jumping). The needle is the only
 * thing that moves, by a transform on its own element — no React render.
 * 0 VU sits at -18 dBFS, the usual line-up level.
 */
export function NeedleMeter({ read, label }: { read: () => number; label?: string }) {
  const needleRef = useRef<SVGGElement>(null)
  const vu = useRef(-20)
  const last = useRef(performance.now())
  useRafThrottled(now => {
    const db = read()
    const target = Math.max(-20, Math.min(3, (Number.isFinite(db) ? db : -100) + 18))
    const dt = Math.min(0.2, (now - last.current) / 1000)
    last.current = now
    vu.current += (target - vu.current) * (1 - Math.exp(-dt / 0.3))
    const el = needleRef.current
    if (el) el.setAttribute('transform', `rotate(${(-48 + ((vu.current + 20) / 23) * 96).toFixed(2)} 50 62)`)
  }, 33)
  const marks = [-20, -10, -7, -5, -3, -1, 0, 1, 2, 3]
  const ang = (v: number) => ((-48 + ((v + 20) / 23) * 96) - 90) * Math.PI / 180
  const p = (v: number, r: number) => `${50 + Math.cos(ang(v)) * r} ${62 + Math.sin(ang(v)) * r}`
  return (
    <svg className="dj-needle" viewBox="0 0 100 52" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${label ?? ''} level`}>
      <rect className="dj-needle-face" x={1} y={1} width={98} height={50} rx={4} />
      <path d={`M${p(-20, 44)} A44 44 0 0 1 ${p(0, 44)}`} className="dj-needle-scale" fill="none" strokeWidth={1.2} />
      <path d={`M${p(0, 44)} A44 44 0 0 1 ${p(3, 44)}`} className="dj-needle-red" fill="none" strokeWidth={3} />
      {marks.map(m => <line key={m} x1={p(m, 44).split(' ')[0]} y1={p(m, 44).split(' ')[1]} x2={p(m, m === 0 ? 37 : 40).split(' ')[0]} y2={p(m, m === 0 ? 37 : 40).split(' ')[1]}
        className={m > 0 ? 'dj-needle-red' : 'dj-needle-scale'} strokeWidth={m === 0 ? 1.4 : 0.9} />)}
      {[-20, -10, -5, 0, 3].map(m => <text key={m} x={p(m, 31).split(' ')[0]} y={p(m, 31).split(' ')[1]} className={m > 0 ? 'dj-needle-num dj-needle-redtxt' : 'dj-needle-num'} textAnchor="middle" dominantBaseline="middle">{m > 0 ? `+${m}` : m}</text>)}
      <text x={50} y={44} textAnchor="middle" className="dj-needle-vu">VU{label ? ` ${label}` : ''}</text>
      <g ref={needleRef} transform="rotate(-48 50 62)">
        <line x1={50} y1={62} x2={50} y2={17} className="dj-needle-hand" strokeWidth={1.1} strokeLinecap="round" />
      </g>
      {/* Pivot cover and a glass glare across the window. */}
      <rect x={1} y={46} width={98} height={5} rx={2} className="dj-needle-cover" />
      <path d="M2 2 H98 V14 Q50 22 2 12 Z" fill="rgba(255,255,255,0.14)" />
    </svg>
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
