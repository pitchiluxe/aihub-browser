// Music video when a deck has one (the existing A/B blend follows the
// crossfader), otherwise a beat-reactive glow driven by the master meter.
// Paused while the tab is hidden.
import React, { useEffect, useRef, useSyncExternalStore } from 'react'
import type { DjEngine } from '../engine/DjEngine'
import VideoMonitor from '../VideoMonitor'

export default function Backdrop({ engine }: { engine: DjEngine }) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  const hasVideo = !!(engine.decks.A.track?.youtubeId || engine.decks.B.track?.youtubeId)
  const glow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (!document.hidden && glow.current) {
        const db = (engine as any).meterDb?.() ?? -60
        const level = Math.max(0, Math.min(1, (db + 40) / 40))
        glow.current.style.setProperty('--level', level.toFixed(3))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine])
  return <div className="dj-backdrop">
    {hasVideo ? <div className="dj-backdrop-video"><VideoMonitor engine={engine} big /></div> : null}
    <div ref={glow} className="dj-backdrop-glow" />
    <div className="dj-backdrop-shade" />
  </div>
}
