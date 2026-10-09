/**
 * Turntable: a 33⅓ rpm platter whose rotation is derived from the track
 * position, so scratching, seeking and pitch all move it truthfully.
 *
 * Touching the record (inner area) holds it like vinyl: it stops under the
 * hand and moving it scratches — the scratch voice plays the audio at the
 * hand's speed and direction, forwards and backwards. Letting go spins the
 * record back up. Dragging the outer rim while playing nudges the tempo
 * (pitch bend) to beat-match by hand.
 *
 * The record is its own layer turned with a CSS transform, so the GPU spins
 * it without repainting the ~180 shapes on it every frame, and its angle runs
 * on a steady clock that is only eased towards the track position — the
 * position itself arrives in small uneven steps, which made the spin stutter.
 */
import React, { useEffect, useRef } from 'react'
import type { Deck } from './engine/DjEngine'
import { useDeck, useRafThrottled } from './controls'

const DEG_PER_SEC = 200 // 33⅓ rpm
/** Further off than this the record jumps instead of easing (seek, cue, hot cue). */
const SNAP_DEG = 40
/** One turn of the record, in milliseconds. */
const REV_MS = (360 / DEG_PER_SEC) * 1000
/** Track position (degrees of turn) → time within one turn of the spin animation. */
const angleMs = (deg: number) => ((((deg % 360) + 360) % 360) / 360) * REV_MS

/**
 * The light reflections on the vinyl, painted once per platter size into a
 * still image. As a CSS layer (conic and repeating gradients, a ring mask and
 * a screen blend over the spinning record) the GPU had to re-render it every
 * frame — enough on its own to starve the YouTube players' video and stutter
 * the music. Over dark vinyl, plain white alpha looks the same as screen.
 */
const glossCache = new Map<number, string>()
function glossImage(d: number): string {
  const hit = glossCache.get(d)
  if (hit) return hit
  const k = Math.min(2, window.devicePixelRatio || 1)
  const cv = document.createElement('canvas')
  cv.width = cv.height = Math.max(1, Math.round(d * k))
  const g = cv.getContext('2d')!
  g.scale(k, k)
  const c = d / 2
  // Two sweeping highlights, like light from a window either side of the record.
  const conic = g.createConicGradient(-Math.PI / 2, c, c)
  const deg = (x: number) => x / 360
  const stops: [number, number][] = [[0, 0], [16, 0.08], [34, 0.42], [40, 0.62], [46, 0.40], [64, 0.08], [84, 0],
    [180, 0], [196, 0.06], [214, 0.34], [220, 0.48], [226, 0.30], [244, 0.06], [262, 0], [360, 0]]
  for (const [a, o] of stops) conic.addColorStop(deg(a), `rgba(255,255,255,${o})`)
  g.fillStyle = conic
  g.fillRect(0, 0, d, d)
  // Fine groove shimmer.
  g.strokeStyle = 'rgba(255,255,255,0.05)'
  g.lineWidth = 1
  for (let r = 1.5; r < c; r += 3) { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke() }
  // Soft top-left glare.
  const glare = g.createRadialGradient(d * 0.3, d * 0.24, 0, d * 0.3, d * 0.24, d * 0.41)
  glare.addColorStop(0, 'rgba(255,255,255,0.28)')
  glare.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = glare
  g.fillRect(0, 0, d, d)
  // Keep it to the grooved ring: clear around the label, fade at the rim.
  const corner = c * Math.SQRT2
  const ring = g.createRadialGradient(c, c, 0, c, c, corner)
  ring.addColorStop(0, 'rgba(0,0,0,0)')
  ring.addColorStop(0.385, 'rgba(0,0,0,0)')
  ring.addColorStop(0.4, 'rgba(0,0,0,1)')
  ring.addColorStop(0.99, 'rgba(0,0,0,1)')
  ring.addColorStop(1, 'rgba(0,0,0,0)')
  g.globalCompositeOperation = 'destination-in'
  g.fillStyle = ring
  g.fillRect(0, 0, d, d)
  g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill()
  const url = cv.toDataURL('image/png')
  glossCache.set(d, url)
  return url
}

