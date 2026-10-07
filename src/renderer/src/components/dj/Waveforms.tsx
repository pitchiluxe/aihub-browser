/**
 * Waveform displays.
 *  - OverviewWave: the whole track, click to jump; shows cue, hot cues, loop.
 *  - ZoomWave: both decks scrolling past a centre line with their beat grids,
 *    the view a DJ beat-matches by eye.
 *
 * Drawing is kept cheap on purpose. The console shares the GPU with the
 * hidden YouTube players' video decoding, and thousands of single-pixel
 * fills every display frame starved them — the music stuttered and the
 * platter lagged. So: each waveform is a handful of batched paths, frames are
 * capped at 30 fps, nothing is redrawn while nothing moves, canvas sizes are
 * measured on resize only, and the resolution is capped.
 */
import React, { useRef } from 'react'
import type { Deck } from './engine/DjEngine'
import { ENV_RATE } from './engine/analysis'
import { useCanvasBox, useRafThrottled } from './controls'

const DECK_COLORS = { A: { hi: '#4cc3ff', lo: '#1d5fff' }, B: { hi: '#ff8a3d', lo: '#ff2d55' } }
const FRAME_MS = 33
/** The track strips and the whole-song bar move less: they need fewer frames. */
const STRIP_MS = 50
const OVERVIEW_MS = 100
/**
 * Waveforms are drawn on the CPU. On a GPU canvas, a path of thousands of
 * thin bars is rasterised in the GPU process, the same process that presents
 * the YouTube players' video, and it starved them (measured 0.21× playback
 * speed with only the waveforms on screen). On the CPU the GPU just receives
 * the finished picture.
 */
const CPU_CANVAS: CanvasRenderingContext2DSettings = { willReadFrequently: true }
/** A song measured as it plays only grows a little each moment: rebuild its overview twice a second. */
const LIVE_REBUILD_MS = 500

/** #rrggbb + alpha → a pixel for a little-endian RGBA Uint32 view of ImageData. */
function pixel(hex: string, alpha = 255): number {
  const n = parseInt(hex.slice(1), 16)
  return ((alpha << 24) | ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff)) >>> 0
}

/**
 * A pixel buffer the scrolling waveforms are written into directly — a
 * vertical bar is a few array writes, with no path for anyone to rasterise —
 * then handed to the canvas in one putImageData.
 */
class BarRaster {
  img: ImageData | null = null
  px = new Uint32Array(0)
  begin(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.img || this.img.width !== w || this.img.height !== h) {
      this.img = ctx.createImageData(w, h)
      this.px = new Uint32Array(this.img.data.buffer)
    } else this.px.fill(0)
  }
  /** Column x, rows [y0, y1). */
  bar(x: number, y0: number, y1: number, c: number): void {
    const img = this.img!
    const W = img.width
    const a = Math.max(0, Math.floor(y0))
    const b = Math.min(img.height, Math.ceil(y1))
    for (let y = a; y < b; y++) this.px[y * W + x] = c
  }
}

function envOf(deck: Deck): { amp: Float32Array; low: Float32Array | null } | null {
  if (deck.analysis) return { amp: deck.analysis.env.amp, low: deck.analysis.env.low }
  if (deck.liveEnv) return { amp: deck.liveEnv, low: deck.liveLow }
  return null
}

/** Start drawing at the canvas's current CSS size; null while it has none. */
function begin(cv: HTMLCanvasElement | null, box: { w: number; h: number; k: number }) {
  // Not on screen (another tab is in front): draw nothing — the music plays on regardless.
  if (!cv || !box.w || !box.h || !cv.offsetParent) return null
  const ctx = cv.getContext('2d', CPU_CANVAS)
  if (!ctx) return null
  ctx.setTransform(box.k, 0, 0, box.k, 0, 0)
  return { ctx, w: box.w, h: box.h }
}

/** Everything that changes what a deck's waveform looks like, apart from time. */
function deckState(d: Deck): string {
  return `${d.version}|${d.playing ? 1 : 0}|${d.held ? 1 : 0}|${d.rate.toFixed(4)}|${d.scanProgress == null ? '' : Math.round(d.scanProgress * 100)}`
}

