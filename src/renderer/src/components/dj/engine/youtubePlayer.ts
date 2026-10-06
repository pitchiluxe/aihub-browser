/**
 * A YouTube embed driven over the documented postMessage protocol of the
 * IFrame Player — the same messages the official iframe_api script sends —
 * so no third-party script has to be allowed into the app's CSP.
 *
 * The video's audio stays inside YouTube's cross-origin frame. That is the
 * point of an embed, and it means Web Audio cannot reach it: a YouTube deck
 * gets transport, seek, tempo (YouTube's own rate steps) and volume, but not
 * EQ, effects, stems or a waveform.
 */

const ORIGIN = 'https://www.youtube.com'

/** YouTube's player states. */
export const YT_ENDED = 0
export const YT_PLAYING = 1
export const YT_PAUSED = 2
export const YT_BUFFERING = 3

export class YouTubePlayer {
  private iframe: HTMLIFrameElement
  private ready = false
  private pending: [string, unknown[]][] = []
  private handshake = 0
  private reportedTime = 0
  private reportedAt = 0
  private rate = 1
  private lastVolume = -1
  state = -1
  duration = 0
  videoId: string | null = null
  error: string | null = null

  constructor(host: HTMLElement, private onChange: () => void) {
    this.iframe = document.createElement('iframe')
    this.iframe.allow = 'autoplay; encrypted-media'
    this.iframe.title = 'YouTube deck'
    this.iframe.width = '200'
    this.iframe.height = '113'
    this.iframe.style.border = '0'
    host.appendChild(this.iframe)
    window.addEventListener('message', this.onMessage)
    this.iframe.addEventListener('load', () => this.startHandshake())
  }

  load(id: string): void {
    this.videoId = id
    this.ready = false
    this.pending = []
    this.state = -1
    this.duration = 0
    this.reportedTime = 0
    this.reportedAt = performance.now()
    this.error = null
    this.lastVolume = -1
    const origin = /^https?:/.test(location.origin) ? `&origin=${encodeURIComponent(location.origin)}` : ''
    this.iframe.src = `${ORIGIN}/embed/${id}?enablejsapi=1&controls=0&disablekb=1&rel=0&playsinline=1&iv_load_policy=3${origin}`
  }

  unload(): void {
    this.videoId = null
    this.ready = false
    this.state = -1
    this.iframe.src = 'about:blank'
  }

  /** Position, interpolated between the player's ~4 Hz reports. */
  get currentTime(): number {
    if (this.state !== YT_PLAYING) return this.reportedTime
    return this.reportedTime + ((performance.now() - this.reportedAt) / 1000) * this.rate
  }
  get playing(): boolean { return this.state === YT_PLAYING || this.state === YT_BUFFERING }

  play(): void { this.command('playVideo') }
  pause(): void { this.command('pauseVideo') }
  seek(t: number): void {
    this.reportedTime = t
    this.reportedAt = performance.now()
    this.command('seekTo', [t, true])
  }
  setRate(r: number): void {
    // YouTube rounds to its supported steps (0.25 … 2).
    if (r === this.rate) return
    this.rate = r
    this.command('setPlaybackRate', [r])
  }
  /** 0..1 */
  setVolume(v: number): void {
    const n = Math.round(Math.max(0, Math.min(1, v)) * 100)
    if (n === this.lastVolume) return
    this.lastVolume = n
    this.command('setVolume', [n])
  }

  dispose(): void {
    window.clearInterval(this.handshake)
    window.removeEventListener('message', this.onMessage)
    this.iframe.remove()
  }

  private command(func: string, args: unknown[] = []): void {
    if (!this.ready) { this.pending.push([func, args]); return }
    this.post({ event: 'command', func, args })
  }

  private post(msg: object): void {
    this.iframe.contentWindow?.postMessage(JSON.stringify({ ...msg, id: 1, channel: 'widget' }), ORIGIN)
  }

  /** Ask the player to start reporting, until it says it is ready. */
  private startHandshake(): void {
    window.clearInterval(this.handshake)
    if (!this.videoId) return
    let tries = 0
    this.post({ event: 'listening' })
    this.handshake = window.setInterval(() => {
      if (this.ready || ++tries > 60) { window.clearInterval(this.handshake); return }
      this.post({ event: 'listening' })
    }, 250)
  }

  private onMessage = (e: MessageEvent): void => {
    if (e.source !== this.iframe.contentWindow) return
    let data: any
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
    if (!data || typeof data !== 'object') return
    switch (data.event) {
      case 'onReady': {
        this.ready = true
        window.clearInterval(this.handshake)
        const queued = this.pending
        this.pending = []
        for (const [f, a] of queued) this.post({ event: 'command', func: f, args: a })
        this.onChange()
        break
      }
      case 'initialDelivery':
      case 'infoDelivery': {
        const info = data.info || {}
        if (!this.ready && data.event === 'initialDelivery') this.ready = true
        if (typeof info.duration === 'number' && info.duration > 0) this.duration = info.duration
        if (typeof info.currentTime === 'number') { this.reportedTime = info.currentTime; this.reportedAt = performance.now() }
        if (typeof info.playerState === 'number' && info.playerState !== this.state) { this.state = info.playerState; this.onChange() }
        break
      }
      case 'onStateChange':
        if (typeof data.info === 'number') { this.state = data.info; this.onChange() }
        break
      case 'onError':
        this.error = Number(data.info) === 101 || Number(data.info) === 150
          ? 'The owner does not allow this video to play outside YouTube'
          : 'This YouTube video could not be played'
        this.onChange()
        break
    }
  }
}
