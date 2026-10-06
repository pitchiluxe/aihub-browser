/**
 * Turntable: a 33⅓ rpm platter whose rotation is derived from the track
 * position, so scratching, seeking and pitch all move it truthfully.
 *
 * Touching the record (inner area) holds it like vinyl: playback pauses and
 * dragging scrubs. Dragging the outer rim while playing nudges the tempo
 * (pitch bend) to beat-match by hand.
 */
import React, { useRef } from 'react'
import type { Deck } from './engine/DjEngine'
import { useDeck, useRaf } from './controls'

const DEG_PER_SEC = 200 // 33⅓ rpm

export default function Platter({ deck, size = 230 }: { deck: Deck; size?: number }) {
  useDeck(deck)
  const discRef = useRef<SVGGElement>(null)
  const armRef = useRef<SVGGElement>(null)
  const drag = useRef<{ mode: 'scratch' | 'bend'; last: number; lastT: number; wasPlaying: boolean } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const armAngle = useRef(-20)

  const loaded = !!deck.track
  const c = size / 2

  useRaf(() => {
    const a = loaded ? (deck.time * DEG_PER_SEC) % 360 : 0
    discRef.current?.setAttribute('transform', `rotate(${a} ${c} ${c})`)
    const progress = deck.duration ? Math.min(1, deck.time / deck.duration) : 0
    // Rest off the record at -20°, lower onto the lead-in at 0°, and track
    // inwards to 16° by the end of the song. Eased so loading swings the arm.
    const target = loaded ? progress * 16 : -20
    armAngle.current += (target - armAngle.current) * 0.12
    armRef.current?.setAttribute('transform', `rotate(${armAngle.current} ${size * 0.86} ${size * 0.13})`)
  })

  const angleAt = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI
  }
  const radiusAt = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) / (r.width / 2)
  }

  const onDown = (e: React.PointerEvent) => {
    if (!loaded || e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const playing = deck.playing
    const mode = playing && radiusAt(e) > 0.8 ? 'bend' : 'scratch'
    drag.current = { mode, last: angleAt(e), lastT: performance.now(), wasPlaying: playing }
    if (mode === 'scratch' && playing) deck.pause()
  }
  const onMove = (e: React.PointerEvent) => {
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
    if (d.mode === 'scratch') deck.seek(deck.time + delta / DEG_PER_SEC)
    else deck.setBend((delta / dt) * 0.35) // deg/ms → ±bend
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.mode === 'bend') deck.setBend(0)
    else if (d.wasPlaying) void deck.play()
  }

  const grooves: React.ReactElement[] = []
  for (let r = c * 0.42; r < c * 0.9; r += 2.2) grooves.push(<circle key={r} cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth={0.6} />)
  const dots: React.ReactElement[] = []
  for (let i = 0; i < 72; i++) {
    const ang = (i / 72) * Math.PI * 2
    dots.push(<circle key={i} cx={c + Math.cos(ang) * c * 0.955} cy={c + Math.sin(ang) * c * 0.955} r={1.3} fill="#9aa0a8" />)
  }

  return (
    <div className="dj-platter" style={{ width: size, height: size }}>
      <svg ref={svgRef} width={size} height={size} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ cursor: loaded ? 'grab' : 'default', touchAction: 'none' }}>
        <defs>
          <radialGradient id={`vinyl-${deck.id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2a2a2e" />
            <stop offset="60%" stopColor="#111114" />
            <stop offset="100%" stopColor="#050506" />
          </radialGradient>
          <linearGradient id={`sheen-${deck.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="45%" stopColor="rgba(255,255,255,0)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.10)" />
          </linearGradient>
          <radialGradient id={`labelgloss-${deck.id}`} cx="35%" cy="25%" r="75%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="35%" stopColor="rgba(255,255,255,0.12)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id={`plate-${deck.id}`} cx="45%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#e8eaed" />
            <stop offset="100%" stopColor="#8d939b" />
          </radialGradient>
        </defs>
        {/* Platter rim + strobe dots */}
        <circle cx={c} cy={c} r={c - 1} fill={`url(#plate-${deck.id})`} stroke="#6b7078" />
        <g ref={discRef}>
          {dots}
          {/* Record */}
          <circle cx={c} cy={c} r={c * 0.92} fill={`url(#vinyl-${deck.id})`} />
          {grooves}
          {/* Label */}
          <circle cx={c} cy={c} r={c * 0.36} fill="#d71920" />
          <circle cx={c} cy={c} r={c * 0.36} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />
          <rect x={c - 2.5} y={c - c * 0.35} width={5} height={c * 0.27} rx={2} fill="#fff" />
          <text x={c} y={c + c * 0.1} textAnchor="middle" fontSize={c * 0.12} fontWeight={800} fill="#fff" fontFamily="Inter, Arial, sans-serif" letterSpacing={0.5}>AIHub</text>
          <text x={c} y={c + c * 0.24} textAnchor="middle" fontSize={c * 0.1} fontWeight={800} fill="#ffd2d2" fontFamily="Inter, Arial, sans-serif" letterSpacing={2}>DJ</text>
        </g>
        {/* Fixed sheen — stays put while the record spins under it */}
        <circle cx={c} cy={c} r={c * 0.92} fill={`url(#sheen-${deck.id})`} pointerEvents="none" />
        {/* Glossy label: a soft highlight that does not turn with the record */}
        <circle cx={c} cy={c} r={c * 0.36} fill={`url(#labelgloss-${deck.id})`} pointerEvents="none" />
        <circle cx={c} cy={c} r={c * 0.035} fill="#d9dce0" stroke="#555" strokeWidth={0.5} pointerEvents="none" />
        {/* Tonearm */}
        <g ref={armRef} pointerEvents="none">
          <circle cx={size * 0.86} cy={size * 0.13} r={size * 0.075} fill="#2b2d31" stroke="#9aa0a8" strokeWidth={2} />
          <circle cx={size * 0.86} cy={size * 0.13} r={size * 0.03} fill="#c9ccd1" />
          <path d={`M${size * 0.86} ${size * 0.13} L${size * 0.9} ${size * 0.55} L${size * 0.8} ${size * 0.8}`} stroke="#d4d7db" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x={size * 0.765} y={size * 0.78} width={size * 0.06} height={size * 0.1} rx={2} fill="#3a3c40" transform={`rotate(25 ${size * 0.8} ${size * 0.8})`} />
        </g>
      </svg>
      {/* Light reflections on the vinyl — fixed, so the record spins beneath them */}
      <div className="dj-vinyl-gloss" style={{ inset: size * 0.04 }} />
    </div>
  )
}