export default function Platter({ deck, size = 230 }: { deck: Deck; size?: number }) {
  useDeck(deck)
  const rootRef = useRef<HTMLDivElement>(null)
  const discRef = useRef<HTMLDivElement>(null)
  const armRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'scratch' | 'bend'; last: number; lastT: number; pos: number } | null>(null)
  const armAngle = useRef(-20)
  const spin = useRef<Animation | null>(null)

  const loaded = !!deck.track
  const cover = deck.track?.cover
  const c = size / 2

  // The record turns as a compositor animation: the GPU spins it at exactly
  // the deck's speed without the page producing a frame for it. The page only
  // lines it up again on play, pause, seek or a tempo change.
  useEffect(() => {
    const el = discRef.current
    if (!el) return
    const a = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: REV_MS, iterations: Infinity })
    a.pause()
    spin.current = a
    return () => { a.cancel(); spin.current = null }
  }, [])

  // Ten checks a second keep the spin true; every frame only while a hand is on the record.
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
          // A seek, cue or hot cue moves the record; small clock wobble does not.
          if (Math.abs(diff) > REV_MS * (SNAP_DEG / 360) / 4) a.currentTime = target
        }
      } else {
        if (a.playState === 'running') a.pause()
        a.currentTime = target
      }
    }
    const progress = deck.duration ? Math.min(1, deck.time / deck.duration) : 0
    // Rest off the record at -20°, lower onto the lead-in at 0°, and track
    // inwards to 16° by the end of the song. Eased so loading swings the arm.
    const armTarget = loaded ? progress * 16 : -20
    // Only move it when the change is visible (a song tracks inwards ~16° over minutes).
    // A CSS transition makes the swing; the page only sets where the arm should be.
    if (Math.abs(armTarget - armAngle.current) > 0.05) {
      armAngle.current = armTarget
      const el = armRef.current
      if (el) el.style.transform = `rotate(${armTarget.toFixed(2)}deg)`
    }
  }, deck.held ? 0 : 100)

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

  const onDown = (e: React.PointerEvent) => {
    if (!loaded || e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const mode = deck.playing && radiusAt(e) > 0.8 ? 'bend' : 'scratch'
    drag.current = { mode, last: angleAt(e), lastT: performance.now(), pos: deck.time }
    if (mode === 'scratch') deck.grab()
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
    if (d.mode === 'scratch') {
      d.pos += delta / DEG_PER_SEC
      deck.scratchTo(d.pos)
    } else deck.setBend((delta / dt) * 0.35) // deg/ms → ±bend
  }
  /** Hand off the record — also when the pointer is lost (window blur, capture stolen). */
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.mode === 'bend') deck.setBend(0)
    else deck.release()
  }

  const grooves: React.ReactElement[] = []
  for (let r = c * 0.42; r < c * 0.9; r += 2.2) grooves.push(<circle key={r} cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth={0.6} />)
  const dots: React.ReactElement[] = []
  for (let i = 0; i < 72; i++) {
    const ang = (i / 72) * Math.PI * 2
    dots.push(<circle key={i} cx={c + Math.cos(ang) * c * 0.955} cy={c + Math.sin(ang) * c * 0.955} r={1.3} fill="#9aa0a8" />)
  }
  const layer: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }

  return (
    <div ref={rootRef} className="dj-platter" style={{ width: size, height: size, cursor: loaded ? (deck.held ? 'grabbing' : 'grab') : 'default', touchAction: 'none' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}>
      {/* Platter rim */}
      <svg width={size} height={size} style={layer}>
        <defs>
          <radialGradient id={`plate-${deck.id}`} cx="45%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#e8eaed" />
            <stop offset="100%" stopColor="#8d939b" />
          </radialGradient>
        </defs>
        <circle cx={c} cy={c} r={c - 1} fill={`url(#plate-${deck.id})`} stroke="#6b7078" />
      </svg>

      {/* The record: strobe dots, vinyl, grooves and artwork — spun by the GPU */}
      <div ref={discRef} className="dj-disc" style={{ ...layer, transformOrigin: '50% 50%', willChange: 'transform' }}>
        <svg width={size} height={size} style={{ display: 'block' }}>
          <defs>
            <radialGradient id={`vinyl-${deck.id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2a2a2e" />
              <stop offset="60%" stopColor="#111114" />
              <stop offset="100%" stopColor="#050506" />
            </radialGradient>
            <clipPath id={`disc-clip-${deck.id}`}><circle cx={c} cy={c} r={c * 0.9} /></clipPath>
          </defs>
          {dots}
          <circle cx={c} cy={c} r={c * 0.92} fill={`url(#vinyl-${deck.id})`} />
          {grooves}
          {cover ? (
            <>
              {/* The song's artwork printed across the record, spinning with it */}
              <image href={cover} x={c - c * 0.9} y={c - c * 0.9} width={c * 1.8} height={c * 1.8}
                preserveAspectRatio="xMidYMid slice" clipPath={`url(#disc-clip-${deck.id})`} />
              <circle cx={c} cy={c} r={c * 0.9} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={2} />
              <circle cx={c} cy={c} r={c * 0.12} fill="rgba(0,0,0,0.25)" />
              {/* Marker so the spin reads even on a plain cover */}
              <rect x={c - 2.5} y={c - c * 0.42} width={5} height={c * 0.24} rx={2} fill="#fff" stroke="rgba(0,0,0,0.4)" strokeWidth={0.6} />
            </>
          ) : (
            <>
              {/* Label */}
              <circle cx={c} cy={c} r={c * 0.36} fill="#d71920" />
              <circle cx={c} cy={c} r={c * 0.36} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />
              <rect x={c - 2.5} y={c - c * 0.35} width={5} height={c * 0.27} rx={2} fill="#fff" />
              <text x={c} y={c + c * 0.1} textAnchor="middle" fontSize={c * 0.12} fontWeight={800} fill="#fff" fontFamily="Inter, Arial, sans-serif" letterSpacing={0.5}>AIHub</text>
              <text x={c} y={c + c * 0.24} textAnchor="middle" fontSize={c * 0.1} fontWeight={800} fill="#ffd2d2" fontFamily="Inter, Arial, sans-serif" letterSpacing={2}>DJ</text>
            </>
          )}
        </svg>
      </div>

      {/* Fixed sheen, spindle and tonearm — they stay put while the record turns under them */}
      <svg width={size} height={size} style={layer}>
        <defs>
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
        </defs>
        <circle cx={c} cy={c} r={c * 0.92} fill={`url(#sheen-${deck.id})`} />
        {!cover && <circle cx={c} cy={c} r={c * 0.36} fill={`url(#labelgloss-${deck.id})`} />}
        <circle cx={c} cy={c} r={c * 0.035} fill="#d9dce0" stroke="#555" strokeWidth={0.5} />
      </svg>
      {/* Tonearm: its own layer, turned by the GPU about its pivot — no repaint as it tracks inwards */}
      <div ref={armRef} style={{ ...layer, transformOrigin: `${size * 0.86}px ${size * 0.13}px`, transform: `rotate(${armAngle.current}deg)`, willChange: 'transform', transition: 'transform 0.7s cubic-bezier(.2,.7,.2,1)' }}>
        <svg width={size} height={size} style={{ display: 'block' }}>
          <circle cx={size * 0.86} cy={size * 0.13} r={size * 0.075} fill="#2b2d31" stroke="#9aa0a8" strokeWidth={2} />
          <circle cx={size * 0.86} cy={size * 0.13} r={size * 0.03} fill="#c9ccd1" />
          <path d={`M${size * 0.86} ${size * 0.13} L${size * 0.9} ${size * 0.55} L${size * 0.8} ${size * 0.8}`} stroke="#d4d7db" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x={size * 0.765} y={size * 0.78} width={size * 0.06} height={size * 0.1} rx={2} fill="#3a3c40" transform={`rotate(25 ${size * 0.8} ${size * 0.8})`} />
        </svg>
      </div>
      {/* Light reflections on the vinyl — fixed, so the record spins beneath them */}
      <img className="dj-vinyl-gloss-img" src={glossImage(Math.round(size * 0.92))} alt="" draggable={false}
        style={{ position: 'absolute', left: size * 0.04, top: size * 0.04, width: size * 0.92, height: size * 0.92, pointerEvents: 'none' }} />
    </div>
  )
}
