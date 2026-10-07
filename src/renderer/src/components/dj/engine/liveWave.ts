/**
 * Waveform of a song that is not decoded up front (YouTube, very long
 * files), built from two sources:
 *  - what the deck actually played, filled in as it plays;
 *  - a scan read ahead of the playhead (YouTube), so the coming part of the
 *    song shows too.
 * The scan carries its own small capture delay; once enough has been played,
 * the scan is shifted to line up with what was heard.
 *
 * `env` / `low` are what the waveform views draw (same layout as a decoded
 * envelope: one frame per 1/ENV_RATE s; low is a share of the full peak).
 */
import { bestLag, detectBpm, ENV_RATE, onsetCurve } from './analysis'

/** Played frames needed before trusting an alignment. */
const ALIGN_MIN_FRAMES = 800
const ALIGN_WINDOW = 1500
const ALIGN_MAX_LAG = 150

export class LiveWave {
  env: Float32Array
  low: Float32Array
  private playEnv: Float32Array
  private playLow: Float32Array
  private scanEnv: Float32Array
  private scanLow: Float32Array
  /** Frames the scan is moved by to match the played audio. */
  shift = 0
  hasScan = false
  played = 0
  private aligned = 0

  constructor(readonly frames: number, from?: LiveWave) {
    const f = () => new Float32Array(frames)
    this.env = f(); this.low = f()
    this.playEnv = f(); this.playLow = f()
    this.scanEnv = f(); this.scanLow = f()
    if (from) {
      const copy = (a: Float32Array, b: Float32Array) => a.set(b.subarray(0, Math.min(frames, b.length)))
      copy(this.playEnv, from.playEnv); copy(this.playLow, from.playLow)
      copy(this.scanEnv, from.scanEnv); copy(this.scanLow, from.scanLow)
      this.shift = from.shift
      this.hasScan = from.hasScan
      this.played = from.played
      this.aligned = from.aligned
      this.rebuild()
    }
  }

  /** Peak heard on the deck at frame i (low = share of it in the kick/bass band). */
  addPlayed(i: number, peak: number, low: number): void {
    if (i < 0 || i >= this.frames) return
    if (!this.playEnv[i]) this.played++
    if (peak > this.playEnv[i]) this.playEnv[i] = peak
    if (low > this.playLow[i]) this.playLow[i] = low
    if (peak > this.env[i]) this.env[i] = peak
    if (low > this.low[i]) this.low[i] = low
  }

  /** A scanned peak at song time t (seconds). */
  addScanned(t: number, peak: number, low: number): void {
    const i = Math.floor(t * ENV_RATE)
    if (i < 0 || i >= this.frames) return
    this.hasScan = true
    const share = peak > 0 ? Math.min(1, low / peak) : 0
    if (peak > this.scanEnv[i]) this.scanEnv[i] = Math.min(1, peak)
    if (share > this.scanLow[i]) this.scanLow[i] = share
    const j = i + this.shift
    if (j >= 0 && j < this.frames) {
      if (this.scanEnv[i] > this.env[j]) this.env[j] = this.scanEnv[i]
      if (this.scanLow[i] > this.low[j]) this.low[j] = this.scanLow[i]
    }
  }

  /**
   * Line the scan up with what was played around frame `at`. Done a couple
   * of times early in the song; returns true when the shift changed.
   */
  align(at: number): boolean {
    if (!this.hasScan || this.played < ALIGN_MIN_FRAMES || this.aligned >= 2) return false
    if (this.aligned === 1 && this.played < ALIGN_MIN_FRAMES * 3) return false
    const lag = bestLag(this.playEnv, this.scanEnv, Math.max(0, at - ALIGN_WINDOW), at, ALIGN_MAX_LAG)
    this.aligned++
    if (lag == null || lag === this.shift) return false
    this.shift = lag
    this.rebuild()
    return true
  }

  /** Tempo of the scanned song, from its first `upTo` frames (all of it by default). */
  scannedBpm(upTo = this.frames): number | null {
    if (!this.hasScan) return null
    const n = Math.min(this.frames, upTo)
    return detectBpm(onsetCurve({ amp: this.scanEnv.subarray(0, n), low: this.scanLow.subarray(0, n), rate: ENV_RATE }))
  }

  private rebuild(): void {
    this.env.set(this.playEnv)
    this.low.set(this.playLow)
    for (let i = 0; i < this.frames; i++) {
      const j = i + this.shift
      if (j < 0 || j >= this.frames) continue
      if (this.scanEnv[i] > this.env[j]) this.env[j] = this.scanEnv[i]
      if (this.scanLow[i] > this.low[j]) this.low[j] = this.scanLow[i]
    }
  }
}
