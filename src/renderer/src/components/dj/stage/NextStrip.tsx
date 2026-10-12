import React from 'react'
import type { Scored } from '../ai/setPlanner'

export default function NextStrip({ upNext, tentative }: { upNext: Scored[]; tentative?: Scored | null }) {
  if (!upNext.length && tentative) {
    // Shown at once; tempo and key arrive when the 2x scan finishes.
    return <div className="dj-next">
      <span className="dj-label">Up next · measuring…</span>
      <h3>{tentative.candidate.track.title}</h3>
      <p>{tentative.candidate.track.artist}</p>
    </div>
  }
  if (!upNext.length) return <div className="dj-next is-empty"><span className="dj-label">Up next</span><p>Picking the next song…</p></div>
  const [head, ...rest] = upNext
  const f = head.candidate.facts
  return <div className="dj-next">
    <span className="dj-label">Up next</span>
    <h3>{head.candidate.track.title}</h3>
    <p>{head.candidate.track.artist}</p>
    <div className="dj-now-meta">{f?.bpm ? <b>{Math.round(f.bpm)} BPM</b> : null}{f?.camelot ? <b>{f.camelot}</b> : null}<span className={`dj-mix is-${head.transition}`}>{head.transition === 'beatmatch' ? '✓ mixes' : head.transition === 'echo' ? 'echo out' : 'filter blend'}</span></div>
    <p className="dj-why">{head.why}</p>
    {rest.length > 0 && <p className="dj-then">then {rest.map(r => r.candidate.track.artist).join(' · ')}</p>}
  </div>
}
