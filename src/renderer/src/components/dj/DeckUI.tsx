/**
 * Per-deck panels: time display, track info strip, the stems/FX/loop panel
 * and the turntable with its transport and pitch fader. Deck B mirrors A.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ArrowUpFromLine, Play, Pause, Square, Lock, ThumbsUp, ThumbsDown, Youtube, Film } from 'lucide-react'
import type { Deck, StemKey } from './engine/DjEngine'
import { FX_LABELS, type FxType } from './engine/effects'
import { Knob, LedButton, VFader, fmtTime, useDeck, useRafThrottled } from './controls'
import { OverviewWave, ZoomWave } from './Waveforms'
import Platter from './Platter'
import { recordTaste } from './taste'

export const TRACK_MIME = 'application/x-aihub-dj-track'

/** Big ELAPSED / REMAIN clock with the deck letter. */
export type DeckDrop = (src: string | File) => void

export function DeckClock({ deck, onDropTrack }: { deck: Deck; onDropTrack: DeckDrop }) {
  useDeck(deck)
  const [remain, setRemain] = useState(false)
  const timeRef = useRef<HTMLSpanElement>(null)
  useRafThrottled(() => {
    if (!timeRef.current) return
    const t = remain ? Math.max(0, deck.duration - deck.time) : deck.time
    const s = (remain && deck.track ? '-' : '') + fmtTime(t)
    if (timeRef.current.textContent !== s) timeRef.current.textContent = s
  }, 50)
  const warn = deck.track && deck.playing && deck.duration - deck.time < 30
  const letter = <div className={`dj-deck-letter ${deck.playing ? 'dj-live' : ''}`}>{deck.id}</div>
  return (
    <div className={`dj-clock dj-panel ${deck.id === 'B' ? 'dj-mirror' : ''}`} {...dropProps(onDropTrack)}>
      {deck.id === 'A' && letter}
      <button type="button" className={`dj-lcd dj-time ${warn ? 'dj-warn' : ''}`} onClick={() => setRemain(r => !r)} title="Toggle elapsed / remaining">
        <span className="dj-lcd-labels"><b className={!remain ? 'on' : ''}>ELAPSED</b> <b className={remain ? 'on' : ''}>REMAIN</b></span>
        <span ref={timeRef} className="dj-lcd-big">0:00.0</span>
      </button>
      {deck.id === 'B' && letter}
    </div>
  )
}

/**
 * Accept a song dragged from the browser (a track token) or an audio file
 * dragged straight from the desktop / Explorer. The target lights up while
 * something droppable is over it.
 */
export function dropProps(onDropTrack: DeckDrop) {
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(TRACK_MIME) || e.dataTransfer.types.includes('Files')
  const hot = (e: React.DragEvent, on: boolean) => (e.currentTarget as HTMLElement).classList.toggle('dj-drop-hot', on)
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      hot(e, true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) hot(e, false)
    },
    onDrop: (e: React.DragEvent) => {
      hot(e, false)
      const token = e.dataTransfer.getData(TRACK_MIME)
      if (token) { e.preventDefault(); onDropTrack(token); return }
      const file = e.dataTransfer.files?.[0]
      if (file) { e.preventDefault(); onDropTrack(file) }
    },
  }
}

/** Thumbs up / down on the loaded song — the strongest signal the AI DJ learns from. */
function Opinion({ deck }: { deck: Deck }) {
  const t = deck.track
  const [given, setGiven] = useState<{ token: string; v: 'like' | 'dislike' } | null>(null)
  if (!t) return null
  const mine = given?.token === t.token ? given.v : null
  const rate = (v: 'like' | 'dislike') => {
    if (mine === v) return
    setGiven({ token: t.token, v })
    recordTaste({ kind: v, artist: t.artist, title: t.title, youtubeId: t.youtubeId })
  }
  return (
    <span className="dj-opinion">
      <button type="button" className={mine === 'like' ? 'on-like' : ''} onClick={() => rate('like')} title="I like this — the AI DJ plays more like it"><ThumbsUp size={10} /></button>
      <button type="button" className={mine === 'dislike' ? 'on-dislike' : ''} onClick={() => rate('dislike')} title="Not for me — the AI DJ steers away from it"><ThumbsDown size={10} /></button>
    </span>
  )
}

