import React, { useRef, useEffect } from 'react'
import { Holiday } from '../../services/holidayService'

// Ambient holiday particles behind the homepage content. Canvas rather than
// DOM nodes so a few dozen glyphs cost almost nothing, and it sits behind
// everything with pointer-events off so it can never intercept a click.

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rot: number
  vrot: number
  alpha: number
  glyph: string
}

const COUNT = 26

export default function HolidayLayer({ holiday }: { holiday: Holiday }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let W = 0, H = 0
    let parts: Particle[] = []

    const spawn = (initial: boolean): Particle => {
      const glyph = holiday.particles[Math.floor(Math.random() * holiday.particles.length)]
      const size = 14 + Math.random() * 18
      const base: Particle = {
        x: Math.random() * W,
        y: initial ? Math.random() * H : -size,
        vx: (Math.random() - 0.5) * 0.25,
        vy: 0.18 + Math.random() * 0.35,
        size,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.006,
        alpha: 0.20 + Math.random() * 0.35,
        glyph,
      }
      switch (holiday.motion) {
        case 'rise':
          base.y = initial ? Math.random() * H : H + size
          base.vy = -(0.20 + Math.random() * 0.30)
          break
        case 'drift':
          base.vx = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.3)
          base.vy = (Math.random() - 0.5) * 0.22
          base.y = Math.random() * H
          base.x = initial ? Math.random() * W : (base.vx > 0 ? -size : W + size)
          break
        case 'burst':
          base.vy = -(0.10 + Math.random() * 0.5)
          base.vx = (Math.random() - 0.5) * 0.7
          base.y = initial ? Math.random() * H : H + size
          break
        // 'fall' uses the defaults
      }
      return base
    }

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      W = r.width; H = r.height
      canvas.width = Math.max(1, Math.round(W * dpr))
      canvas.height = Math.max(1, Math.round(H * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!parts.length) parts = Array.from({ length: COUNT }, () => spawn(true))
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        if (!reduce) {
          p.x += p.vx
          p.y += p.vy
          p.rot += p.vrot
          // Recycle once fully out of frame
          const out =
            p.y > H + p.size * 2 || p.y < -p.size * 2 ||
            p.x > W + p.size * 2 || p.x < -p.size * 2
          if (out) { parts[i] = spawn(false); continue }
        }
        ctx.save()
        ctx.globalAlpha = p.alpha
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.font = `${p.size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(p.glyph, 0, 0)
        ctx.restore()
      }
      rafRef.current = requestAnimationFrame(draw)
    }

    // A static frame is enough when the user prefers reduced motion
    if (reduce) draw()
    else rafRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [holiday])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%', zIndex: 0 }}
    />
  )
}
