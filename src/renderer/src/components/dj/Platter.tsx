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
import React, { useRef } from 'react'
import type { Deck } from './engine/DjEngine'
import { fmtTime, useDeck, useRafThrottled } from './controls'
import { useDeckSpin, useScratch } from './jogHooks'
import { useRig } from './rigs'

/**
 * The blue LCD in a silver jog's hub: elapsed time and tempo, live. Written
 * straight into the text nodes so the ticking clock never re-renders the deck.
 */
function JogLcd({ deck, c }: { deck: Deck; c: number }) {
  const timeRef = useRef<SVGTextElement>(null)
  const bpmRef = useRef<SVGTextElement>(null)
  useRafThrottled(() => {
    const t = fmtTime(deck.time, false)
    const bpm = deck.effectiveBpm ? deck.effectiveBpm.toFixed(1) : '--.-'
    if (timeRef.current && timeRef.current.textContent !== t) timeRef.current.textContent = t
    if (bpmRef.current && bpmRef.current.textContent !== bpm) bpmRef.current.textContent = bpm
  }, 100)
  return (
    <g className="dj-jog-lcd">
      <text x={c} y={c - c * 0.075} textAnchor="middle" fontSize={c * 0.055} fill="#7fb8ff" fontFamily="Arial, sans-serif" letterSpacing={1}>{deck.id === 'A' ? 'DECK A' : `DECK ${deck.id}`}</text>
      <text ref={timeRef} x={c} y={c + c * 0.045} textAnchor="middle" fontSize={c * 0.11} fill="#e6f1ff" fontFamily="'Courier New', monospace" fontWeight={700}>0:00</text>
      <text ref={bpmRef} x={c} y={c + c * 0.135} textAnchor="middle" fontSize={c * 0.07} fill="#8dceff" fontFamily="'Courier New', monospace">--.-</text>
    </g>
  )
}

/** A red power cap over the spindle, like a battle turntable's centre button. */
function PowerCap({ c, r }: { c: number; r: number }) {
  const a = r * 0.5
  return (
    <g className="dj-power-cap">
      <circle cx={c} cy={c} r={r} fill="#e51b23" stroke="#1a0406" strokeWidth={Math.max(1, r * 0.08)} />
      <circle cx={c} cy={c} r={r * 0.82} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
      <path d={`M${c - a * 0.62} ${c - a * 0.62} A${a * 0.88} ${a * 0.88} 0 1 0 ${c + a * 0.62} ${c - a * 0.62}`} fill="none" stroke="#fff" strokeWidth={Math.max(1.5, r * 0.14)} strokeLinecap="round" />
      <line x1={c} y1={c - a * 1.05} x2={c} y2={c - a * 0.1} stroke="#fff" strokeWidth={Math.max(1.5, r * 0.14)} strokeLinecap="round" />
    </g>
  )
}

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

/**
 * Tonearm geometry, in fractions of the platter size. The pivot sits off the
 * record's top-right corner, as on a Technics deck; at rest the arm lies on
 * its rest beside the record, clear of it. Loading a song swings the needle
 * onto the lead-in groove (radius ≈ 0.44), and it tracks inwards to the run-out
 * (≈ 0.2) by the end — the angles below put the stylus on exactly those radii.
 */
export const ARM = { px: 0.98, py: 0.12, rest: 0, leadIn: 19, runOut: 43 }
/** Room the arm and its rest take to the right of the platter, as a fraction of its size. */
export const ARM_MARGIN = 0.09

/** Where the arm points for a deck: off the record when empty, then lead-in → run-out with the song. */
export function armAngleFor(loaded: boolean, progress: number): number {
  return loaded ? ARM.leadIn + Math.min(1, Math.max(0, progress)) * (ARM.runOut - ARM.leadIn) : ARM.rest
}

/**
 * Technics-style straight arm: counterweight above the gimbal on a black base,
 * a straight chrome tube with a bend near the end, and a headshell with its
 * finger lift. Drawn in the rest position; the layer rotates about the pivot.
 */