export function OverviewWave({ deck, height = 34 }: { deck: Deck; height?: number }) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const box = useCanvasBox(cvRef)
  // The waveform itself is rendered into an offscreen canvas; each frame only adds the markers.
  const cache = useRef<{ key: unknown; w: number; h: number; img: HTMLCanvasElement; at: number } | null>(null)
  const drawn = useRef('')
  const col = DECK_COLORS[deck.id]

  useRafThrottled(now => {
    const d = begin(cvRef.current, box.current)
    if (!d) return
    const { ctx, w, h } = d
    const env = envOf(deck)
    const dur = deck.duration
    const live = !deck.analysis
    // Redraw only when the playhead has moved a pixel or something else changed.
    const sig = `${Math.round(dur ? (deck.time / dur) * w : 0)}|${deckState(deck)}|${w}x${h}|${live && cache.current && now - cache.current.at >= LIVE_REBUILD_MS ? now : ''}`
    if (sig === drawn.current) return
    drawn.current = sig
    ctx.clearRect(0, 0, w, h)
    if (deck.isYouTube && (!deck.fullControl || deck.loading || !dur)) {
      // Loading, or a stream whose audio could not be captured: a progress bar.
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(0, h / 2 - 3, w, 6)
      if (dur) {
        ctx.fillStyle = '#ff2d2d'
        ctx.fillRect(0, h / 2 - 3, (deck.time / dur) * w, 6)
        ctx.fillStyle = '#ffd60a'
        ctx.fillRect((deck.cuePoint / dur) * w, 0, 1.5, h)
        ctx.fillStyle = '#fff'
        ctx.fillRect((deck.time / dur) * w - 1, 0, 2, h)
      }
      if (h >= 16) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.font = 'bold 11px Inter, Arial'
        ctx.fillText(deck.loading || !dur ? 'Loading from YouTube…' : 'YOUTUBE · DIRECT PLAYBACK', 4, 9)
      }
      return
    }
    if (!env || !dur) {
      if (deck.track) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.font = '12px Inter, Arial'
        ctx.fillText(deck.analyzing ? 'Analyzing…' : 'Loading…', 6, h / 2 + 3)
      }
      return
    }
    const key = deck.analysis ?? deck.liveEnv
    const c = cache.current
    if (!c || c.key !== key || c.w !== w || c.h !== h || (live && now - c.at >= LIVE_REBUILD_MS)) {
      const img = c?.img ?? document.createElement('canvas')
      const k = box.current.k
      img.width = Math.round(w * k)
      img.height = Math.round(h * k)
      const g = img.getContext('2d', CPU_CANVAS)!
      g.setTransform(k, 0, 0, k, 0, 0)
      g.clearRect(0, 0, w, h)
      const frames = env.amp.length
      const mid = h / 2
      const hi = new Path2D()
      const lo = new Path2D()
      const groove = new Path2D()
      for (let x = 0; x < w; x++) {
        const f0 = Math.floor((x / w) * frames)
        const f1 = Math.max(f0 + 1, Math.floor(((x + 1) / w) * frames))
        let a = 0, l = 0
        for (let f = f0; f < f1 && f < frames; f++) {
          if (env.amp[f] > a) a = env.amp[f]
          if (env.low && env.low[f] > l) l = env.low[f]
        }
        if (live && !a) { groove.rect(x, mid - 0.5, 1, 1); continue } // not heard yet
        const ah = a * (h / 2 - 1)
        hi.rect(x, mid - ah, 1, ah * 2)
        if (env.low) { const lh = l * a * (h / 2 - 1); lo.rect(x, mid - lh, 1, lh * 2) }
      }
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill(groove)
      g.fillStyle = col.hi; g.fill(hi)
      g.fillStyle = col.lo; g.fill(lo)
      cache.current = { key, w, h, img, at: now }
    }
    ctx.drawImage(cache.current!.img, 0, 0, w, h)

    const px = (t: number) => (t / dur) * w
    const head = px(deck.time)
    // Dim what has already played.
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, head, h)
    if (deck.loopIn != null && deck.loopOut != null) {
      ctx.fillStyle = deck.loopActive ? 'rgba(74,222,128,0.28)' : 'rgba(255,255,255,0.12)'
      ctx.fillRect(px(deck.loopIn), 0, Math.max(1, px(deck.loopOut) - px(deck.loopIn)), h)
    }
    ctx.fillStyle = '#ffd60a'
    ctx.fillRect(px(deck.cuePoint), 0, 1.5, h)
    deck.hotCues.forEach((t, i) => {
      if (t == null) return
      ctx.fillStyle = ['#ff3b5c', '#30d158', '#64d2ff'][i]
      ctx.beginPath()
      ctx.moveTo(px(t) - 4, 0); ctx.lineTo(px(t) + 4, 0); ctx.lineTo(px(t), 6)
      ctx.fill()
    })
    ctx.fillStyle = '#fff'
    ctx.fillRect(head - 1, 0, 2, h)
  }, OVERVIEW_MS)

  const onClick = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    deck.seekFraction((e.clientX - r.left) / r.width)
  }

  return (
    <div className="dj-overview-wrap" style={{ height }}>
      <canvas ref={cvRef} className="dj-overview" onClick={onClick} title="Click to jump" />
    </div>
  )
}

/** Seconds of real time visible across the zoomed view. */
const ZOOM_SECONDS = 12

