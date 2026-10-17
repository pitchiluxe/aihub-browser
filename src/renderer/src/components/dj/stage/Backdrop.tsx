// Music video when a deck has one (the existing A/B blend follows the
// crossfader), otherwise a beat-reactive glow driven by the master meter.
// Paused while the tab is hidden.
import React, { useEffect, useRef, useSyncExternalStore } from 'react'
import type { DjEngine } from '../engine/DjEngine'
import VideoMonitor from '../VideoMonitor'
import { stageLevel } from './stageLevel'
import ClubScene from './ClubScene'

/** `video` false: the glow only (the stage shows the picture in its own framed screen). */
export default function Backdrop({ engine, video = true }: { engine: DjEngine; video?: boolean }) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  const hasVideo = !!(engine.decks.A.track?.youtubeId || engine.decks.B.track?.youtubeId)
  const glow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (!document.hidden && glow.current) {
        glow.current.style.setProperty('--level', stageLevel(engine).toFixed(3))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine])
  const playing = Object.values(engine.decks).some(d => d.playing)
  return <div className="dj-backdrop">
    {/* The club is the room; a full-bleed video (start screen) plays in front of it. */}
    {/* Still lights whenever video is decoding: a set's own screen (video=false)
        or a full-bleed video, which covers the room anyway. */}
    <ClubScene engine={engine} playing={playing} still={!video || hasVideo} />
    {video && hasVideo ? <div className="dj-backdrop-video"><VideoMonitor engine={engine} big bare native={false} /></div> : null}
    <div ref={glow} className="dj-backdrop-glow" />
    <div className="dj-backdrop-shade" />
  </div>
}
