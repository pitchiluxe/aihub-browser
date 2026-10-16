/**
 * Decks that are not turntables, for the design looks (see designs.ts):
 *
 *   CdjJog     — a media-player jog wheel: knurled rubber ring, spun-metal top,
 *                and a round screen in the middle showing the artwork with a
 *                position marker that circles it as the song plays.
 *   LedJog     — a controller jog: spun aluminium with a finger dimple, inside
 *                a ring of LEDs where a lit segment runs round with the music.
 *   ScreenDeck — no platter at all: a big artwork screen, the song's progress,
 *                and a touch strip to scratch and nudge.
 *
 * All of them scratch and bend through the same hooks as the turntable, and
 * every moving part is a compositor animation, never a per-frame repaint.
 */
import React, { useRef } from 'react'
import { Music } from 'lucide-react'
import type { Deck } from './engine/DjEngine'
import { useDeck } from './controls'
import { useDeckSpin, useScratch, useStripScratch } from './jogHooks'

const layer: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }

export function CdjJog({ deck, size }: { deck: Deck; size: number }) {
  useDeck(deck)
  const rootRef = useRef<HTMLDivElement>(null)
  const spinRef = useRef<HTMLDivElement>(null)
  const hand = useScratch(deck, rootRef, 0.74)
  useDeckSpin(deck, spinRef)
  const c = size / 2
  const cover = deck.track?.cover
  const id = `cdj-${deck.id}`
  const ticks: React.ReactElement[] = []
  for (let i = 0; i < 150; i++) {
    const a = (i / 150) * Math.PI * 2
    ticks.push(<line key={i} x1={c + Math.cos(a) * c * 0.8} y1={c + Math.sin(a) * c * 0.8} x2={c + Math.cos(a) * c * 0.955} y2={c + Math.sin(a) * c * 0.955}
      stroke="rgba(0,0,0,0.55)" strokeWidth={1.1} />)
  }
  const screenR = c * 0.46
  return (
    <div ref={rootRef} className={`dj-jog dj-jog-cdj ${deck.held ? 'dj-held' : ''}`} style={{ width: size, height: size, touchAction: 'none', cursor: deck.track ? (deck.held ? 'grabbing' : 'grab') : 'default' }} {...hand}>
      <svg width={size} height={size} style={layer}>
        <defs>
          <radialGradient id={`${id}-rubber`} cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#4a4d53" />
            <stop offset="100%" stopColor="#1a1b1e" />
          </radialGradient>
          <radialGradient id={`${id}-top`} cx="42%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#f1f3f5" />
            <stop offset="60%" stopColor="#b9bec5" />
            <stop offset="100%" stopColor="#7b8189" />
          </radialGradient>
          <clipPath id={`${id}-screen`}><circle cx={c} cy={c} r={screenR} /></clipPath>
        </defs>
        {/* Housing well, knurled rubber ring, bevel. */}
        <circle cx={c} cy={c} r={c - 1} fill="#0c0d0f" />
        <circle className="dj-jog-ring" cx={c} cy={c} r={c * 0.955} fill={`url(#${id}-rubber)`} />
        {ticks}
        <circle cx={c} cy={c} r={c * 0.8} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        {/* Spun-metal top plate. */}
        <circle className="dj-jog-top" cx={c} cy={c} r={c * 0.78} fill={`url(#${id}-top)`} stroke="#5d636b" strokeWidth={1} />
        {Array.from({ length: 14 }, (_, i) => <circle key={i} cx={c} cy={c} r={c * (0.5 + i * 0.02)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.5} />)}
        {/* The screen. */}
        <circle cx={c} cy={c} r={screenR + 3} fill="#050506" />
        {cover
          ? <image href={cover} x={c - screenR} y={c - screenR} width={screenR * 2} height={screenR * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-screen)`} />
          : <circle cx={c} cy={c} r={screenR} fill="#101216" />}
        <circle cx={c} cy={c} r={screenR} fill="rgba(0,0,0,0.25)" />
        {!cover && <text x={c} y={c + 4} textAnchor="middle" fontSize={c * 0.11} fontWeight={800} fill="#6b7280" fontFamily="Inter, Arial, sans-serif" letterSpacing={1}>AIHub DJ</text>}
      </svg>
      {/* Position marker circling the screen — spun by the GPU with the song. */}
      <div ref={spinRef} style={{ ...layer, transformOrigin: '50% 50%', willChange: 'transform' }}>
        <svg width={size} height={size} style={{ display: 'block' }}>
          <rect className="dj-jog-marker" x={c - 2.5} y={c - screenR + 3} width={5} height={screenR * 0.32} rx={2.5} />
          <circle className="dj-jog-dot" cx={c} cy={c - c * 0.715} r={c * 0.035} />
        </svg>
      </div>
      {/* Glass over the screen and a highlight on the top plate — they stay put. */}
      <svg width={size} height={size} style={layer}>
        <defs>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.05)" />
            <stop offset="41%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={screenR} fill={`url(#${id}-glass)`} />
        <circle cx={c} cy={c} r={screenR + 3} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
      </svg>
    </div>
  )
}

export function LedJog({ deck, size }: { deck: Deck; size: number }) {
  useDeck(deck)
  const rootRef = useRef<HTMLDivElement>(null)
  const spinRef = useRef<HTMLDivElement>(null)
  const hand = useScratch(deck, rootRef, 0.86)
  useDeckSpin(deck, spinRef)
  const c = size / 2
  const N = 40
  const seg = (i: number, cls: string, r0 = c * 0.885, r1 = c * 0.955) => {
    const a0 = (i / N) * Math.PI * 2 - Math.PI / 2 + 0.025
    const a1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2 - 0.025
    const p = (a: number, r: number) => `${c + Math.cos(a) * r} ${c + Math.sin(a) * r}`
    return <path key={`${cls}${i}`} className={cls} d={`M${p(a0, r0)} L${p(a0, r1)} A${r1} ${r1} 0 0 1 ${p(a1, r1)} L${p(a1, r0)} A${r0} ${r0} 0 0 0 ${p(a0, r0)} Z`} />
  }
  return (
    <div ref={rootRef} className={`dj-jog dj-jog-led ${deck.held ? 'dj-held' : ''}`} style={{ width: size, height: size, touchAction: 'none', cursor: deck.track ? (deck.held ? 'grabbing' : 'grab') : 'default' }} {...hand}>
      <svg width={size} height={size} style={layer}>
        <circle cx={c} cy={c} r={c - 1} fill="#0b0c0e" />
        {Array.from({ length: N }, (_, i) => seg(i, 'dj-led-off'))}
      </svg>
      {/* The lit segment and its fading tail run round with the music. */}
      <div ref={spinRef} style={{ ...layer, transformOrigin: '50% 50%', willChange: 'transform' }}>
        <svg width={size} height={size} style={{ display: 'block' }}>
          {seg(0, 'dj-led-on')}
          {seg(N - 1, 'dj-led-on dj-led-tail1')}
          {seg(N - 2, 'dj-led-on dj-led-tail2')}
        </svg>
      </div>
      {/* Spun aluminium top with a finger dimple, centre cap with the deck letter. */}
      <div className="dj-jog-led-top" style={{ position: 'absolute', left: c * 0.2, top: c * 0.2, width: c * 1.6, height: c * 1.6 }}>
        <span className="dj-jog-dimple" style={{ left: '50%', top: '14%', width: c * 0.2, height: c * 0.2 }} />
        <span className="dj-jog-cap" style={{ width: c * 0.42, height: c * 0.42, fontSize: c * 0.2 }}>{deck.id}</span>
      </div>
    </div>
  )
}

export function ScreenDeck({ deck, size }: { deck: Deck; size: number }) {
  useDeck(deck)
  const stripRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const hand = useStripScratch(deck, stripRef)
  useDeckSpin(deck, ringRef, progress => {
    const el = barRef.current
    if (el) el.style.transform = `scaleX(${progress.toFixed(4)})`
  })
  const t = deck.track
  return (
    <div className={`dj-screendeck ${deck.held ? 'dj-held' : ''}`} style={{ width: size, height: size }}>
      <div className="dj-sd-screen">
        {t?.cover ? <img src={t.cover} alt="" draggable={false} /> : <div className="dj-sd-empty"><Music size={size * 0.16} /></div>}
        <div className="dj-sd-shade" />
        <div className="dj-sd-meta">
          <b>{t ? t.title : 'No song loaded'}</b>
          <small>{t ? t.artist : 'Drop a song on this deck'}</small>
        </div>
        {/* A small spinning ring: the deck's pulse, turned by the GPU with the song. */}
        <div className="dj-sd-pulse" ref={ringRef} />
      </div>
      <div className="dj-sd-progress"><div ref={barRef} className="dj-sd-bar" /></div>
      <div ref={stripRef} className="dj-sd-strip" style={{ touchAction: 'none', cursor: t ? 'ew-resize' : 'default' }} {...hand}
        title="Touch strip — drag to nudge the tempo while playing; Shift-drag (or a paused deck) to scratch">
        <span>TOUCH STRIP</span>
      </div>
    </div>
  )
}
