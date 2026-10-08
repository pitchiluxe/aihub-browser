/**
 * Set log — a running tracklist of what was actually on air, with timecodes,
 * ready to paste under a mix upload (YouTube chapters, Mixcloud, SoundCloud).
 *
 * A song counts as "on air" when it is the loudest playing deck in the mix for
 * a few seconds, so a quick cue or a half-second crossfader flick is not listed.
 */
import type { DjEngine } from './engine/DjEngine'
import { onAir } from './djActions'
import { Emitter } from './engine/DjEngine'

export interface SetEntry {
  /** Milliseconds since the log started. */
  at: number
  artist: string
  title: string
  bpm: number | null
  key: string | null
  token: string
}

/** Seconds a song must hold the top spot before it is listed. */
const HOLD_S = 4

export function fmtStamp(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(ss)}` : `${two(m)}:${two(ss)}`
}

/**
 * "00:00 Artist - Title" per line, timed from the first song (so the list can be
 * pasted as chapters on a recording that starts with the first song).
 */
export function formatTracklist(entries: readonly SetEntry[], withDetails = false): string {
  if (!entries.length) return ''
  const t0 = entries[0].at
  return entries.map(e => {
    const name = `${e.artist ? `${e.artist} - ` : ''}${e.title}`
    const bits = withDetails ? [e.bpm ? `${Math.round(e.bpm)} BPM` : '', e.key ?? ''].filter(Boolean).join(', ') : ''
    return `${fmtStamp(e.at - t0)} ${name}${bits ? ` (${bits})` : ''}`
  }).join('\n')
}

export class SetLog extends Emitter {
  entries: SetEntry[] = []
  private started = 0
  private candidate: { token: string; since: number } | null = null
  private timer = 0

  constructor(private engine: DjEngine) {
    super()
    this.started = performance.now()
    this.timer = window.setInterval(() => this.tick(), 1000)
  }

  private tick(): void {
    const d = onAir(this.engine)
    const t = d?.track
    if (!d || !t || !d.playing) { this.candidate = null; return }
    const last = this.entries[this.entries.length - 1]
    if (last?.token === t.token) { this.candidate = null; return }
    const now = performance.now()
    if (this.candidate?.token !== t.token) { this.candidate = { token: t.token, since: now }; return }
    if (now - this.candidate.since < HOLD_S * 1000) return
    this.entries.push({
      at: this.candidate.since - this.started,
      artist: t.artist, title: t.title, token: t.token,
      bpm: d.effectiveBpm, key: d.musicalKey?.camelot ?? null,
    })
    this.candidate = null
    this.emit()
  }

  clear(): void {
    this.entries = []
    this.candidate = null
    this.started = performance.now()
    this.emit()
  }

  text(withDetails = false): string { return formatTracklist(this.entries, withDetails) }

  dispose(): void { window.clearInterval(this.timer) }
}
