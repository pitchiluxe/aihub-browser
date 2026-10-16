/**
 * Keeps a YouTube deck audible when its capture goes quiet.
 *
 * A YouTube deck is heard through a capture of its player (see
 * youtubeDeck.ts); the player itself is muted. If that capture stops carrying
 * sound — the stream ended, or Windows moved the player's output under it —
 * the deck shows "playing", the song's clock runs, and there is no sound and
 * no live waveform. The AudioWatchdog cannot see this: the console's own
 * AudioContext is fine, it is just being fed silence.
 *
 * `check()` runs on the deck's tick. A dead stream is captured again at once;
 * a live one that has carried nothing but silence for SILENT_MS while the song
 * plays is captured again, and if that does not bring the sound back the deck
 * falls back to playing straight out of its player (volume-only mixing, like a
 * plain embed) — reduced control beats a silent set.
 */

/** Peak (linear) below which the capture counts as silent: about -66 dBFS. */
export const SILENCE = 0.0005
/** How long a playing song may be silent before the capture is suspected. */
export const SILENT_MS = 6000
/** Fresh captures tried before falling back to the player's own output. */
const MAX_RECAPTURES = 1

export type CaptureAction = 'ok' | 'recapture' | 'fallback'

export class CaptureGuard {
  private silentSince: number | null = null
  private recaptures = 0

  constructor(private readonly silentMs = SILENT_MS) {}

  /** A new song or a new capture: judge it from scratch. */
  reset(): void {
    this.silentSince = null
    this.recaptures = 0
  }

  /**
   * @param listening the deck should be making sound right now (captured,
   *   playing, no ad, not buffering, and the console's clock is moving)
   * @param peak linear peak of the captured signal this tick
   * @param dead the capture stream has no live audio track
   */
  check(now: number, listening: boolean, peak: number, dead: boolean): CaptureAction {
    if (!listening) { this.silentSince = null; return 'ok' }
    if (peak > SILENCE && !dead) {
      // Sound is coming through: whatever was tried worked.
      this.silentSince = null
      this.recaptures = 0
      return 'ok'
    }
    if (this.silentSince === null) this.silentSince = now
    if (!dead && now - this.silentSince < this.silentMs) return 'ok'
    this.silentSince = now
    if (this.recaptures < MAX_RECAPTURES) { this.recaptures++; return 'recapture' }
    return 'fallback'
  }
}