export function ZoomWave({ decks, compact = false, seconds = ZOOM_SECONDS }: {
  decks: Deck[]
  /** One deck inside its track strip: no lane letter, YouTube note instead of a blank lane. */
  compact?: boolean
  seconds?: number
}) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const box = useCanvasBox(cvRef)
  const drawn = useRef('')
  const raster = useRef(new BarRaster()).current

  useRafThrottled(() => {
    const d = begin(cvRef.current, box.current)
    if (!d) return
    const { ctx, w, h } = d
    // Nothing moves while every deck is stopped: keep the last picture.
    const sig = decks.map(dk => `${dk.time.toFixed(3)}|${deckState(dk)}`).join('/') + `|${w}x${h}`
    if (sig === drawn.current) return
    drawn.current = sig
    const lane = h / decks.length
    const center = w / 2

    // The waveforms, written pixel by pixel at full resolution (played part dimmed).
    const k = box.current.k
    const cv = cvRef.current!
    const W = cv.width
    const H = cv.height
    raster.begin(ctx, W, H)
    decks.forEach((deck, i) => {
      const env = envOf(deck)
      if (!env || !deck.track) return
      const col = DECK_COLORS[deck.id]
      const hi = pixel(col.hi), lo = pixel(col.lo), hiPast = pixel(col.hi, 140), loPast = pixel(col.lo, 140)
      const laneD = H / decks.length
      const midD = i * laneD + laneD / 2
      const half = (lane / 2 - 2) * k
      // Track-seconds per device pixel: a faster deck scrolls faster, so two
      // synced decks show beat lines at the same spacing.
      const sppD = (seconds * deck.rate) / w / k
      const t0 = deck.time - (W / 2) * sppD
      const centreD = W / 2
      for (let x = 0; x < W; x++) {
        const ta = t0 + x * sppD
        const f0 = Math.max(0, Math.floor(ta * ENV_RATE))
        const f1 = Math.min(env.amp.length, Math.max(f0 + 1, Math.floor((ta + sppD) * ENV_RATE)))
        let a = 0, l = 0
        for (let f = f0; f < f1; f++) {
          if (env.amp[f] > a) a = env.amp[f]
          if (env.low && env.low[f] > l) l = env.low[f]
        }
        if (!a) continue
        const past = x < centreD
        const ah = Math.max(0.5, a * half)
        raster.bar(x, midD - ah, midD + ah, past ? hiPast : hi)
        if (env.low) {
          const lh = l * a * half
          if (lh >= 0.5) raster.bar(x, midD - lh, midD + lh, past ? loPast : lo)
        }
      }
    })
    ctx.putImageData(raster.img!, 0, 0)

    decks.forEach((deck, i) => {
      const top = i * lane
      const mid = top + lane / 2
      const spp = (seconds * deck.rate) / w
      const t0 = deck.time - center * spp

      // Beat grid
      if (deck.gridKnown) {
        const bl = deck.beatLen
        const first = deck.firstBeat
        const bars = new Path2D(), beats = new Path2D()
        let n = Math.ceil((t0 - first) / bl)
        for (let t = first + n * bl; t < t0 + w * spp; t += bl, n++) {
          const x = (t - t0) / spp
          const bar = ((n % 4) + 4) % 4 === 0
          const p = bar ? bars : beats
          p.rect(x, top + 1, bar ? 1.5 : 1, bar ? 6 : 4)
          p.rect(x, top + lane - (bar ? 7 : 5), bar ? 1.5 : 1, bar ? 6 : 4)
        }
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill(bars)
        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill(beats)
      }

      // Cue and loop markers
      const xOf = (t: number) => (t - t0) / spp
      if (deck.loopIn != null && deck.loopOut != null) {
        ctx.fillStyle = deck.loopActive ? 'rgba(74,222,128,0.22)' : 'rgba(255,255,255,0.08)'
        ctx.fillRect(xOf(deck.loopIn), top, xOf(deck.loopOut) - xOf(deck.loopIn), lane)
      }
      if (deck.track) {
        ctx.fillStyle = '#ffd60a'
        ctx.fillRect(xOf(deck.cuePoint), top, 1.5, lane)
      }

      if (i > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)'
        ctx.fillRect(0, top, w, 1)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.font = 'bold 11px Inter, Arial'
      if (!compact) ctx.fillText(deck.id, 4, top + 11)
      else if (deck.isYouTube) {
        // Say what is going on rather than leave the strip looking broken.
        const note = deck.loading || !deck.duration ? 'Loading from YouTube…'
          : deck.adPlaying ? 'Advert playing — the song starts right after it'
          : !deck.fullControl ? 'YouTube direct playback · this video could not be routed through the mixer'
          : null
        if (note) {
          ctx.fillStyle = 'rgba(255,255,255,0.5)'
          ctx.fillText(note, 6, mid + 4)
        } else if (deck.scanProgress != null) {
          const msg = `Reading the waveform ahead… ${Math.round(deck.scanProgress * 100)}%`
          ctx.font = '600 10px Inter, Arial'
          ctx.fillStyle = 'rgba(255,255,255,0.45)'
          ctx.fillText(msg, w - ctx.measureText(msg).width - 6, top + 11)
        }
      }
    })

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(center - 1, 0, 2, h)
    ctx.beginPath()
    ctx.moveTo(center - 5, 0); ctx.lineTo(center + 5, 0); ctx.lineTo(center, 6)
    ctx.moveTo(center - 5, h); ctx.lineTo(center + 5, h); ctx.lineTo(center, h - 6)
    ctx.fill()
  }, compact ? STRIP_MS : FRAME_MS)

  return <canvas ref={cvRef} className={compact ? 'dj-stripwave' : 'dj-zoomwave'} />
}
