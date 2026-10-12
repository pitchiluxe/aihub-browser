import React, { useState } from 'react'

export default function SteerBar({ discovery, onDiscovery, onSkip, onSteer, onAsk, onTakeDecks }: {
  discovery: number; onDiscovery: (v: number) => void; onSkip: () => void
  onSteer: (k: 'more-energy' | 'calmer' | 'more-like-this') => void; onAsk: (t: string) => void; onTakeDecks: () => void
}) {
  const [text, setText] = useState('')
  return <div className="dj-steer">
    <div className="dj-steer-buttons">
      <button onClick={onSkip}>⏭ Skip</button>
      <button onClick={() => onSteer('more-energy')}>🔥 More energy</button>
      <button onClick={() => onSteer('calmer')}>🌙 Calmer</button>
      <button onClick={() => onSteer('more-like-this')}>≈ More like this</button>
    </div>
    <label className="dj-slider">familiar
      <input type="range" min={0} max={100} value={Math.round(discovery * 100)} aria-label="Familiar to discovery" onChange={e => onDiscovery(Number(e.target.value) / 100)} />
      discovery</label>
    <form className="dj-ask" onSubmit={e => { e.preventDefault(); if (text.trim()) { onAsk(text.trim()); setText('') } }}>
      <input aria-label="Tell the DJ" value={text} onChange={e => setText(e.target.value)} placeholder="Tell the DJ: “no Drake”, “only amapiano”, “play Calm Down by Rema next”" />
    </form>
    <button className="dj-take" onClick={onTakeDecks}>🎛 Take the decks</button>
  </div>
}
