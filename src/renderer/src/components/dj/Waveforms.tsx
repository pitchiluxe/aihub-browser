/**
 * Waveform displays.
 *  - OverviewWave: the whole track, click to jump; shows cue, hot cues, loop.
 *  - ZoomWave: both decks scrolling past a centre line with their beat grids,
 *    the view a DJ beat-matches by eye.
 */
import React, { useRef } from 'react'
import type { Deck } from './engine/DjEngine'
import { ENV_RATE } from './engine/analysis'
import { useRaf } from './controls'

const DECK_COLORS = { A: { hi: '#4cc3ff', lo: '#1d5fff' }, B: { hi: '#ff8a3d', lo: '#ff2d55' } }

function envOf(deck: Deck): { amp: Float32Array; low: Float32Array | null } | null {
  if (deck.analysis) return { amp: deck.analysis.env.amp, low: deck.analysis.env.low }
  if (deck.liveEnv) return { amp: deck.liveEnv, low: null }
  return null
}

function fitCanvas(cv: HTMLCanvasElement): { w: number; h: number; ctx: CanvasRenderingContext2D } | null {
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  const w = cv.clientWidth
  const h = cv.clientHeight
  if (!w || !h) return null
  // Real device pixels, including any CSS zoom on the console, so the
  // waveform stays sharp when the console is scaled to fit the tab.
  const rect = cv.getBoundingClientRect()
  const k = (window.devicePixelRatio || 1) * (rect.width / w)
  if (cv.width !== Math.round(w * k) || cv.height !== Math.round(h * k)) {
    cv.width = Math.round(w * k)
    cv.height = Math.round(h * k)
  }
  ctx.setTransform(k, 0, 0, k, 0, 0)
  return { w, h, ctx }
}

export function OverviewWave({ deck, height = 34 }: { deck: Deck; height?: number }) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  // The static waveform is rendered once per analysis into an offscreen canvas.
  const cache = useRef<{ key: unknown; w: number; img: HTMLCanvasElement } | null>(null)
  const col = DECK_COLORS[deck.id]

  useRaf(() => {
    const cv = cvRef.current
    if (!cv) return
    const fit = fitCanvas(cv)
    if (!fit) return
    const { w, h, ctx } = fit
    ctx.clearRect(0, 0, w, h)
    const env = envOf(deck)
    const dur = deck.duration
    if (deck.isYouTube) {
      // No audio reaches the page for a YouTube stream, so draw a progress bar.
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
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = 'bold 11px Inter, Arial'
      ctx.fillText(dur ? 'YOUTUBE STREAM' : 'Loading from YouTube…', 4, 9)
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
    const live = !deck.analysis
    if (!cache.current || cache.current.key !== key || cache.current.w !== w || live) {
      const img = cache.current?.img ?? document.createElement('canvas')
      const dpr = window.devicePixelRatio || 1
      img.width = Math.round(w * dpr)
      img.height = Math.round(h * dpr)
      const g = img.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const frames = env.amp.length
      const mid = h / 2
      for (let x = 0; x < w; x++) {
        const f0 = Math.floor((x / w) * frames)
        const f1 = Math.max(f0 + 1, Math.floor(((x + 1) / w) * frames))
        let a = 0, l = 0
        for (let f = f0; f < f1 && f < frames; f++) {
          if (env.amp[f] > a) a = env.amp[f]
          if (env.low && env.low[f] > l) l = env.low[f]
        }
        const ah = a * (h / 2 - 1)
        g.fillStyle = col.hi
        g.fillRect(x, mid - ah, 1, ah * 2)
        if (env.low) {
          const lh = l * a * (h / 2 - 1)
          g.fillStyle = col.lo
          g.fillRect(x, mid - lh, 1, lh * 2)
        }
      }
      cache.current = { key, w, img }
    }
    ctx.drawImage(cache.current.img, 0, 0, w, h)

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
  })

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

export function ZoomWave({ decks }: { decks: Deck[] }) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  useRaf(() => {
    const cv = cvRef.current
    if (!cv) return
    const fit = fitCanvas(cv)
    if (!fit) return
    const { w, h, ctx } = fit
    ctx.clearRect(0, 0, w, h)
    const lane = h / decks.length
    const center = w / 2

    decks.forEach((deck, i) => {
      const top = i * lane
      const mid = top + lane / 2
      const env = envOf(deck)
      const col = DECK_COLORS[deck.id]
      // Track-seconds per pixel: a faster deck scrolls faster, so two synced
      // decks show beat lines at the same spacing.
      const spp = (ZOOM_SECONDS * deck.rate) / w
      const t0 = deck.time - center * spp

      if (env && deck.track) {
        for (let x = 0; x < w; x++) {
          const ta = t0 + x * spp
          const f0 = Math.floor(ta * ENV_RATE)
          const f1 = Math.max(f0 + 1, Math.floor((ta + spp) * ENV_RATE))
          let a = 0, l = 0
          for (let f = f0; f < f1; f++) {
            if (f < 0 || f >= env.amp.length) continue
            if (env.amp[f] > a) a = env.amp[f]
            if (env.low && env.low[f] > l) l = env.low[f]
          }
          if (!a) continue
          const ah = a * (lane / 2 - 2)
          ctx.globalAlpha = x < center ? 0.55 : 1
          ctx.fillStyle = col.hi
          ctx.fillRect(x, mid - ah, 1, ah * 2)
          if (env.low) {
            const lh = l * a * (lane / 2 - 2)
            ctx.fillStyle = col.lo
            ctx.fillRect(x, mid - lh, 1, lh * 2)
          }
        }
        ctx.globalAlpha = 1
      }

      // Beat grid
      if (deck.analysis?.bpm) {
        const bl = deck.beatLen
        const first = deck.firstBeat
        let n = Math.ceil((t0 - first) / bl)
        for (let t = first + n * bl; t < t0 + w * spp; t += bl, n++) {
          const x = (t - t0) / spp
          const bar = ((n % 4) + 4) % 4 === 0
          ctx.fillStyle = bar ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.28)'
          ctx.fillRect(x, top + 1, bar ? 1.5 : 1, bar ? 6 : 4)
          ctx.fillRect(x, top + lane - (bar ? 7 : 5), bar ? 1.5 : 1, bar ? 6 : 4)
        }
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
      ctx.fillText(deck.id, 4, top + 11)
    })

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(center - 1, 0, 2, h)
    ctx.beginPath()
    ctx.moveTo(center - 5, 0); ctx.lineTo(center + 5, 0); ctx.lineTo(center, 6)
    ctx.moveTo(center - 5, h); ctx.lineTo(center + 5, h); ctx.lineTo(center, h - 6)
    ctx.fill()
  })

  return <canvas ref={cvRef} className="dj-zoomwave" />
}
