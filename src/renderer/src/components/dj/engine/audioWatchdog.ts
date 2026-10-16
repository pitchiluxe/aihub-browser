/**
 * Keeps the console's AudioContext rendering while music is meant to play.
 *
 * Everything audible goes through one AudioContext: the decks, the captured
 * YouTube players (muted at the source once captured), the worklets that draw
 * the live waveforms and the meters. When Windows swaps or restarts the output
 * device under it (an audio enhancer such as FxSound, a headset, sleep), the
 * context can stop rendering — suspended or interrupted, or still "running"
 * with a clock that no longer moves. The YouTube players keep going, so the
 * decks show "playing" while there is no sound and no waveform at all.
 *
 * `check()` runs on the engine's tick. Once the clock has stood still for
 * STALL_MS with a deck playing it resumes the context, and if it was
 * "running" anyway re-opens the default output device.
 */

/** The part of an AudioContext the watchdog drives (a fake in tests). */
export interface WatchedContext {
  readonly state: string
  readonly currentTime: number
  resume(): Promise<void>
  suspend(): Promise<void>
  setSinkId?: (id: string | { type: 'none' }) => Promise<void>
}

/** How long the clock may stand still with music playing before recovery. */
export const STALL_MS = 1500
/** A failed recovery is tried again after this long, then twice as long… */
const RETRY_MS = 2000
const RETRY_MAX_MS = 30000

export class AudioWatchdog {
  private lastTime = -1
  private lastAdvanceAt = 0
  private recovering = false
  private retryAt = 0
  private failures = 0
  /** Times the context was brought back (diagnostics / tests). */
  recoveries = 0

  constructor(
    private readonly ctx: WatchedContext,
    /** True while something should be heard (a deck playing). */
    private readonly wanted: () => boolean,
    private readonly now: () => number = () => performance.now(),
    private readonly log: (msg: string) => void = m => console.warn('[dj-audio]', m),
  ) {}

  check(): void {
    const n = this.now()
    const t = this.ctx.currentTime
    const moved = t > this.lastTime
    this.lastTime = t
    if (moved || !this.wanted() || this.ctx.state === 'closed') {
      if (moved && this.failures) this.failures = 0
      this.lastAdvanceAt = n
      return
    }
    if (this.recovering || n < this.retryAt) return
    if (n - this.lastAdvanceAt < STALL_MS) return
    void this.recover()
  }

  /** Something outside saw the output change (devicechange, a render error): check soon. */
  nudge(): void { this.retryAt = 0 }

  private async recover(): Promise<void> {
    this.recovering = true
    const was = this.ctx.state
    try {
      if (was !== 'running') {
        await this.ctx.resume()
      } else if (this.ctx.setSinkId) {
        // "Running" on a device that is gone: open the default device afresh.
        // Re-picking the default it already has is a no-op, so go via none.
        await this.ctx.setSinkId({ type: 'none' })
        await this.ctx.setSinkId('')
        // Chromium leaves the context suspended across a device switch.
        if (this.ctx.state !== 'running') await this.ctx.resume()
      } else {
        await this.ctx.suspend()
        await this.ctx.resume()
      }
      this.recoveries++
      this.log(`audio output was ${was} with a stopped clock; restarted it`)
    } catch (err) {
      this.log(`could not restart the audio output (${was}): ${String((err as Error)?.message ?? err)}`)
    } finally {
      this.recovering = false
      // Judge the result on fresh ticks; if the clock still does not move, try again later.
      this.failures++
      this.lastAdvanceAt = this.now()
      this.retryAt = this.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (this.failures - 1))
    }
  }
}
