import React from 'react'
import type { DjTrack } from '../engine/DjEngine'

export type PickHow = 'now' | 'next' | 'A' | 'B'
export interface StageResults { query: string; tracks: DjTrack[]; loading: boolean }

const mmss = (s?: number) => s && isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : ''

/** "Wizkid" typed on the stage: their songs, each playable now, next or on a deck. */
export default function SearchResults({ results, onPick, onClose }: { results: StageResults; onPick: (t: DjTrack, how: PickHow) => void; onClose: () => void }) {
  return <section className="dj-results" aria-label={results.query ? `Songs for ${results.query}` : 'Songs'}>
    <header>
      <span className="dj-label">{results.query ? <>Songs for “{results.query}”</> : 'Songs'}</span>
      <button className="dj-results-close" aria-label="Close results" onClick={onClose}>×</button>
    </header>
    {results.loading && <p className="dj-results-note">Searching…</p>}
    {!results.loading && !results.tracks.length && <p className="dj-results-note">{results.query
      ? 'No songs found — try another spelling.'
      : 'Type an artist or a song in “Tell the DJ” below — e.g. “Beyoncé” — and its songs appear here.'}</p>}
    <ul>
      {results.tracks.map(t => <li key={t.youtubeId || t.path || t.token}>
        <div className="dj-results-title"><b>{t.title}</b><span>{t.artist}</span></div>
        <span className="dj-results-time">{mmss((t as any).durationHint)}</span>
        <button className="dj-results-play" onClick={() => onPick(t, 'now')} title="Mix it in now">▶ Play</button>
        <button onClick={() => onPick(t, 'next')} title="Play after the current song">Next</button>
        <button onClick={() => onPick(t, 'A')} title="Load on deck A">A</button>
        <button onClick={() => onPick(t, 'B')} title="Load on deck B">B</button>
      </li>)}
    </ul>
  </section>
}
