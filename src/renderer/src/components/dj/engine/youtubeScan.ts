/**
 * Reads a YouTube song's whole waveform ahead of the playhead.
 *
 * A YouTube deck's audio only exists as it plays, so the part of the song
 * still to come would be blank. The scan runs a second, silent copy of the
 * same video in its own hidden player at 4× speed, captures it, and reports
 * the peak level of each slice against the song's own timeline — a 4-minute
 * song is read in about a minute, while the deck plays normally.
 */
import { captureTab, ytBridge } from './youtubeDeck'
import { loadScratchWorklet } from './scratch'

/** Chromium keeps audio up to 4× (it mutes anything faster). */
export const SCAN_RATE = 4
const POLL_MS = 200
/** No progress for this long: give up rather than hold a player open. */
const STALL_MS = 20000

export class YouTubeScan {
  private gen = 0
  private stream: MediaStream | null = null
  private src: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private timer = 0
  private anchor: { t: number; ctx: number } | null = null
  private lastProgress = 0
  private lastT = 0
  private duration = 0
  /** How far the scan has read, in song seconds. */
  reach = 0
  running = false

  constructor(
    private key: 'A-scan' | 'B-scan' | 'C-scan' | 'D-scan',
    private ctx: AudioContext,
    private onPeak: (t: number, peak: number, low: number) => void,
    private onEnd: (complete: boolean) => void,
  ) {}

  async start(videoId: string, duration: number): Promise<void> {
    const gen = ++this.gen
    this.stop(false)
    this.duration = duration
    this.reach = 0
    this.anchor = null
    if (!(await loadScratchWorklet(this.ctx))) return
    const r = await ytBridge().load(this.key, videoId).catch(() => null)
    if (gen !== this.gen) return
    if (!r?.ok) { this.onEnd(false); return }
    if (!(await this.ensureCapture()) || gen !== this.gen) { this.onEnd(false); return }
    await ytBridge().cmd(this.key, 'keyLock', false)
    await ytBridge().cmd(this.key, 'volume', 1)
    await ytBridge().cmd(this.key, 'rate', SCAN_RATE)
    await ytBridge().cmd(this.key, 'play')
    if (gen !== this.gen) return
    this.running = true
    this.lastProgress = performance.now()
    this.timer = window.setInterval(() => { void this.poll(gen) }, POLL_MS)
  }

  private async ensureCapture(): Promise<boolean> {
    if (this.stream?.getAudioTracks().some(t => t.readyState === 'live') && this.node) return true
    const id = await ytBridge().streamId(this.key)
    if (!id) return false
    try {
      this.stream = await captureTab(id, false)
    } catch { return false }
    this.src?.disconnect()
    this.node?.disconnect()
    this.src = this.ctx.createMediaStreamSource(this.stream)
    // Low band raised by the speed-up: 150 Hz in the song is 600 Hz at 4×.
    this.node = new AudioWorkletNode(this.ctx, 'aihub-dj-meter', { processorOptions: { lowHz: 150 * SCAN_RATE } })
    // A silent sink keeps the reader running without being heard.
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0
    this.src.connect(this.node).connect(this.sink).connect(this.ctx.destination)
    this.node.port.onmessage = e => this.onBatch(e.data as Float64Array)
    return true
  }

  private onBatch(b: Float64Array): void {
    const a = this.anchor
    if (!a || !this.running) return
    for (let i = 0; i + 2 < b.length; i += 3) {
      const t = a.t + (b[i] - a.ctx) * SCAN_RATE
      if (t < 0 || t > this.duration + 1) continue
      this.onPeak(t, b[i + 1], b[i + 2])
      if (t > this.reach) this.reach = t
    }
  }

  private async poll(gen: number): Promise<void> {
    const c0 = this.ctx.currentTime
    const s = await ytBridge().state(this.key).catch(() => null)
    if (gen !== this.gen || !this.running || !s) return
    const c1 = this.ctx.currentTime
    // Adverts and stalls are not the song: stop mapping until it plays again.
    if (s.ad || s.paused || s.state === 3) {
      this.anchor = null
      if (s.paused && !s.ended && !s.ad) void ytBridge().cmd(this.key, 'play')
    } else {
      this.anchor = { t: s.t, ctx: (c0 + c1) / 2 }
    }
    if (s.t > this.lastT + 0.05) { this.lastT = s.t; this.lastProgress = performance.now() }
    if (s.ended || s.state === 0 || (this.duration && s.t >= this.duration - 0.3)) { this.finish(true); return }
    if (performance.now() - this.lastProgress > STALL_MS) this.finish(false)
  }

  private finish(complete: boolean): void {
    this.stop(true)
    this.onEnd(complete)
  }

  /** Stop scanning and let the player go (the capture is kept for the next song). */
  stop(unload = true): void {
    window.clearInterval(this.timer)
    this.timer = 0
    this.running = false
    this.anchor = null
    if (unload) void ytBridge().unload(this.key)
  }

  dispose(): void {
    this.gen++
    this.stop(true)
    this.src?.disconnect()
    this.node?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
  }
}
