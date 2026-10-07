/**
 * The DJ page's side of a YouTube deck. The player runs in a hidden window
 * owned by the main process (src/main/dj/youtubeDeck.ts); this class sends it
 * commands, polls its state, and captures its audio — and, when the video
 * monitor asks, its picture — so the song runs through the deck like a file.
 *
 * Commands are applied optimistically: Play shows playing at once, and a
 * state report that was already on its way before the command is ignored, so
 * the transport never flips back to a stale value. While the DJ wants the
 * song playing, a pause the DJ did not ask for (YouTube pausing a "second
 * player", the OS media session…) is undone.
 */

export interface YtState {
  ready: boolean
  t: number
  d: number
  paused: boolean
  ended: boolean
  state: number
  ad: boolean
  error: string | null
}

const POLL_MS = 150
const YT_BUFFERING = 3

interface YtBridge {
  load(deck: string, id: string): Promise<{ ok: boolean; error?: string; state?: YtState }>
  streamId(deck: string): Promise<string | null>
  state(deck: string): Promise<YtState | null>
  cmd(deck: string, cmd: string, value?: unknown): Promise<boolean>
  unload(deck: string): Promise<boolean>
}

export const ytBridge = (): YtBridge => (window as any).electronAPI.dj.yt

export async function captureTab(id: string, video: boolean): Promise<MediaStream> {
  const src = { chromeMediaSource: 'tab', chromeMediaSourceId: id }
  return navigator.mediaDevices.getUserMedia({
    audio: video ? false : ({ mandatory: src } as any),
    video: video ? ({ mandatory: { ...src, maxWidth: 640, maxHeight: 360, maxFrameRate: 30 } } as any) : false,
  })
}

export class YouTubeDeck {
  videoId: string | null = null
  duration = 0
  error: string | null = null
  ad = false
  loading = false
  /** Audio of the player window, once captured. */
  audioStream: MediaStream | null = null
  /** True when the deck's audio comes through Web Audio rather than straight out of the player. */
  captured = false

  private paused = true
  private ended = false
  private buffering = false
  private reportedT = 0
  private reportedAt = 0
  private rate = 1
  private want = false
  private seq = 0
  private gen = 0
  private strayPauses = 0
  private timer = 0
  private polling = false
  private videoStream: MediaStream | null = null
  private videoUsers = 0
  readonly videoEl: HTMLVideoElement

  constructor(private deck: 'A' | 'B', host: HTMLElement, private onChange: () => void) {
    this.videoEl = document.createElement('video')
    this.videoEl.muted = true
    this.videoEl.playsInline = true
    this.videoEl.width = 160
    this.videoEl.height = 90
    host.appendChild(this.videoEl)
  }

  get currentTime(): number {
    if (this.paused || this.ended || this.buffering) return this.reportedT
    return this.reportedT + ((performance.now() - this.reportedAt) / 1000) * this.rate
  }
  get playing(): boolean { return !this.paused && !this.ended }
  get hasVideo(): boolean { return !!this.videoStream }

  /** Load a video; resolves false (with `error` set) when it cannot play. */
  async load(id: string): Promise<boolean> {
    const gen = ++this.gen
    this.videoId = id
    this.loading = true
    this.error = null
    this.ad = false
    this.duration = 0
    this.paused = true
    this.ended = false
    this.want = false
    this.reportedT = 0
    this.reportedAt = performance.now()
    this.seq++
    this.onChange()
    const r: { ok: boolean; error?: string; state?: YtState } = await ytBridge().load(this.deck, id)
      .catch(() => ({ ok: false, error: 'The YouTube player could not start' }))
    if (gen !== this.gen) return false
    this.loading = false
    if (!r.ok) {
      if (r.error !== 'superseded') this.error = r.error || 'This YouTube video could not be played'
      this.onChange()
      return false
    }
    if (r.state?.d) this.duration = r.state.d
    await this.ensureAudio()
    if (gen !== this.gen) return false
    // Full volume inside the player; the mixer sets the level from here on.
    void ytBridge().cmd(this.deck, 'volume', 1)
    void ytBridge().cmd(this.deck, 'rate', this.rate)
    this.startPolling()
    this.onChange()
    return true
  }

  unload(): void {
    this.gen++
    this.videoId = null
    this.want = false
    this.paused = true
    this.duration = 0
    this.error = null
    this.stopPolling()
    void ytBridge().unload(this.deck)
  }

  play(): void {
    if (!this.videoId) return
    this.want = true
    if (this.ended) { this.ended = false; this.reportedT = 0 }
    this.paused = false
    this.reportedAt = performance.now()
    this.seq++
    void ytBridge().cmd(this.deck, 'play')
  }

  pause(): void {
    this.reportedT = this.currentTime
    this.reportedAt = performance.now()
    this.want = false
    this.paused = true
    this.seq++
    void ytBridge().cmd(this.deck, 'pause')
  }

  seek(t: number): void {
    this.reportedT = t
    this.reportedAt = performance.now()
    this.ended = false
    this.seq++
    void ytBridge().cmd(this.deck, 'seek', t)
  }

