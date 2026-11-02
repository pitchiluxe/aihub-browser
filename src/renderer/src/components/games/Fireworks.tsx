import React, { useEffect, useRef } from 'react'
import { playSound } from './sounds'

/** A celebration over the whole game surface: rockets climb from the bottom
 *  edge, burst into coloured sparks that fall, fade and twinkle, then the
 *  canvas clears itself. It never takes clicks, so the game stays usable. */
const PALETTE = ['#ff5f6d', '#ffd166', '#3fc1ff', '#7cf29a', '#c792ff', '#ff9f43', '#ffffff']
interface Rocket { x: number; y: number; vy: number; tx: number; ty: number; color: string }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; decay: number; color: string; size: number; twinkle: boolean }

export default function Fireworks({ duration = 5200, title, onDone }: { duration?: number; title?: string; onDone?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const scale = window.devicePixelRatio || 1, gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const resize = () => { const box = el.parentElement!.getBoundingClientRect(); el.width = box.width * scale; el.height = box.height * scale }
    resize()
    const rockets: Rocket[] = [], sparks: Spark[] = [], started = performance.now()
    let nextLaunch = 0, frame = 0, last = started
    const launch = () => {
      const w = el.width, h = el.height
      rockets.push({ x: w * (0.15 + Math.random() * 0.7), y: h, vy: -(h * (0.011 + Math.random() * 0.004)), tx: 0, ty: h * (0.12 + Math.random() * 0.3), color: PALETTE[Math.floor(Math.random() * PALETTE.length)] })
      playSound('launch')
    }
    const burst = (rocket: Rocket) => {
      const count = gentle ? 40 : 90 + Math.floor(Math.random() * 50), speed = el.width * (0.004 + Math.random() * 0.003), ring = Math.random() < 0.3
      const second = Math.random() < 0.45 ? PALETTE[Math.floor(Math.random() * PALETTE.length)] : rocket.color
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.2, v = speed * (ring ? 1 : 0.35 + Math.random() * 0.75)
        sparks.push({ x: rocket.x, y: rocket.y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, life: 1, decay: 0.008 + Math.random() * 0.01, color: i % 3 ? rocket.color : second, size: (1.4 + Math.random() * 1.6) * scale, twinkle: Math.random() < 0.35 })
      }
      // A white flash at the heart of the burst.
      sparks.push({ x: rocket.x, y: rocket.y, vx: 0, vy: 0, life: 1, decay: 0.08, color: '#fff', size: 26 * scale, twinkle: false })
      playSound('burst')
    }
    const draw = (now: number) => {
      const step = Math.min(3, (now - last) / 16.7); last = now
      const elapsed = now - started
      if (elapsed < duration - 1400 && now >= nextLaunch) { launch(); if (!gentle && Math.random() < 0.35) launch(); nextLaunch = now + (gentle ? 900 : 380 + Math.random() * 420) }
      // Fade the previous frame instead of clearing it, which leaves trails.
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, 0, el.width, el.height)
      ctx.globalCompositeOperation = 'lighter'
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]
        r.y += r.vy * step; r.vy *= 0.985 ** step; r.x += Math.sin(now / 90 + i) * 0.4 * scale
        ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(r.x, r.y, 2.4 * scale, 0, Math.PI * 2); ctx.fill()
        sparks.push({ x: r.x, y: r.y, vx: (Math.random() - 0.5) * scale, vy: scale, life: 0.5, decay: 0.05, color: '#ffd9a0', size: 1.2 * scale, twinkle: false })
        if (r.y <= r.ty || r.vy > -1) { burst(r); rockets.splice(i, 1) }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.x += s.vx * step; s.y += s.vy * step; s.vx *= 0.975 ** step; s.vy = s.vy * 0.975 ** step + 0.045 * scale * step; s.life -= s.decay * step
        if (s.life <= 0) { sparks.splice(i, 1); continue }
        ctx.globalAlpha = s.twinkle && Math.random() < 0.3 ? 0.2 : Math.min(1, s.life * 1.4)
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (s.size > 10 * scale ? s.life : 1), 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
      if (elapsed < duration || sparks.length || rockets.length) frame = requestAnimationFrame(draw)
      else { ctx.clearRect(0, 0, el.width, el.height); onDone?.() }
    }
    frame = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize) }
  }, [])
  return <div className="gr-fireworks" data-testid="fireworks">
    <canvas ref={canvas} aria-hidden="true" />
    {title && <strong role="status">{title}</strong>}
  </div>
}