function TechnicsArm({ size: s }: { size: number }) {
  const px = s * ARM.px, py = s * ARM.py
  const tube = `M${px} ${py} L${s * 1.03} ${s * 0.7} Q${s * 1.035} ${s * 0.76}, ${s * 1.005} ${s * 0.8}`
  return (
    <svg className="dj-arm" width={s} height={s} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="dj-arm-chrome" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8e949b" /><stop offset="45%" stopColor="#ffffff" /><stop offset="100%" stopColor="#7c828a" />
        </linearGradient>
        <linearGradient id="dj-arm-weight" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1b1c1f" /><stop offset="50%" stopColor="#4a4d53" /><stop offset="100%" stopColor="#151618" />
        </linearGradient>
      </defs>
      {/* Base: black plinth disc with a machined rim */}
      <circle className="dj-arm-board" cx={px} cy={py} r={s * 0.085} fill="#141517" stroke="#5a5f66" strokeWidth={1.5} />
      <circle cx={px} cy={py} r={s * 0.065} fill="#202225" stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
      {/* Counterweight on the stub behind the pivot */}
      <line x1={px} y1={py} x2={px - s * 0.004} y2={py - s * 0.085} stroke="url(#dj-arm-chrome)" strokeWidth={s * 0.016} />
      <rect className="dj-arm-weight" x={px - s * 0.032} y={py - s * 0.12} width={s * 0.06} height={s * 0.06} rx={s * 0.008}
        fill="url(#dj-arm-weight)" stroke="#6f747b" strokeWidth={0.8} />
      <line x1={px - s * 0.03} y1={py - s * 0.075} x2={px + s * 0.026} y2={py - s * 0.075} stroke="#9aa0a8" strokeWidth={0.8} />
      {/* Gimbal */}
      <circle cx={px} cy={py} r={s * 0.03} fill="#c9cdd2" stroke="#4d5157" strokeWidth={1} />
      {/* Tube: dark edge under a chrome highlight */}
      <path d={tube} stroke="#3a3d42" strokeWidth={s * 0.022} fill="none" strokeLinecap="round" />
      <path className="dj-arm-tube" d={tube} stroke="url(#dj-arm-chrome)" strokeWidth={s * 0.015} fill="none" strokeLinecap="round" />
      {/* Headshell and finger lift */}
      <g transform={`rotate(-14 ${s * 1.005} ${s * 0.8})`}>
        <rect className="dj-arm-head" x={s * 0.983} y={s * 0.79} width={s * 0.044} height={s * 0.085} rx={s * 0.006} fill="#2a2c30" stroke="#8a9097" strokeWidth={0.8} />
        <line x1={s * 1.027} y1={s * 0.805} x2={s * 1.06} y2={s * 0.795} stroke="#d4d8dd" strokeWidth={s * 0.007} strokeLinecap="round" />
      </g>
    </svg>
  )
}

