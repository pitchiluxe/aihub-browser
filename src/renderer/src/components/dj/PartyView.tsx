/**
 * Party layout: one big "now playing" screen instead of the decks — the
 * video (or artwork) of what is on, the song, its progress, what comes next,
 * and one-tap controls. Made for letting Automix or the AI DJ run the night;
 * the full console is one click away in the Layout menu.
 */
import React, { useRef, useSyncExternalStore } from 'react'
import { Pause, Play, Shuffle, SkipForward, ArrowLeftRight } from 'lucide-react'
import type { Deck, DjEngine, DjTrack } from './engine/DjEngine'
import type { AutoMixer } from './engine/autoMixer'
import VideoMonitor from './VideoMonitor'
import { fmtTime, useDeck, useRafThrottled } from './controls'
import { peekNext, queueStore } from './ytQueue'

/** The deck the room is hearing: the playing one, or the louder of two by the crossfader. */
function liveDeck(engine: DjEngine): Deck {
  const { A, B } = engine.decks
  if (A.active && !B.active) return A
  if (B.active && !A.active) return B
  if (A.active && B.active) return engine.crossfader > 0.5 ? B : A
  return B.track && !A.track ? B : A
}

export default function PartyView({ engine, mixer, sidelist, say }: {
  engine: DjEngine
  mixer: AutoMixer
  sidelist: DjTrack[]
  say: (m: string) => void
}) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  useSyncExternalStore(mixer.subscribe, mixer.getVersion)
  useSyncExternalStore(queueStore.subscribe, queueStore.get)
  useDeck(engine.decks.A)
  useDeck(engine.decks.B)
  const deck = liveDeck(engine)
  const other = deck === engine.decks.A ? engine.decks.B : engine.decks.A
  const t = deck.track
  const barRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)

  // Progress and time, a few times a second — the bar moves with a GPU transform.
  useRafThrottled(() => {
    const p = deck.duration ? Math.min(1, deck.time / deck.duration) : 0
    if (barRef.current) barRef.current.style.transform = `scaleX(${p})`
    if (timeRef.current) {
      const s = deck.duration ? `${fmtTime(deck.time, false)} / ${fmtTime(deck.duration, false)}` : fmtTime(deck.time, false)
      if (timeRef.current.textContent !== s) timeRef.current.textContent = s
    }
  }, 250)

  // Up next: whatever is cued on the other deck, else the set list, else the playing YouTube list.
  const queued = peekNext()
  const next: { title: string; artist: string; cover?: string; where: string } | null =
    other.track && !other.active && other.time < 1 ? { ...other.track, where: `Cued on deck ${other.id}` }
      : sidelist[0] ? { ...sidelist[0], where: 'Next in the set list' }
      : queued ? { title: queued.title, artist: queued.artist, cover: queued.cover, where: 'Next in the YouTube queue' }
      : null

  const mixNext = () => {
    // A song already waiting on the other deck: blend straight across.
    if (other.track && !other.active) {
      void other.play()
      engine.fadeTo(other.id === 'A' ? 0 : 1, mixer.fadeSeconds)
      return
    }
    if (!mixer.on) { mixer.setOn(true); say('Automix on — mixing through your set'); return }
    say('Automix will bring in the next song shortly')
  }

  return (
    <div className="dj-party">
      <div className="dj-party-screen dj-panel">
        <VideoMonitor engine={engine} />
      </div>
      <div className="dj-party-side dj-panel">
        <div className="dj-party-now">NOW PLAYING · DECK {deck.id}</div>
        {t ? (
          <>
            <div className="dj-party-title">{t.title}</div>
            <div className="dj-party-artist">{t.artist || ' '}</div>
          </>
        ) : (
          <div className="dj-party-title dj-dim">Nothing playing yet</div>
        )}
        <div className="dj-party-progress"><div ref={barRef} /></div>
        <div className="dj-party-meta">
          <span ref={timeRef} />
          {deck.effectiveBpm ? <span>{deck.effectiveBpm.toFixed(1)} BPM</span> : null}
        </div>
        <div className="dj-party-controls">
          <button type="button" className="dj-party-play" disabled={!t} onClick={() => deck.toggle()} title={deck.active ? 'Pause' : 'Play'}>
            {deck.active ? <Pause size={26} fill="currentColor" strokeWidth={0} /> : <Play size={26} fill="currentColor" strokeWidth={0} />}
          </button>
          <button type="button" onClick={mixNext} title="Blend into the next song">
            <SkipForward size={16} /> Mix next
          </button>
          <button type="button" className={mixer.on ? 'on' : ''} onClick={() => mixer.setOn(!mixer.on)} title="Automix through the set list and the playing YouTube queue">
            <Shuffle size={15} /> Automix {mixer.on ? 'on' : 'off'}
          </button>
          <button type="button" onClick={() => engine.fadeTo(engine.crossfader < 0.5 ? 1 : 0, mixer.fadeSeconds)} title="Fade across to the other deck">
            <ArrowLeftRight size={15} />
          </button>
        </div>
        <div className="dj-party-next">
          <div className="dj-party-label">UP NEXT</div>
          {next ? (
            <div className="dj-party-next-row">
              {next.cover ? <img src={next.cover} alt="" /> : <span className="dj-party-next-ph" />}
              <div>
                <b>{next.title}</b>
                <small>{next.artist ? `${next.artist} · ` : ''}{next.where}</small>
              </div>
            </div>
          ) : (
            <p className="dj-dim">Add songs to the set list or the YouTube queue below, or let the AI DJ take over.</p>
          )}
        </div>
      </div>
    </div>
  )
}
