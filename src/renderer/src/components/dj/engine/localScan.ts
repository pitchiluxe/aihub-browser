/**
 * Reads a long local file's whole waveform ahead of the playhead.
 *
 * Files over the decode limit (hour-long mixes, music videos) are never
 * decoded up front — that would take gigabytes — so, like YouTube songs, they
 * would only show what has already played. The scan plays silent copies of
 * the file at 4× (the fastest Chromium keeps audio for) through the same
 * waveform reader the YouTube scan uses. Several copies each read their own
 * stretch of the file at once, so a two-hour mix fills in within minutes.
 */
import { loadScratchWorklet } from './scratch'

const RATE = 4
const WORKERS = 3
const POLL_MS = 100
const STALL_MS = 20000

interface Worker {
  el: HTMLAudioElement
  src: MediaElementAudioSourceNode
  node: AudioWorkletNode
  from: number
  to: number
  anchor: { t: number; ctx: number } | null
  done: boolean
  lastT: number
  lastMove: number
}

export class LocalScan {
  private gen = 0
  private workers: Worker[] = []
  private sink: GainNode | null = null
  private timer = 0
  private duration = 0
  running = false
  /** Seconds of the song read so far, across all copies. */
  covered = 0

  constructor(
    private ctx: AudioContext,
    private host: HTMLElement,
    private onPeak: (t: number, peak: number, low: number) => void,
    private onEnd: (complete: boolean) => void,
  ) {}

  get progress(): number { return this.duration ? Math.min(1, this.covered / this.duration) : 0 }

  async start(url: string, duration: number, startAt = 0): Promise<void> {
    this.stop()
    const gen = ++this.gen
    this.duration = duration
    this.covered = 0
    this.finishedSeconds = 0
    if (!duration || !(await loadScratchWorklet(this.ctx)) || gen !== this.gen) return
    if (!this.sink) {
      // A silent sink keeps the readers running without being heard.
      this.sink = this.ctx.createGain()
      this.sink.gain.value = 0
      this.sink.connect(this.ctx.destination)
    }
    // Split the song; the stretch holding the playhead is read first, from the playhead.
    const n = duration > 600 ? WORKERS : 1
    const seg = duration / n
    const parts = Array.from({ length: n }, (_, i) => ({ from: i * seg, to: Math.min(duration, (i + 1) * seg) }))
    const hit = parts.findIndex(p => startAt >= p.from && startAt < p.to)
    if (hit > 0) parts.unshift(...parts.splice(hit, 1))
    if (hit >= 0 && startAt > parts[0].from + 5) {
      // The part before the playhead is read last, by whichever copy frees up.
      parts.push({ from: parts[0].from, to: startAt })
      parts[0] = { from: startAt, to: parts[0].to }
    }
    this.running = true
    for (const p of parts.slice(0, WORKERS)) void this.spawn(url, p.from, p.to, gen)
    this.pending = parts.slice(WORKERS)
    this.timer = window.setInterval(() => this.poll(gen), POLL_MS)
  }

  private pending: { from: number; to: number }[] = []
  private finishedSeconds = 0

  private async spawn(url: string, from: number, to: number, gen: number): Promise<void> {
    const el = document.createElement('audio')
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.preservesPitch = false
    el.src = url
    // Kept in the document: a detached media element can be paused by the browser.
    this.host.appendChild(el)
    const ok = await new Promise<boolean>(res => {
      el.addEventListener('loadedmetadata', () => res(true), { once: true })
      el.addEventListener('error', () => res(false), { once: true })
    })
    if (!ok || gen !== this.gen) { el.remove(); return }
    el.currentTime = from
    el.playbackRate = RATE
    const src = this.ctx.createMediaElementSource(el)
    // Low band raised by the speed-up: 150 Hz in the song is 600 Hz at 4×.
    const node = new AudioWorkletNode(this.ctx, 'aihub-dj-meter', { processorOptions: { lowHz: 150 * RATE } })
    src.connect(node).connect(this.sink!)
    const w: Worker = { el, src, node, from, to, anchor: null, done: false, lastT: from, lastMove: performance.now() }
    node.port.onmessage = e => this.onBatch(w, e.data as Float64Array)
    this.workers.push(w)
    await el.play().catch(() => {})
  }

  private onBatch(w: Worker, b: Float64Array): void {
    const a = w.anchor
    if (!a || w.done) return
    for (let i = 0; i + 2 < b.length; i += 3) {
      const t = a.t + (b[i] - a.ctx) * RATE
      if (t < w.from - 0.5 || t > w.to + 0.5) continue
      this.onPeak(t, b[i + 1], b[i + 2])
    }
  }

  private poll(gen: number): void {
    if (gen !== this.gen) return
    const now = performance.now()
    let covered = this.finishedSeconds
    for (const w of this.workers) {
      const t = w.el.currentTime
      if (!w.done) {
        if (!w.el.paused) w.anchor = { t, ctx: this.ctx.currentTime }
        else void w.el.play().catch(() => {})
        if (t > w.lastT + 0.05) { w.lastT = t; w.lastMove = now }
        if (t >= w.to - 0.05 || w.el.ended || now - w.lastMove > STALL_MS) this.retire(w)
      }
      if (!w.done) covered += Math.max(0, Math.min(w.to, w.lastT) - w.from)
    }
    this.covered = covered
    if (this.workers.length && this.workers.every(w => w.done) && !this.pending.length) this.finish(true)
  }

  /** One copy finished its stretch: free it, and start on a waiting stretch. */
  private retire(w: Worker): void {
    this.finishedSeconds += Math.max(0, Math.min(w.to, w.lastT) - w.from)
    w.done = true
    w.anchor = null
    w.el.pause()
    const next = this.pending.shift()
    if (next) {
      w.done = false
      w.from = next.from
      w.to = next.to
      w.lastT = next.from
      w.lastMove = performance.now()
      w.el.currentTime = next.from
      void w.el.play().catch(() => {})
    }
  }

  private finish(complete: boolean): void {
    const was = this.running
    this.stop()
    if (was) this.onEnd(complete)
  }

  stop(): void {
    this.gen++
    window.clearInterval(this.timer)
    this.timer = 0
    this.running = false
    this.pending = []
    for (const w of this.workers) {
      w.el.pause()
      w.node.port.onmessage = null
      try { w.src.disconnect(); w.node.disconnect() } catch { /* already gone */ }
      w.el.removeAttribute('src')
      w.el.load()
      w.el.remove()
    }
    this.workers = []
  }

  dispose(): void {
    this.stop()
    this.sink?.disconnect()
    this.sink = null
  }
}
