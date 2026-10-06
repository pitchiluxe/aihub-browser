/**
 * Watches the decks and writes one listening record per song that played:
 * how many seconds were actually heard on the master (a deck faded out on
 * the crossfader or pulled down on its fader does not count) and how it ended.
 * These records are what the AI DJ learns the DJ's taste from.
 */
import { crossfadeGains, type DeckId, type DjEngine, type DjTrack } from './engine/DjEngine'
import { classifyListen, recordTaste } from './taste'

interface Session {
  track: DjTrack
  heard: number
  duration: number
  lastTime: number
  auto: boolean
  done: boolean
}

const TICK_S = 1
/** Below this many seconds heard, a song says nothing about taste. */
const MIN_HEARD = 4

export class ListeningTracker {
  private sessions: Record<DeckId, Session | null> = { A: null, B: null }
  private autoLoaded: Record<DeckId, boolean> = { A: false, B: false }
  private timer: number

  constructor(private engine: DjEngine) {
    this.timer = window.setInterval(() => this.tick(), TICK_S * 1000)
  }

  /** Who loaded the deck — Automix / AI DJ picks are weighed a little lower. */
  noteLoad(deck: DeckId, auto: boolean): void { this.autoLoaded[deck] = auto }

  private audible(id: DeckId): boolean {
    const d = this.engine.decks[id]
    const [a, b] = crossfadeGains(this.engine.crossfader)
    return (id === 'A' ? a : b) > 0.25 && d.volume > 0.15 && this.engine.masterVolume > 0.05
  }

  private tick(): void {
    for (const id of ['A', 'B'] as DeckId[]) {
      const deck = this.engine.decks[id]
      let s = this.sessions[id]
      if (s && s.track !== deck.track) { this.finish(s, false); s = this.sessions[id] = null }
      if (!deck.track) continue
      if (!s) s = this.sessions[id] = { track: deck.track, heard: 0, duration: 0, lastTime: 0, auto: this.autoLoaded[id], done: false }
      if (s.done) continue
      if (deck.playing && !deck.adPlaying && this.audible(id)) s.heard += TICK_S
      s.duration = deck.duration
      s.lastTime = deck.time
      // Played out to the end on its own.
      if (!deck.active && deck.duration > 0 && deck.time >= deck.duration - 1.5) this.finish(s, true)
    }
  }

  private finish(s: Session, ended: boolean): void {
    if (s.done) return
    s.done = true
    if (s.heard < MIN_HEARD) return
    const t = s.track
    recordTaste({
      kind: 'play',
      artist: t.artist,
      title: t.title,
      youtubeId: t.youtubeId,
      listened: s.heard,
      duration: s.duration,
      outcome: classifyListen(s.heard, s.duration, ended),
      auto: s.auto,
    })
  }

  /** The page is closing: whatever is playing now still counts. */
  dispose(): void {
    window.clearInterval(this.timer)
    for (const id of ['A', 'B'] as DeckId[]) {
      const s = this.sessions[id]
      // Not a skip — the DJ closed the console, not the song.
      if (s && !s.done && s.heard >= MIN_HEARD) {
        s.done = true
        recordTaste({ kind: 'play', artist: s.track.artist, title: s.track.title, youtubeId: s.track.youtubeId, listened: s.heard, duration: s.duration, outcome: s.heard / Math.max(1, s.duration) >= 0.7 ? 'complete' : 'sample', auto: s.auto })
      }
    }
  }
}
