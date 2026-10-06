/**
 * Two-channel mixer: trim, 3-band kill EQ, channel faders with meters,
 * master and headphone section, PFL and a constant-power crossfader.
 */
import React, { useSyncExternalStore } from 'react'
import { Headphones, ArrowLeftRight } from 'lucide-react'
import type { DjEngine, Deck, EqBand } from './engine/DjEngine'
import { HFader, Knob, VFader, VuMeter, useDeck } from './controls'
import VideoMonitor from './VideoMonitor'

function Channel({ deck }: { deck: Deck }) {
  useDeck(deck)
  const limited = !deck.fullControl
  const bands: { b: EqBand; label: string }[] = [{ b: 'high', label: 'HIGH' }, { b: 'mid', label: 'MID' }, { b: 'low', label: 'LOW' }]
  return (
    <div className={`dj-ch ${limited ? 'dj-limited' : ''}`} title={limited ? 'This YouTube video plays directly — only volume and the crossfader reach it' : undefined}>
      <Knob value={deck.gainKnob} onChange={v => deck.setGainKnob(v)} label="GAIN" size={24} color="#e5e7eb" title="Trim ±12 dB" />
      {bands.map(({ b, label }) => (
        <Knob key={b} value={deck.eq[b]} onChange={v => deck.setEq(b, v)} label={label} size={26}
          color={deck.eq[b] < 0.5 ? '#ef4444' : '#22c55e'} title={`${label} EQ — full left kills the band`} />
      ))}
    </div>
  )
}

function Strip({ deck }: { deck: Deck }) {
  useDeck(deck)
  return (
    <div className="dj-strip">
      <button type="button" className={`dj-mini dj-pfl ${deck.pfl ? 'dj-on dj-on-orange' : ''}`} onClick={() => deck.setPfl(!deck.pfl)}
        title={`Pre-listen deck ${deck.id} in headphones`}>
        <Headphones size={10} />
      </button>
      <VFader value={deck.volume} onChange={v => deck.setVolume(v)} height={84} defaultValue={0.8} title={`Deck ${deck.id} volume`} />
    </div>
  )
}

export default function Mixer({ engine, view, setView, onBigVideo, fadeSeconds }: {
  engine: DjEngine
  view: 'mixer' | 'video'
  setView: (v: 'mixer' | 'video') => void
  onBigVideo: () => void
  fadeSeconds: number
}) {
  const { A, B } = engine.decks
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  // Fade across to whichever side the fader is further from.
  const fadeAcross = () => engine.fading ? engine.setCrossfader(engine.crossfader) : engine.fadeTo(engine.crossfader < 0.5 ? 1 : 0, fadeSeconds)
  return (
    <div className="dj-mixer dj-panel">
      <div className="dj-mixer-tabs">
        <span>CH A</span>
        <div className="dj-mixer-switch" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'mixer'} className={view === 'mixer' ? 'on' : ''} onClick={() => setView('mixer')}>MIXER</button>
          <button type="button" role="tab" aria-selected={view === 'video'} className={view === 'video' ? 'on' : ''} onClick={() => setView('video')}>VIDEO</button>
        </div>
        <span>CH B</span>
      </div>
      {view === 'video' ? (
        <div className="dj-mixer-video"><VideoMonitor engine={engine} onToggleBig={onBigVideo} /></div>
      ) : (
      <div className="dj-mixer-body">
        <Channel deck={A} />
        <div className="dj-mixer-center">
          <div className="dj-meters">
            <VuMeter read={() => A.meterDb()} height={96} />
            <div className="dj-master-meters">
              <VuMeter read={() => engine.masterDb()[0]} height={96} />
              <VuMeter read={() => engine.masterDb()[1]} height={96} />
            </div>
            <VuMeter read={() => B.meterDb()} height={96} />
          </div>
          <Knob value={engine.masterVolume} onChange={v => engine.setMasterVolume(v)} label="MASTER" size={30} center={0} defaultValue={0.85} color="#22c55e" />
          <div className="dj-section-title dj-tight">HEADPHONES</div>
          <div className="dj-row">
            <Knob value={engine.phonesVolume} onChange={v => engine.setPhonesVolume(v)} label="VOL" size={26} center={0} defaultValue={0.8} />
            <Knob value={engine.cueMix} onChange={v => engine.setCueMix(v)} label="CUE MIX" size={26} center={0} defaultValue={0} title="Cue ↔ master in headphones" />
          </div>
        </div>
        <Channel deck={B} />
      </div>
      )}
      <div className="dj-mixer-faders">
        <Strip deck={A} />
        <div className="dj-mixer-logo">
          <span className="dj-logo-ai">AIHub</span>
          <span className="dj-logo-dj">DJ</span>
          <small>2-DECK MIX ENGINE</small>
        </div>
        <Strip deck={B} />
      </div>
      <div className="dj-xfader">
        <span>◂ A</span>
        <HFader value={engine.crossfader} onChange={v => engine.setCrossfader(v)} width={130} title="Crossfader (double-click to centre)" />
        <span>B ▸</span>
        <button type="button" className={`dj-mini dj-fade-btn ${engine.fading ? 'dj-on dj-on-blue' : ''}`} onClick={fadeAcross}
          title={engine.fading ? 'Stop the fade here' : `Fade across to the other deck over ${fadeSeconds} s`}>
          <ArrowLeftRight size={10} />
        </button>
      </div>
    </div>
  )
}
