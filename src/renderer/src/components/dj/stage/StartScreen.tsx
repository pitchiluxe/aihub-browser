import React, { useState } from 'react'
import { PRESETS, parseBrief, type SetBrief, type PresetId } from '../ai/setBrief'

export default function StartScreen({ onStart }: { onStart: (b: SetBrief) => void }) {
  const [text, setText] = useState('')
  const [minutes, setMinutes] = useState(60)
  const go = (t: string) => { const b = parseBrief(t); onStart(/\d/.test(t) ? b : { ...b, durationMin: minutes }) }
  return <div className="dj-stage-start">
    <h1>What's the vibe?</h1>
    <p className="dj-stage-sub">Describe a set — AIHub picks the songs, mixes them, and follows what you tell it.</p>
    <form onSubmit={e => { e.preventDefault(); if (text.trim()) go(text) }}>
      <input aria-label="Describe the set" value={text} onChange={e => setText(e.target.value)} placeholder="Afrobeats warm-up into amapiano, peak at 11, no Drake" />
      <select aria-label="Set length" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
        {[30, 60, 90, 120, 180, 240].map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
      </select>
      <button type="submit" className="dj-stage-go">Start the set</button>
    </form>
    <div className="dj-stage-presets">
      {(Object.keys(PRESETS) as PresetId[]).map(id => <button key={id} onClick={() => go(PRESETS[id].text)}>{PRESETS[id].label}</button>)}
    </div>
  </div>
}