/** Elapsed time, small — for layouts with no room for the big deck clocks. */
function MiniClock({ deck }: { deck: Deck }) {
  const ref = useRef<HTMLSpanElement>(null)
  useRafThrottled(() => {
    const s = fmtTime(deck.time)
    if (ref.current && ref.current.textContent !== s) ref.current.textContent = s
  }, 100)
  return <span className={`dj-mini-clock ${deck.active ? 'dj-live' : ''}`}><b>{deck.id}</b><span ref={ref} /></span>
}

export function DeckInfo({ deck, onDropTrack, clock = false }: { deck: Deck; onDropTrack: DeckDrop; clock?: boolean }) {
  useDeck(deck)
  const t = deck.track
  const bpm = deck.effectiveBpm
  const pitchPct = deck.pitch * 100
  const cover = (
    <div className="dj-cover">
      {t?.cover ? <img src={t.cover} alt="" /> : <div className="dj-cover-empty" />}
    </div>
  )
  const readout = (
    <div className="dj-lcd dj-readout">
      <div className="dj-ro-row"><span>BPM</span><b className="dj-lcd-mid">{bpm ? bpm.toFixed(2) : '00.00'}</b></div>
      <div className="dj-ro-row"><span>PITCH</span><b>{(pitchPct >= 0 ? '+' : '') + pitchPct.toFixed(1)}</b></div>
      <div className="dj-ro-row"><span>KEY</span><b>{t?.key || ''}</b>{deck.keyLock && <Lock size={9} />}</div>
    </div>
  )
  return (
    <div className={`dj-info dj-panel ${deck.id === 'B' ? 'dj-mirror' : ''}`} {...dropProps(onDropTrack)}>
      {deck.id === 'A' ? cover : readout}
      <div className="dj-lcd dj-title-box">
        <div className="dj-title-line">
          {t?.youtubeId && <span className={`dj-src-badge ${deck.fullControl ? '' : 'dj-src-direct'}`} title={deck.fullControl ? 'YouTube — full mixer control' : 'YouTube — direct playback, volume only'}><Youtube size={9} />{deck.adPlaying ? 'AD' : deck.loading ? '…' : ''}</span>}
          {t?.video && <span className="dj-src-badge dj-src-video" title="Music video"><Film size={9} /></span>}
          <span className="dj-title-text">
            {t
              ? <><b>{t.artist ? `${t.artist} - ` : ''}</b>{t.title}</>
              : <span className="dj-dim">- Drag a song on this deck to load it</span>}
          </span>
          <Opinion deck={deck} />
          {clock && <MiniClock deck={deck} />}
        </div>
        {deck.error && <div className="dj-err">{deck.error}</div>}
        {/* Live, scrolling waveform around the playhead, then the whole song for seeking */}
        <div className="dj-stripwave-wrap"><ZoomWave decks={[deck]} compact seconds={6} /></div>
        <OverviewWave deck={deck} height={10} />
      </div>
      {deck.id === 'A' ? readout : cover}
    </div>
  )
}

const STEMS: { k: StemKey; label: string; color: string }[] = [
  { k: 'vocal', label: 'Vocal', color: '#22c55e' },
  { k: 'instru', label: 'Instru', color: '#f97316' },
  { k: 'bass', label: 'Bass', color: '#ef4444' },
  { k: 'kick', label: 'Kick', color: '#3b82f6' },
  { k: 'hihat', label: 'HiHat', color: '#38bdf8' },
]

