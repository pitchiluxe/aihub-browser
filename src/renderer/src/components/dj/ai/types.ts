/** What the AI DJ knows about a track from measuring its audio. */
export interface TrackFacts {
  bpm: number | null
  /** 0..1 — 1 when both halves of the song agree on the tempo. */
  bpmConfidence: number
  /** Camelot code ("8A"), null when the key is unclear. */
  camelot: string | null
  keyConfidence: number
  /** 0..1 — loudness and pace together. */
  energy: number
  /** Seconds where the music proper starts / the ending begins — mix points. */
  introEndSec: number
  outroStartSec: number
  durationSec: number
  /** False when the track could not be scanned (blocked, stalled): never load it. */
  playable: boolean
  /** When measured — the facts store evicts the oldest first. */
  at: number
}

export type MeasuredFacts = Omit<TrackFacts, 'playable' | 'at'>

/** One key per track, whichever source it came from. */
export function trackId(t: { youtubeId?: string; path: string }): string {
  return t.youtubeId ? `yt:${t.youtubeId}` : `file:${t.path}`
}