  setRate(r: number): void {
    if (Math.abs(r - this.rate) < 1e-4) return
    // Re-base the clock so the interpolated position does not jump.
    this.reportedT = this.currentTime
    this.reportedAt = performance.now()
    this.rate = r
    void ytBridge().cmd(this.deck, 'rate', r)
  }

  setKeyLock(on: boolean): void { void ytBridge().cmd(this.deck, 'keyLock', on) }

  /** Only used when capture failed and the player is heard directly. */
  private lastVol = -1
  setVolume(v: number): void {
    if (this.captured) return
    const n = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100
    if (n === this.lastVol) return
    this.lastVol = n
    void ytBridge().cmd(this.deck, 'volume', n)
  }

  /** The monitor wants pictures: capture the player's video while anyone is watching. */
  async retainVideo(): Promise<void> {
    this.videoUsers++
    if (this.videoStream || this.videoUsers !== 1) return
    const id = await ytBridge().streamId(this.deck)
    if (!id || !this.watched()) return
    try {
      const s = await captureTab(id, true)
      if (!this.watched()) { s.getTracks().forEach(t => t.stop()); return }
      this.videoStream = s
      this.videoEl.srcObject = s
      await this.videoEl.play().catch(() => {})
      this.onChange()
    } catch { /* the monitor shows the cover instead */ }
  }
  /** Read through a method so TypeScript does not narrow the count across awaits. */
  private watched(): boolean { return this.videoUsers > 0 }
  releaseVideo(): void {
    this.videoUsers = Math.max(0, this.videoUsers - 1)
    if (this.videoUsers || !this.videoStream) return
    this.videoStream.getTracks().forEach(t => t.stop())
    this.videoStream = null
    this.videoEl.srcObject = null
    this.onChange()
  }

  dispose(): void {
    this.gen++
    this.stopPolling()
    this.audioStream?.getTracks().forEach(t => t.stop())
    this.videoStream?.getTracks().forEach(t => t.stop())
    this.videoEl.remove()
  }

  private async ensureAudio(): Promise<void> {
    if (this.audioStream?.getAudioTracks().some(t => t.readyState === 'live')) return
    const id = await ytBridge().streamId(this.deck)
    try {
      if (!id) throw new Error('no capture id')
      this.audioStream = await captureTab(id, false)
      this.captured = true
      void ytBridge().cmd(this.deck, 'audible', false)
    } catch {
      // Without a capture the song still plays — straight out of the player,
      // with volume as the only mixer control, like a plain embed.
      this.audioStream = null
      this.captured = false
      void ytBridge().cmd(this.deck, 'audible', true)
    }
  }

  private startPolling(): void {
    if (this.timer) return
    this.timer = window.setInterval(() => { void this.poll() }, POLL_MS)
  }
  private stopPolling(): void {
    window.clearInterval(this.timer)
    this.timer = 0
  }

  /**
   * Fold a reported position into the running clock. While playing smoothly,
   * small differences are eased in rather than jumped to — re-basing on every
   * report made the platter and the waveforms judder with IPC timing.
   */
  private correctClock(t: number, readAt: number, running: boolean): void {
    const measured = t + (running ? ((performance.now() - readAt) / 1000) * this.rate : 0)
    const now = performance.now()
    if (running && !this.paused) {
      const predicted = this.currentTime
      const err = measured - predicted
      if (Math.abs(err) < 0.25) {
        this.reportedT = predicted + err * 0.25
        this.reportedAt = now
        return
      }
    }
    this.reportedT = measured
    this.reportedAt = now
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.videoId) return
    this.polling = true
    const seq = this.seq
    const gen = this.gen
    const sentAt = performance.now()
    try {
      const s = await ytBridge().state(this.deck)
      if (!s || gen !== this.gen) return
      // The position was read about halfway through the round trip.
      const readAt = (sentAt + performance.now()) / 2
      let changed = false
      if (s.d && Math.abs(s.d - this.duration) > 0.5) { this.duration = s.d; changed = true }
      if (s.ad !== this.ad) { this.ad = s.ad; changed = true }
      if (s.error !== this.error && s.error) { this.error = s.error; changed = true }
      // Reports sent before the latest command describe the old state.
      if (seq === this.seq) {
        const ended = s.ended || s.state === 0
        const buffering = s.state === YT_BUFFERING
        if (ended !== this.ended) { this.ended = ended; if (ended) this.want = false; changed = true }
        if (buffering !== this.buffering) { this.buffering = buffering; changed = true }
        if (!s.ad) this.correctClock(s.t, readAt, !s.paused && !ended && !buffering)
        const paused = s.paused && !ended
        if (paused && this.want && !s.ad) {
          // A pause nobody asked for: give it a moment (seek / quality switch), then resume.
          if (++this.strayPauses >= 2) { this.strayPauses = 0; void ytBridge().cmd(this.deck, 'play') }
        } else {
          this.strayPauses = 0
          if (paused !== this.paused) { this.paused = paused; changed = true }
        }
      }
      if (changed) this.onChange()
    } finally {
      this.polling = false
    }
  }
}
