/**
 * Carries out what the DJ asked the assistant for. The assistant never touches
 * the audio graph directly: every action goes through the same engine, Automix
 * and queue calls the buttons use, so it can do nothing the DJ could not.
 */
import { createContext } from 'react'
import { crossfadeGains, DECK_IDS, deckSide, faderGain, type Deck, type DjEngine, type DjTrack } from './engine/DjEngine'
import type { AutoMixer } from './engine/autoMixer'
import { searchYouTube } from './libraryData'
import { recordTaste } from './taste'
import { setVoiceEnabled } from './djVoice'
import type { DjIntent, Energy } from './djBrain'

/** Everything the assistant may reach, handed down from the console. */
export interface DjEnv {
  engine: DjEngine
  mixer: AutoMixer
  /** Blend a song in over the fade length. */
  mixNow(t: DjTrack): void
  /** Put songs at the front of the set list, to play next. */
  playNext(t: DjTrack[]): void
  /** The next song waiting in the set list or the YouTube queue, taken out of it. */
  pullNext(): DjTrack | undefined
  say(msg: string): void
}

export const DjEnvContext = createContext<DjEnv | null>(null)

/** Panel state the assistant can change. */
export interface PanelControls {
  setEnergy(e: Energy): void
  setTakeover(on: boolean): void
  planVibe(text: string): void
}

/** The deck that is loudest in the mix and playing — "what is on". */
export function onAir(engine: DjEngine): Deck | null {
  let best: Deck | null = null
  let bw = 0
  const xg = crossfadeGains(engine.crossfader)
  for (const id of DECK_IDS) {
    const d = engine.decks[id]
    if (!d.track || !(d.active || d.held)) continue
    const w = xg[deckSide(id)] * faderGain(d.volume)
    if (!best || w > bw) { best = d; bw = w }
  }
  return best
}

export function describeDeck(d: Deck): string {
  const t = d.track
  if (!t) return ''
  const bpm = d.effectiveBpm
  const bits = [bpm ? `${Math.round(bpm)} BPM` : '', d.musicalKey ? d.musicalKey.camelot : ''].filter(Boolean).join(', ')
  return `${t.artist ? `${t.artist} – ` : ''}${t.title}${bits ? ` (${bits})` : ''}`
}

/** The first playable result for a spoken request: not a mix hours long, not a duplicate of what is loaded. */
async function find(query: string): Promise<DjTrack | null> {
  const results = await searchYouTube(query, 8)
  return results.find(t => !t.durationHint || t.durationHint <= 12 * 60) ?? null
}

/** Move to the next song now. Returns what the DJ should be told. */
export async function skip(env: DjEnv): Promise<string> {
  const { engine, mixer } = env
  const { A, B } = engine.decks
  const live = onAir(engine)
  const next = env.pullNext()
  if (next) { void mixer.mixNow(next, 4); return `Skipping — mixing in ${next.title}` }
  // Nothing queued: fade into a song already waiting on the other deck.
  const other = live?.id === 'A' ? B : A
  if (live && other.track && !other.active && !other.error) {
    engine.setCrossfader(engine.crossfader)
    await other.play()
    engine.fadeTo(deckSide(other.id), 4)
    return `Skipping — fading into ${other.track.title}`
  }
  return 'Nothing is lined up to skip to — queue a song, or let the AI pick more.'
}

export async function runIntent(i: DjIntent, env: DjEnv, panel: PanelControls): Promise<string> {
  const { engine, mixer } = env
  const live = onAir(engine)
  switch (i.type) {
    case 'skip': return skip(env)
    case 'pause': {
      let n = 0
      for (const id of DECK_IDS) { const d = engine.decks[id]; if (d.active) { d.pause(); n++ } }
      return n ? 'Paused' : 'Nothing is playing'
    }
    case 'resume': {
      const d = live ?? DECK_IDS.map(id => engine.decks[id]).find(x => x.track)
      if (!d) return 'Nothing is loaded yet — ask me to play a song'
      await d.play()
      return `Playing ${d.track?.title ?? ''}`.trim()
    }
    case 'fade': {
      if (engine.fading) { engine.setCrossfader(engine.crossfader); return 'Stopped the fade here' }
      engine.fadeTo(engine.crossfader < 0.5 ? 1 : 0, mixer.fadeSeconds)
      return `Fading across over ${mixer.fadeSeconds} s`
    }
    case 'sync': {
      const { A, B } = engine.decks
      const ok = B.sync(A) || A.sync(B)
      return ok ? 'Tempos synced' : 'Both decks need a known tempo to sync'
    }
    case 'loop': {
      if (!live) return 'Nothing is playing to loop'
      live.loopToggle()
      return live.loopActive ? `Looping ${live.loopBeats} beats` : 'Loop off'
    }
    case 'status': {
      if (!live) return 'Nothing is playing right now'
      const up = DECK_IDS.map(id => engine.decks[id]).find(d => d !== live && d.track && !d.active)
      return `On air: ${describeDeck(live)}${up?.track ? `. Cued next: ${up.track.title}` : ''}`
    }
    case 'like':
    case 'dislike': {
      const t = live?.track
      if (!t) return 'Nothing is playing to rate'
      recordTaste({ kind: i.type, artist: t.artist, title: t.title, youtubeId: t.youtubeId })
      return i.type === 'like' ? `Noted — you like ${t.title}` : `Noted — I will steer away from ${t.artist || t.title}`
    }
    case 'automix': mixer.setOn(i.on); return i.on ? 'Automix on' : 'Automix off'
    case 'takeover': panel.setTakeover(i.on); return i.on ? 'Taking over the decks' : 'Decks are yours'
    case 'voice': setVoiceEnabled(i.on); return i.on ? 'DJ voice on — I will announce the next song' : 'DJ voice off'
    case 'energy': {
      panel.setEnergy(i.to)
      return { auto: 'Reading the room', build: 'Building the energy', peak: 'Going to peak energy', chill: 'Bringing it down' }[i.to] + ' — the next picks will follow'
    }
    case 'volume': {
      engine.setMasterVolume(Math.min(1, Math.max(0.05, engine.masterVolume + i.delta)))
      return i.delta > 0 ? 'Louder' : 'Quieter'
    }
    case 'hit': engine.sampler.hit(i.id); return ''
    case 'mixin': {
      const t = await find(i.query)
      if (!t) return `Could not find "${i.query}" on YouTube`
      env.mixNow(t)
      return `Mixing in ${t.artist ? `${t.artist} – ` : ''}${t.title}`
    }
    case 'queue': {
      const t = await find(i.query)
      if (!t) return `Could not find "${i.query}" on YouTube`
      env.playNext([t])
      return `Up next: ${t.artist ? `${t.artist} – ` : ''}${t.title}`
    }
    case 'vibe': panel.planVibe(i.text); return `Planning a "${i.text}" set…`
  }
}
