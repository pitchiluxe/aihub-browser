/**
 * The stage as a club: a room with a lighting truss, moving-head beams, haze,
 * a mirror ball, an LED dance floor and a crowd — all moving to the tempo of
 * the song that is playing.
 *
 * Built for the YouTube players' sake: every moving layer moves only by
 * transform or opacity (the GPU composites them without repainting), nothing
 * is blurred or blended, and the page touches it only when the tempo changes —
 * it sets one CSS variable, the length of a beat. CSS animations stop by
 * themselves while the tab is hidden.
 */
import React, { useMemo } from 'react'
import type { DjEngine } from '../engine/DjEngine'

/** Seconds per beat of the loudest playing deck; a relaxed 120 BPM when nothing plays. */
export function beatSeconds(engine: Pick<DjEngine, 'decks'>): number {
  let best: { db: number; bpm: number } | null = null
  for (const d of Object.values(engine.decks)) {
    const bpm = d.playing ? d.effectiveBpm : null
    if (bpm && bpm > 40 && bpm < 220) {
      const db = d.meterDb()
      if (!best || db > best.db) best = { db, bpm }
    }
  }
  return 60 / (best?.bpm ?? 120)
}

const BEAMS = [
  { x: 12, color: '#ff2bd6', delay: 0 },
  { x: 26, color: '#22d3ee', delay: -3 },
  { x: 40, color: '#a855f7', delay: -1.5 },
  { x: 60, color: '#a855f7', delay: -4.5 },
  { x: 74, color: '#22d3ee', delay: -6 },
  { x: 88, color: '#ff2bd6', delay: -2 },
]

export default function ClubScene({ engine, playing }: { engine: DjEngine; playing: boolean }) {
  // Rounded to a few milliseconds so tiny tempo wobble does not restart the animations.
  const beat = Math.round(beatSeconds(engine) * 200) / 200
  const style = { '--beat': `${beat}s` } as React.CSSProperties
  const crowd = useMemo(() => crowdPath(), [])
  return (
    <div className={`dj-club ${playing ? 'is-playing' : ''}`} style={style} aria-hidden="true">
      <div className="dj-club-room" />
      <div className="dj-club-wall" />
      <div className="dj-club-haze dj-club-haze-1" />
      <div className="dj-club-haze dj-club-haze-2" />
      <div className="dj-club-spots" />
      {BEAMS.map((b, i) => (
        <div key={i} className="dj-club-beam" style={{ left: `${b.x}%`, animationDelay: `calc(var(--beat) * ${b.delay})`, '--beam': b.color } as React.CSSProperties}>
          <div className="dj-club-beam-cone" style={{ animationDelay: `calc(var(--beat) * ${i % 2 ? 0.5 : 0})` }} />
        </div>
      ))}
      <div className="dj-club-truss">
        {BEAMS.map((b, i) => <span key={i} className="dj-club-head" style={{ left: `${b.x}%` }} />)}
        <span className="dj-club-ball" />
      </div>
      <div className="dj-club-floor">
        <div className="dj-club-floor-tiles" />
        <div className="dj-club-floor-pulse" />
      </div>
      <svg className="dj-club-crowd dj-club-crowd-back" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d={crowd.back} /></svg>
      <svg className="dj-club-crowd dj-club-crowd-front" viewBox="0 0 1200 160" preserveAspectRatio="none"><path d={crowd.front} /></svg>
    </div>
  )
}

/** Silhouettes: rows of heads and shoulders, some hands in the air. Deterministic. */
function crowdPath(): { back: string; front: string } {
  let seed = 7
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
  const row = (h: number, n: number, headR: number, base: number) => {
    let d = `M0 ${h}`
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (1200 / n) + (rnd() - 0.5) * 18
      const top = base + (rnd() - 0.5) * headR * 1.6
      const w = headR * (2.2 + rnd() * 0.6)
      // Shoulders up to the neck, a round head, back down.
      d += ` L${x - w} ${h} L${x - w} ${top + headR * 2.6} Q${x - w} ${top + headR * 1.6} ${x - headR * 0.7} ${top + headR * 1.6}`
      d += ` A${headR} ${headR} 0 1 1 ${x + headR * 0.7} ${top + headR * 1.6}`
      d += ` Q${x + w} ${top + headR * 1.6} ${x + w} ${top + headR * 2.6} L${x + w} ${h}`
      // A raised arm now and then.
      if (rnd() > 0.62) {
        const side = rnd() > 0.5 ? 1 : -1
        const ax = x + side * w * 0.8
        d += ` M${ax - 4} ${top + headR * 2.4} L${ax + side * 10 - 3} ${top - headR * 2.2} L${ax + side * 10 + 4} ${top - headR * 2.3} L${ax + 5} ${top + headR * 2.4} Z M${x + w} ${h}`
      }
    }
    return `${d} L1200 ${h} Z`
  }
  return { back: row(120, 26, 11, 40), front: row(160, 16, 17, 50) }
}
