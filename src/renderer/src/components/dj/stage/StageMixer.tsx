import React, { useSyncExternalStore } from 'react'
import type { DjEngine, Deck } from '../engine/DjEngine'

type Band = 'low' | 'mid' | 'high'
const BANDS: [Band, string][] = [['low', 'bass'], ['mid', 'mid'], ['high', 'treble']]

/** The EQ knob's 0..1 as the dB a listener understands (±12 dB around flat). */
const db = (v: number) => { const d = Math.round((v - 0.5) * 24); return d === 0 ? '0 dB' : `${d > 0 ? '+' : ''}${d} dB` }

function Slider({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return <label className="dj-mx-slider">
    <span className="dj-mx-name">{label.replace(/^Deck [AB] /, '')}</span>
    <input type="range" min={0} max={100} value={Math.round(value * 100)} aria-label={label}
      onChange={e => onChange(Number(e.target.value) / 100)} onDoubleClick={() => onChange(label.endsWith('volume') ? 1 : 0.5)} />
    {hint && <span className="dj-mx-hint">{hint}</span>}
  </label>
}

function Strip({ deck, id }: { deck: Deck; id: 'A' | 'B' }) {
  // EQ / filter / volume changes notify the DECK, not the engine.
  useSyncExternalStore(deck.subscribe, deck.getVersion)
  const flat = () => { for (const [b] of BANDS) deck.setEq(b, 0.5); deck.setFilterKnob(0.5) }
  const f = deck.filterKnob
  return <div className="dj-mx-strip">
    <header>
      <b>Deck {id}</b>
      <span className="dj-mx-track">{deck.track?.title ?? 'empty'}</span>
      <button aria-label={`Flatten deck ${id}`} onClick={flat} title="Reset EQ and filter">Flat</button>
    </header>
    {BANDS.map(([b, name]) => <Slider key={b} label={`Deck ${id} ${name}`} value={deck.eq[b]} onChange={v => deck.setEq(b, v)} hint={db(deck.eq[b])} />)}
    <Slider label={`Deck ${id} filter`} value={f} onChange={v => deck.setFilterKnob(v)} hint={Math.abs(f - 0.5) < 0.03 ? 'off' : f < 0.5 ? 'low-pass' : 'high-pass'} />
    <Slider label={`Deck ${id} volume`} value={deck.volume} onChange={v => deck.setVolume(v)} hint={`${Math.round(deck.volume * 100)}%`} />
  </div>
}

/** Bass, mid, treble, filter and volume per deck, plus crossfader and master — from the stage. */
export default function StageMixer({ engine, onClose }: { engine: DjEngine; onClose: () => void }) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  return <section className="dj-mixer-panel" aria-label="Mixer">
    <header>
      <span className="dj-label">Mixer</span>
      <span className="dj-mx-tip">Double-click a slider to reset it</span>
      <button className="dj-results-close" aria-label="Close mixer" onClick={onClose}>×</button>
    </header>
    <div className="dj-mx-strips">
      <Strip deck={engine.decks.A} id="A" />
      <Strip deck={engine.decks.B} id="B" />
    </div>
    <footer>
      <Slider label="Crossfader" value={engine.crossfader} onChange={v => engine.setCrossfader(v)} hint={engine.crossfader < 0.45 ? 'A' : engine.crossfader > 0.55 ? 'B' : 'A · B'} />
      <Slider label="Master volume" value={engine.masterVolume} onChange={v => engine.setMasterVolume(v)} hint={`${Math.round(engine.masterVolume * 100)}%`} />
    </footer>
  </section>
}
