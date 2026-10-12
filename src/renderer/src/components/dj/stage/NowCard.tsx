import React, { useSyncExternalStore } from 'react'
import type { DjEngine } from '../engine/DjEngine'
import type { SetConductor } from '../ai/setConductor'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function NowCard({ engine, conductor }: { engine: DjEngine; conductor: SetConductor }) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  const { A, B } = engine.decks
  const live = engine.crossfader <= 0.5 ? (A.track ? A : B) : (B.track ? B : A)
  if (!live?.track) return <div className="dj-now is-empty">Starting the first song…</div>
  const left = Math.max(0, (live.duration || 0) - (live.time || 0))
  const pct = live.duration ? Math.min(100, (live.time / live.duration) * 100) : 0
  const played = conductor.state.played.find(p => p.id.endsWith(live.track!.youtubeId || live.track!.path))
  return <div className="dj-now">
    <span className="dj-label">Now playing</span>
    <h2>{live.track.title}</h2>
    <p className="dj-now-artist">{live.track.artist}</p>
    <div className="dj-now-meta">{live.bpm ? <b>{Math.round(live.bpm)} BPM</b> : null}{live.musicalKey ? <b>{live.musicalKey.camelot}</b> : null}{played && !played.known ? <span className="dj-badge">new to you</span> : null}</div>
    <div className="dj-progress"><i style={{ width: `${pct}%` }} /></div>
    <span className="dj-now-left">{mmss(left)} left</span>
  </div>
}