export function DeckPads({ deck, onDropTrack }: { deck: Deck; onDropTrack: DeckDrop }) {
  useDeck(deck)
  const s = deck.stems
  const acapella = s.vocal && !s.instru
  const instrumental = !s.vocal && s.instru
  const loopLabel = deck.loopBeats >= 1 ? String(deck.loopBeats) : `1/${Math.round(1 / deck.loopBeats)}`
  return (
    <div className={`dj-pads dj-panel ${deck.id === 'B' ? 'dj-mirror' : ''} ${deck.fullControl ? '' : 'dj-limited'}`} {...dropProps(onDropTrack)}
      title={deck.fullControl ? undefined : 'This YouTube video plays directly from YouTube, so stems and effects cannot reach it'}>
      {/* Stems */}
      <div className="dj-section dj-stems">
        <div className="dj-section-title">STEMS</div>
        <div className="dj-stem-grid">
          {STEMS.slice(0, 3).map(x => (
            <StemBtn key={x.k} label={x.label} color={x.color} on={s[x.k]} onClick={() => deck.setStem(x.k, !s[x.k])} />
          ))}
          <LedButton on={acapella} color="green" className="dj-small" onClick={() => deck.soloStem('acapella')} title="Acapella — vocals only">Acapella</LedButton>
          {STEMS.slice(3).map(x => (
            <StemBtn key={x.k} label={x.label} color={x.color} on={s[x.k]} onClick={() => deck.setStem(x.k, !s[x.k])} />
          ))}
          <LedButton className="dj-small" onClick={() => { for (const x of STEMS) deck.setStem(x.k, true) }} title="Bring every stem back">Reset</LedButton>
          <LedButton on={instrumental} color="orange" className="dj-small" onClick={() => deck.soloStem('instrumental')} title="Instrumental — remove vocals">Instrum.</LedButton>
        </div>
      </div>

      <div className="dj-pads-body">
        {/* Hot cues + quick filter */}
        <div className="dj-col dj-hotcues">
          {deck.hotCues.map((t, i) => (
            <button key={i} type="button" className={`dj-pad ${t != null ? `dj-pad-set dj-pad-${i}` : ''}`}
              onClick={() => deck.hotCue(i)}
              onContextMenu={e => { e.preventDefault(); deck.clearHotCue(i) }}
              title={t != null ? `Hot cue ${i + 1} at ${fmtTime(t)} — right-click to clear` : `Set hot cue ${i + 1}`}>
              {t != null ? i + 1 : ''}
            </button>
          ))}
          <Knob value={deck.filterKnob} onChange={v => deck.setFilterKnob(v)} label="FILTER" size={36} color="#a855f7"
            title="Filter — left low-pass, right high-pass" />
        </div>

        <div className="dj-col dj-grow">
          {/* Effects */}
          <div className="dj-section">
            <div className="dj-fx-row">
              <select className="dj-lcd dj-fx-select" value={deck.fxType} onChange={e => deck.setFxType(e.target.value as FxType)} aria-label="Effect">
                {(Object.keys(FX_LABELS) as FxType[]).map(k => <option key={k} value={k}>{FX_LABELS[k]}</option>)}
              </select>
            </div>
            <div className="dj-fx-row">
              <LedButton on={deck.fxOn} color="orange" className="dj-big" onClick={() => deck.setFxOn(!deck.fxOn)}>ON</LedButton>
              <Knob value={deck.fxStrength} onChange={v => deck.setFxStrength(v)} label="STR" center={0} defaultValue={0.6} color="#f97316" title="Effect strength" />
              <Knob value={deck.fxSpeed} onChange={v => deck.setFxSpeed(v)} label="SPD" center={0} defaultValue={0.4} color="#f97316"
                title={deck.fxType === 'echo' ? 'Echo length (beats)' : deck.fxType === 'reverb' ? 'Room size' : deck.fxType === 'filter' ? 'Resonance' : 'Speed'} />
            </div>
          </div>

          {/* Loop */}
          <div className="dj-section dj-loop">
            <div className="dj-section-title">LOOP</div>
            <div className="dj-loop-grid">
              <LedButton onClick={() => deck.loopResize(-1)} title="Halve loop">/2</LedButton>
              <LedButton onClick={() => deck.loopResize(1)} title="Double loop">X2</LedButton>
              <button type="button" className={`dj-lcd dj-loop-len ${deck.loopActive ? 'dj-loop-on' : ''}`} onClick={() => deck.loopToggle()} title="Loop on / off">
                {loopLabel}
              </button>
              <LedButton on={deck.loopIn != null && !deck.loopActive} color="green" onClick={() => deck.loopSetIn()} title="Loop in">IN</LedButton>
              <LedButton on={deck.loopActive} color="green" onClick={() => deck.loopSetOut()} title="Loop out">OUT</LedButton>
              <LedButton on={deck.loopActive} color="green" className="dj-small" onClick={() => deck.loopActive ? deck.loopToggle() : deck.autoLoop()} title="Beat-sized loop from here">AUTO</LedButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StemBtn({ label, color, on, onClick }: { label: string; color: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`dj-stem ${on ? 'dj-stem-on' : ''}`} style={{ '--stem': color } as React.CSSProperties} onClick={onClick}
      title={on ? `Mute ${label}` : `Bring back ${label}`}>
      {label}
      <i />
    </button>
  )
}

/** Pitch as the fader reads it: "+2.4%", "-0.8%", "0.0%". */
export function pitchText(p: number): string {
  const pct = Math.round(p * 1000) / 10
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export function Turntable({ deck, other, onDropTrack }: { deck: Deck; other: Deck; onDropTrack: DeckDrop }) {
  useDeck(deck)
  const [synced, setSynced] = useState(false)
  // Pitch fader: 0..1 with 0.5 = 0 %. Top of travel is slower, like a Technics.
  const pitchValue = 0.5 + deck.pitch / deck.pitchRange / 2
  const range = Math.round(deck.pitchRange * 100)
  // The platter fills whatever the column leaves next to the pitch fader.
  const mainRef = useRef<HTMLDivElement>(null)
  const [platter, setPlatter] = useState(220)
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setPlatter(Math.round(Math.max(130, Math.min(320, height - 4, width - 52))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className={`dj-tt dj-panel ${deck.id === 'B' ? 'dj-mirror' : ''}`} {...dropProps(onDropTrack)}
      title={deck.track ? undefined : 'Drop a song here, then press play'}>
      <div className="dj-tt-main" ref={mainRef}>
        <Platter deck={deck} size={platter} />
        <div className="dj-tt-side">
          <button type="button" className="dj-mini" onClick={() => deck.eject()} disabled={!deck.track || deck.playing} title="Eject">
            <ArrowUpFromLine size={11} />
          </button>
          {/* Live pitch as the fader moves; the range sits underneath (click to change it) */}
          <button type="button" className={`dj-lcd dj-range ${Math.abs(deck.pitch) > 0.0005 ? 'dj-range-moved' : ''}`} onClick={() => deck.cyclePitchRange()}
            title={`Pitch ${pitchText(deck.pitch)} — click to change the range (now ±${range}%)`}>
            <b>{pitchText(deck.pitch)}</b>
            <small>±{range}</small>
          </button>
          <VFader value={pitchValue} onChange={v => { setSynced(false); deck.setPitch((v - 0.5) * 2 * deck.pitchRange) }}
            height={150} defaultValue={0.5} invert className="dj-pitch" title={`Pitch ±${range}% (double-click to reset)`} ticks={9} />
        </div>
      </div>
      <div className="dj-transport">
        <button type="button" className="dj-tbtn dj-cue" onClick={() => deck.cue()} disabled={!deck.track} title="CUE">CUE</button>
        <button type="button" className="dj-tbtn" onClick={() => deck.stop()} disabled={!deck.track} title="Stop"><Square size={16} fill="currentColor" /></button>
        <button type="button" className={`dj-tbtn dj-play ${deck.active ? 'dj-playing' : ''}`} onClick={() => deck.toggle()} disabled={!deck.track}
          title={deck.active ? 'Pause' : 'Play'} aria-label={deck.active ? 'Pause' : 'Play'}>
          {deck.active ? <Pause size={22} fill="currentColor" strokeWidth={0} /> : <Play size={22} fill="currentColor" strokeWidth={0} />}
        </button>
        <button type="button" className={`dj-mini dj-keylock ${deck.keyLock ? 'dj-on dj-on-blue' : ''}`} onClick={() => deck.setKeyLock(!deck.keyLock)} title="Key lock — keep pitch when changing tempo">
          <Lock size={10} />
        </button>
        <button type="button" className={`dj-tbtn dj-sync ${synced ? 'dj-on dj-on-blue' : ''}`} disabled={!deck.track}
          onClick={() => setSynced(deck.sync(other))} title={`Match tempo${other.analysis ? ' and beats' : ''} to deck ${other.id}`}>
          SYNC
        </button>
      </div>
    </div>
  )
}
