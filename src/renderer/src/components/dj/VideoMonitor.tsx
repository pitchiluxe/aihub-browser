/**
 * Video monitor: the decks' pictures, mixed the way the audio is mixed —
 * the crossfader blends deck A's picture into deck B's. YouTube songs and
 * local music videos show their video; audio-only songs show their artwork,
 * drifting slowly, and everything pulses on the beat.
 */
import React, { useEffect, useRef } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { Deck, DjEngine } from './engine/DjEngine'
import { useRaf } from './controls'

const images = new Map<string, HTMLImageElement>()
function imageFor(src: string): HTMLImageElement | null {
  let img = images.get(src)
  if (!img) {
    img = new Image()
    img.src = src
    images.set(src, img)
    if (images.size > 40) images.delete(images.keys().next().value as string)
  }
  return img.complete && img.naturalWidth ? img : null
}

/** Draw `src` to cover the w×h box, like CSS object-fit: cover. */
function cover(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, w: number, h: number, zoom = 1, dx = 0) {
  const k = Math.max(w / sw, h / sh) * zoom
  const dw = sw * k
  const dh = sh * k
  g.drawImage(src, (w - dw) / 2 + dx, (h - dh) / 2, dw, dh)
}

export default function VideoMonitor({ engine, big, onToggleBig }: { engine: DjEngine; big?: boolean; onToggleBig?: () => void }) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const { A, B } = engine.decks

  // While the monitor is on screen, YouTube decks send pictures as well as sound.
  useEffect(() => {
    A.retainVideo()
    B.retainVideo()
    return () => { A.releaseVideo(); B.releaseVideo() }
  }, [A, B])

  useRaf(() => {
    const cv = cvRef.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const w = cv.clientWidth
    const h = cv.clientHeight
    if (!w || !h) return
    const rect = cv.getBoundingClientRect()
    const k = (window.devicePixelRatio || 1) * (rect.width / w)
    if (cv.width !== Math.round(w * k) || cv.height !== Math.round(h * k)) { cv.width = Math.round(w * k); cv.height = Math.round(h * k) }
    g.setTransform(k, 0, 0, k, 0, 0)
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)

    // How much of each deck is heard decides how much of it is seen.
    const x = engine.crossfader
    const live = (d: Deck) => !!d.track && (d.active || d.held)
    let wa = live(A) ? 1 - x : 0
    let wb = live(B) ? x : 0
    if (!wa && !wb) { wa = A.track ? 1 : 0; wb = !A.track && B.track ? 1 : 0 }
    const total = wa + wb
    if (!total) { idle(g, w, h); return }

    const now = performance.now() / 1000
    const layer = (d: Deck, alpha: number) => {
      if (alpha <= 0.01) return
      g.globalAlpha = alpha
      const v = d.videoFrame()
      if (v) cover(g, v, v.videoWidth, v.videoHeight, w, h)
      else {
        const img = d.track?.cover ? imageFor(d.track.cover) : null
        if (img) {
          // A slow drift over the artwork, so a still picture still feels alive.
          const drift = Math.sin(now / 9 + (d.id === 'A' ? 0 : 2)) * w * 0.03
          cover(g, img, img.naturalWidth, img.naturalHeight, w, h, 1.12 + Math.sin(now / 13) * 0.04, drift)
        } else {
          const grad = g.createLinearGradient(0, 0, w, h)
          grad.addColorStop(0, d.id === 'A' ? '#0b3d91' : '#7a1f0b')
          grad.addColorStop(1, '#050505')
          g.fillStyle = grad
          g.fillRect(0, 0, w, h)
        }
      }
      g.globalAlpha = 1
    }
    // The fuller deck goes underneath so the blend reads correctly at the ends.
    const [first, second] = wa >= wb ? [[A, wa], [B, wb]] as const : [[B, wb], [A, wa]] as const
    layer(first[0], 1)
    layer(second[0], second[1] / total)

    // Beat pulse on the dominant deck.
    const dom = first[0]
    if (dom.playing && dom.gridKnown) {
      const phase = ((dom.time - dom.firstBeat) / dom.beatLen) % 1
      const p = Math.pow(1 - (phase < 0 ? phase + 1 : phase), 6)
      g.strokeStyle = `rgba(255,255,255,${0.35 * p})`
      g.lineWidth = 3 + 5 * p
      g.strokeRect(0, 0, w, h)
    }

    // Caption: what is on.
    g.fillStyle = 'rgba(0,0,0,0.45)'
    g.fillRect(0, h - 20, w, 20)
    g.font = `600 ${big ? 13 : 10.5}px Inter, Arial`
    g.fillStyle = '#fff'
    const t = dom.track
    if (t) g.fillText(`${dom.id} · ${t.artist ? `${t.artist} – ` : ''}${t.title}`.slice(0, big ? 120 : 48), 6, h - 6)
    if (dom.adPlaying) {
      g.fillStyle = '#facc15'
      g.fillText('AD', w - 24, 14)
    }
  })

  return (
    <div className={`dj-video ${big ? 'dj-video-big' : ''}`}>
      <canvas ref={cvRef} />
      {onToggleBig && (
        <button type="button" className="dj-video-size" onClick={onToggleBig} title={big ? 'Back to the mixer' : 'Big screen'}>
          {big ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      )}
    </div>
  )
}

function idle(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.font = '600 11px Inter, Arial'
  const msg = 'Load a song — YouTube videos and music videos play here'
  g.fillText(msg, Math.max(6, (w - g.measureText(msg).width) / 2), h / 2)
}