export default function Platter({ deck, size = 230 }: { deck: Deck; size?: number }) {
  useDeck(deck)
  const rootRef = useRef<HTMLDivElement>(null)
  const discRef = useRef<HTMLDivElement>(null)
  const armRef = useRef<HTMLDivElement>(null)
  const armAngle = useRef(ARM.rest)

  const rig = useRig()
  const loaded = !!deck.track
  const cover = deck.track?.cover
  const c = size / 2
  const hand = useScratch(deck, rootRef)

  // The record turns as a compositor animation (see jogHooks): the GPU spins
  // it at exactly the deck's speed; the page only lines it up again.
  useDeckSpin(deck, discRef, progress => {
    // Rest beside the record, swing onto the lead-in, track inwards to the
    // run-out by the end of the song (see ARM). Eased so loading swings the arm.
    const armTarget = armAngleFor(loaded, progress)
    // Only move it when the change is visible (a song tracks inwards ~24° over minutes).
    // A CSS transition makes the swing; the page only sets where the arm should be.
    if (Math.abs(armTarget - armAngle.current) > 0.05) {
      armAngle.current = armTarget
      const el = armRef.current
      if (el) el.style.transform = `rotate(${armTarget.toFixed(2)}deg)`
    }
  })

  const grooves: React.ReactElement[] = []
  for (let r = c * 0.42; r < c * 0.9; r += 2.2) grooves.push(<circle key={r} cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth={0.6} />)
  const dots: React.ReactElement[] = []
  for (let i = 0; i < 72; i++) {
    const ang = (i / 72) * Math.PI * 2
    dots.push(<circle key={i} cx={c + Math.cos(ang) * c * 0.955} cy={c + Math.sin(ang) * c * 0.955} r={1.3} fill="#9aa0a8" />)
  }
  const layer: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }

  return (
    <div ref={rootRef} className={`dj-platter${rig ? ` dj-rig-${rig.platter}` : ''}`}
      style={{ width: size, height: size, marginRight: rig?.platter === 'silver' ? undefined : size * ARM_MARGIN, cursor: loaded ? (deck.held ? 'grabbing' : 'grab') : 'default', touchAction: 'none', '--dj-jog-metal': `url(#jogmetal-${deck.id})` } as React.CSSProperties}
      {...hand}>
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
            {/* Machined jog face for the silver rigs (selected in CSS through --dj-jog-metal) */}
            {rig?.platter === 'silver' && (
              <radialGradient id={`jogmetal-${deck.id}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#f4f6f8" />
                <stop offset="55%" stopColor="#d3d7dc" />
                <stop offset="80%" stopColor="#b3b9c1" />
                <stop offset="93%" stopColor="#e9ecef" />
                <stop offset="100%" stopColor="#8b929b" />
              </radialGradient>
            )}
          </defs>
          {dots}
          <circle cx={c} cy={c} r={c * 0.92} fill={`var(--dj-record-fill, url(#vinyl-${deck.id}))`} />
          {grooves}
          {cover ? (
            <>
              {/* The song's artwork printed across the record, spinning with it */}
              <image className="dj-record-artwork" href={cover} x={c - c * 0.9} y={c - c * 0.9} width={c * 1.8} height={c * 1.8}
                preserveAspectRatio="xMidYMid slice" clipPath={`url(#disc-clip-${deck.id})`} />
              <circle cx={c} cy={c} r={c * 0.9} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={2} />
              {rig?.label === 'power'
                // Battle rigs: the red power cap spins with the record and shows the turn.
                ? <PowerCap c={c} r={c * 0.13} />
                : <>
                  <circle cx={c} cy={c} r={c * 0.12} fill="rgba(0,0,0,0.25)" />
                  {/* Marker so the spin reads even on a plain cover */}
                  <rect x={c - 2.5} y={c - c * 0.42} width={5} height={c * 0.24} rx={2} fill="#fff" stroke="rgba(0,0,0,0.4)" strokeWidth={0.6} />
                </>}
            </>
          ) : (
            <>
              {/* Label */}
              <circle className="dj-record-label" cx={c} cy={c} r={c * 0.36} fill="var(--dj-record-label, #d71920)" />
              <circle cx={c} cy={c} r={c * 0.36} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />
              {rig?.label === 'power' ? <PowerCap c={c} r={c * 0.2} /> : <>
                <rect x={c - 2.5} y={c - c * 0.35} width={5} height={c * 0.27} rx={2} fill="#fff" />
                <text className="dj-label-text" x={c} y={c + c * 0.1} textAnchor="middle" fontSize={c * 0.12} fontWeight={800} fill="#fff" fontFamily="Inter, Arial, sans-serif" letterSpacing={0.5}>AIHub</text>
                <text className="dj-label-text dj-label-sub" x={c} y={c + c * 0.24} textAnchor="middle" fontSize={c * 0.1} fontWeight={800} fill="#ffd2d2" fontFamily="Inter, Arial, sans-serif" letterSpacing={2}>DJ</text>
              </>}
            </>
          )}
        </svg>
      </div>

      {!cover && <svg className="dj-reference-hub" width={size} height={size} style={layer} aria-hidden="true">
        <circle cx={c} cy={c} r={c * 0.38} fill="#3c4047" stroke="#747b85" strokeWidth={3} />
        <circle cx={c} cy={c} r={c * 0.29} fill="#b7bcc3" stroke="#24272e" strokeWidth={2} />
        <circle cx={c} cy={c} r={c * 0.21} fill="#101e34" stroke="#7e8998" strokeWidth={3} />
        {rig?.platter === 'silver' ? <JogLcd deck={deck} c={c} /> : <>
          <text x={c} y={c - 2} textAnchor="middle" fontSize={c * 0.09} fill="#8dceff" fontFamily="monospace">AIHUB</text>
          <text x={c} y={c + c * 0.1} textAnchor="middle" fontSize={c * 0.07} fill="#d8e9ff" fontFamily="monospace">DIRECT DRIVE</text>
        </>}
        {[0, 1, 2, 3, 4, 5].map(i => { const a = i * Math.PI / 3; return <circle key={i} cx={c + Math.cos(a) * c * 0.33} cy={c + Math.sin(a) * c * 0.33} r={c * 0.018} fill={i === 4 ? '#f15b68' : '#25282e'} /> })}
      </svg>}

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
      {/* Arm rest: fixed beside the record; the arm lies in it when no song is loaded */}
      {rig?.platter !== 'silver' && <svg className="dj-arm-rest" width={size} height={size} style={{ ...layer, overflow: 'visible' }} aria-hidden="true">
        <rect x={size * 1.012} y={size * 0.6} width={size * 0.036} height={size * 0.05} rx={size * 0.006} fill="#1c1d20" stroke="#7a8087" strokeWidth={0.8} />
        <path d={`M${size * 1.014} ${size * 0.6} Q${size * 1.03} ${size * 0.585}, ${size * 1.046} ${size * 0.6}`} stroke="#b8bdc3" strokeWidth={1.2} fill="none" />
      </svg>}
      <div ref={armRef} className="dj-tonearm" style={{ ...layer, transformOrigin: `${size * ARM.px}px ${size * ARM.py}px`, transform: `rotate(${armAngle.current}deg)`, willChange: 'transform', transition: 'transform 0.7s cubic-bezier(.2,.7,.2,1)' }}>
        <TechnicsArm size={size} />
      </div>
      {/* Turntable furniture in the corners the round platter leaves free: the
          45 adapter top-left and the stylus target light bottom-left (lit while
          a record is loaded). Silver jogs are not turntables and go without. */}
      {rig?.platter !== 'silver' && <>
        <svg className="dj-hw-adapter" viewBox="0 0 40 40" aria-hidden="true"
          style={{ position: 'absolute', left: -size * 0.02, top: -size * 0.02, width: size * 0.15, height: size * 0.15, pointerEvents: 'none' }}>
          <defs><radialGradient id={`adapter-${deck.id}`} cx="35%" cy="30%" r="80%"><stop offset="0%" stopColor="#ffffff" /><stop offset="60%" stopColor="#c9cdd2" /><stop offset="100%" stopColor="#8d939b" /></radialGradient></defs>
          <circle cx="20" cy="20" r="19" fill="#2a2c30" />
          <circle cx="20" cy="20" r="17" fill={`url(#adapter-${deck.id})`} stroke="#7d838b" strokeWidth="0.8" />
          <circle cx="20" cy="20" r="11" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.6" />
          <circle cx="20" cy="20" r="3.4" fill="#1b1c1f" stroke="#9aa0a8" strokeWidth="0.8" />
        </svg>
        <span className={`dj-hw-target ${loaded ? 'dj-on' : ''}`} aria-hidden="true"
          style={{ left: size * 0.005, bottom: size * 0.005, width: size * 0.085, height: size * 0.085 }} />
      </>}
      {/* Light reflections on the vinyl — fixed, so the record spins beneath them */}
      <img className="dj-vinyl-gloss-img" src={glossImage(Math.round(size * 0.92))} alt="" draggable={false}
        style={{ position: 'absolute', left: size * 0.04, top: size * 0.04, width: size * 0.92, height: size * 0.92, pointerEvents: 'none' }} />
    </div>
  )
}
