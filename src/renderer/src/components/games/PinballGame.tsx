import React, { useEffect, useRef, useState } from 'react'
import { flipperTip, launch, newPinball, PB_BALL, PB_H, PB_W, setFlipper, stepPinball, WALLS, type PinballState } from '../../../../shared/games/pinball'
import { GameButton, GameResult, GameStats, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './tabletop.css'

const SOUND: Record<string, Parameters<typeof playSound>[0]> = { bumper: 'clack', sling: 'knock', target: 'tile', lane: 'bite', bonus: 'clear', drain: 'buzz' }
const LEFT_KEYS = ['ArrowLeft', 'z', 'Z', 'Shift'], RIGHT_KEYS = ['ArrowRight', 'm', 'M', '/']

// The printed playfield never changes, so it is painted once and reused every frame.
let playfield: HTMLCanvasElement | null = null
const path = (ctx: CanvasRenderingContext2D, points: number[][]) => { ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath() }
function paintPlayfield(): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = PB_W; canvas.height = PB_H
  const ctx = canvas.getContext('2d')!
  const base = ctx.createLinearGradient(0, 0, 0, PB_H); base.addColorStop(0, '#0e5a6b'); base.addColorStop(.3, '#1f8a5a'); base.addColorStop(.55, '#f2a51e'); base.addColorStop(.8, '#e2471f'); base.addColorStop(1, '#a3161c')
  ctx.fillStyle = base; ctx.fillRect(0, 0, PB_W, PB_H)
  // Sunburst rays behind the bumpers.
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, b = (i + .5) / 28 * Math.PI * 2
    ctx.fillStyle = i % 2 ? '#ffffff14' : '#ffd23c26'; path(ctx, [[200, 330], [200 + Math.cos(a) * 520, 330 + Math.sin(a) * 520], [200 + Math.cos(b) * 520, 330 + Math.sin(b) * 520]]); ctx.fill()
  }
  // Jungle leaves along the upper edges.
  for (const [x, y, r, flip] of [[40, 190, 0.6, 1], [55, 330, -0.4, 1], [330, 210, 2.6, -1], [338, 360, 3.4, -1]] as number[][]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.fillStyle = '#2f9b45'; ctx.beginPath(); ctx.ellipse(0, 0, 46, 15, 0, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#1d6b2e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-40 * flip, 0); ctx.lineTo(40 * flip, 0); ctx.stroke(); ctx.restore()
  }
  // The centre arena: a red ring with a white rim, like a printed target.
  ctx.fillStyle = '#c3201f'; ctx.beginPath(); ctx.ellipse(186, 470, 104, 74, 0, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#fff6e0'; ctx.lineWidth = 5; ctx.stroke()
  ctx.fillStyle = '#ffcf3a'; ctx.beginPath(); ctx.ellipse(186, 470, 70, 46, 0, 0, Math.PI * 2); ctx.fill()
  ctx.save(); ctx.translate(186, 474); ctx.rotate(-0.08); ctx.font = 'italic 900 26px Georgia, serif'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#7a1010'; ctx.strokeText('SAFARI', 0, -4); ctx.fillStyle = '#fff'; ctx.fillText('SAFARI', 0, -4); ctx.font = 'italic 900 20px Georgia, serif'; ctx.strokeText('RUMBLE', 0, 18); ctx.fillStyle = '#2f9bd6'; ctx.fillText('RUMBLE', 0, 18); ctx.restore()
  // Inlane and outlane stripes.
  for (const [x, color] of [[30, '#2f9bd6'], [338, '#8a4fd6']] as [number, string][]) { ctx.fillStyle = color; ctx.fillRect(x, 420, 12, 100) }
  // Printed apron below the flippers.
  ctx.fillStyle = '#d12a1f'; path(ctx, [[20, 610], [140, 652], [228, 652], [350, 610], [350, 700], [20, 700]]); ctx.fill()
  ctx.fillStyle = '#ffcf3a'; path(ctx, [[20, 626], [140, 666], [228, 666], [350, 626], [350, 636], [228, 676], [140, 676], [20, 636]]); ctx.fill()
  ctx.fillStyle = '#fffaf0'; ctx.fillRect(30, 650, 74, 40); ctx.fillRect(266, 650, 74, 40)
  ctx.fillStyle = '#2a1a10'; ctx.font = '700 7px system-ui'; ['RAISE MULTIPLIER', 'Light 4 top lanes', '', 'TARGET BONUS', 'Drop all 4 pink'].forEach((line, i) => ctx.fillText(line, 36, 660 + i * 7))
  ;['SLINGS 10', 'BUMPERS 100', 'TARGETS 250', 'LANES 50'].forEach((line, i) => ctx.fillText(line, 272, 662 + i * 8))
  ctx.font = 'italic 900 15px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('SAFARI RUMBLE', 185, 694)
  // Chrome wire ramps sweeping round both sides (decorative).
  const wire = (points: number[]) => { for (const [width, color] of [[11, '#00000055'], [9, '#7e8796'], [6, '#e6ecf4'], [2, '#ffffff']] as [number, string][]) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(points[0], points[1]); ctx.bezierCurveTo(points[2], points[3], points[4], points[5], points[6], points[7]); ctx.stroke() } }
  ctx.lineCap = 'round'
  wire([34, 470, 10, 300, 40, 120, 132, 102]); wire([44, 470, 22, 310, 52, 132, 136, 114])
  wire([336, 470, 368, 320, 360, 150, 268, 104]); wire([326, 470, 354, 320, 346, 160, 262, 116])
  // Guide rails: dark posts with a chrome edge instead of neon tubes.
  for (const wall of WALLS) {
    if (wall.kind === 'sling') continue
    for (const [width, color] of [[7, '#1b1b22'], [3, '#b8c2d0']] as [number, string][]) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(wall.ax, wall.ay); ctx.lineTo(wall.bx, wall.by); ctx.stroke() }
  }
  // Clear coloured plastics over the slingshots.
  for (const [points, color] of [[[[76, 452], [116, 545], [76, 524]], '#ff4d4dcc'], [[[294, 452], [254, 545], [294, 524]], '#ffcf3acc']] as [number[][], string][]) {
    ctx.fillStyle = color; path(ctx, points); ctx.fill(); ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 2; ctx.stroke()
  }
  return canvas
}
// The table's toy: a friendly cartoon lion on the upper left, swaying a little.
function drawMascot(ctx: CanvasRenderingContext2D, time: number, cheer: boolean) {
  ctx.save(); ctx.translate(82, 290); ctx.rotate(Math.sin(time / 600) * 0.06); ctx.scale(cheer ? 1.08 : 1, cheer ? 1.08 : 1)
  ctx.shadowColor = '#0008'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 6
  for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#c4561c' : '#9c3f12'; ctx.beginPath(); ctx.arc(Math.cos(i / 12 * Math.PI * 2) * 26, Math.sin(i / 12 * Math.PI * 2) * 26, 13, 0, Math.PI * 2); ctx.fill() }
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
  ctx.fillStyle = '#f5b445'; ctx.beginPath(); ctx.arc(0, 2, 24, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#1c1a22'; for (const x of [-9, 9]) { ctx.beginPath(); ctx.arc(x, -2, 3.5, 0, Math.PI * 2); ctx.fill() }
  ctx.fillStyle = '#ffe2a6'; ctx.beginPath(); ctx.ellipse(0, 11, 12, 9, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#5a2c14'; path(ctx, [[-5, 6], [5, 6], [0, 11]]); ctx.fill()
  if (cheer) { ctx.fillStyle = '#7a1010'; ctx.beginPath(); ctx.ellipse(0, 16, 6, 5, 0, 0, Math.PI * 2); ctx.fill() }
  ctx.restore()
}
const LAMP_COLORS = ['#ff3b3b', '#ffcf3a', '#3fd06a', '#2fb0ff', '#b56bff']
function draw(ctx: CanvasRenderingContext2D, state: PinballState, time: number) {
  playfield ||= paintPlayfield()
  ctx.drawImage(playfield, 0, 0)
  ctx.lineCap = 'round'
  // Lit arrow inserts pointing at the top lanes and both orbits; they chase upward.
  const arrows: [number, number, number][] = [[186, 330, 0], [56, 400, -0.25], [316, 400, 0.25]]
  arrows.forEach(([x, y, tilt], a) => { for (let i = 0; i < 3; i++) {
    const lit = Math.floor(time / 180 + a) % 3 === 2 - i
    ctx.save(); ctx.translate(x, y - i * 18); ctx.rotate(tilt); ctx.fillStyle = lit ? LAMP_COLORS[(a + i) % LAMP_COLORS.length] : '#00000040'
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = lit ? 14 : 0; path(ctx, [[0, -9], [12, 6], [-12, 6]]); ctx.fill(); ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore()
  } })
  // A ring of round lamps around the centre arena.
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, lit = (Math.floor(time / 120) + i) % 4 === 0
    ctx.fillStyle = lit ? LAMP_COLORS[i % LAMP_COLORS.length] : '#00000033'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = lit ? 12 : 0
    ctx.beginPath(); ctx.arc(186 + Math.cos(a) * 118, 470 + Math.sin(a) * 86, 5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.shadowBlur = 0
  for (const lane of state.lanes) { ctx.fillStyle = lane.lit ? '#ffe066' : '#00000055'; ctx.shadowColor = '#ffe066'; ctx.shadowBlur = lane.lit ? 16 : 0; ctx.beginPath(); ctx.arc(lane.x, lane.y + 30, 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke() }
  for (const target of state.targets) {
    ctx.shadowBlur = target.down ? 0 : 10; ctx.shadowColor = '#ff5fa8'
    ctx.fillStyle = target.down ? '#5a2030' : '#ff4f9a'; ctx.fillRect(target.x, target.y - 6, target.w, target.down ? 3 : 12)
    if (!target.down) { ctx.fillStyle = '#fff'; ctx.fillRect(target.x + 3, target.y - 4, target.w - 6, 2) }
  }
  ctx.shadowBlur = 0
  for (const wall of WALLS) if (wall.kind === 'sling') { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(wall.ax, wall.ay); ctx.lineTo(wall.bx, wall.by); ctx.stroke() }
  // Mushroom pop bumpers: a red skirt, a white cap and a star that flashes when hit.
  for (const bumper of state.bumpers) {
    const glow = bumper.flash > 0
    ctx.shadowColor = '#000a'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4
    ctx.fillStyle = '#b8141b'; ctx.beginPath(); ctx.arc(bumper.x, bumper.y, bumper.r + 4, 0, Math.PI * 2); ctx.fill()
    ctx.shadowOffsetY = 0; ctx.shadowColor = '#ffe066'; ctx.shadowBlur = glow ? 34 : 0
    const cap = ctx.createRadialGradient(bumper.x - 7, bumper.y - 8, 2, bumper.x, bumper.y, bumper.r); cap.addColorStop(0, '#ffffff'); cap.addColorStop(1, glow ? '#ffe066' : '#d9dde6')
    ctx.fillStyle = cap; ctx.beginPath(); ctx.arc(bumper.x, bumper.y, bumper.r - 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = glow ? '#ff3b3b' : '#ffb000'; ctx.beginPath()
    for (let p = 0; p < 10; p++) { const r = p % 2 ? 5 : 11, a = p / 10 * Math.PI * 2 - Math.PI / 2; ctx.lineTo(bumper.x + Math.cos(a) * r, bumper.y + Math.sin(a) * r) }
    ctx.closePath(); ctx.fill()
  }
  ctx.shadowBlur = 0
  drawMascot(ctx, time, state.bumpers.some(bumper => bumper.flash > 0))
  for (const flipper of state.flippers) {
    const tip = flipperTip(flipper)
    ctx.shadowColor = '#0009'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3
    ctx.strokeStyle = '#c3201f'; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(flipper.px, flipper.py); ctx.lineTo(tip.x, tip.y); ctx.stroke()
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
    ctx.strokeStyle = '#fbfbf6'; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(flipper.px, flipper.py); ctx.lineTo(tip.x, tip.y); ctx.stroke()
    ctx.fillStyle = '#ffcf3a'; ctx.beginPath(); ctx.arc(flipper.px, flipper.py, 4, 0, Math.PI * 2); ctx.fill()
  }
  // The plunger spring pulls back as power builds.
  ctx.fillStyle = '#8a8fa8'; ctx.fillRect(357, 672 + state.plunger * 40, 16, 22)
  const ball = state.ball, shine = ctx.createRadialGradient(ball.x - 3, ball.y - 4, 1, ball.x, ball.y, PB_BALL)
  shine.addColorStop(0, '#ffffff'); shine.addColorStop(.4, '#d4d8e6'); shine.addColorStop(1, '#5b6075')
  ctx.fillStyle = shine; ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(ball.x, ball.y, PB_BALL, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
}

export default function PinballGame({ paused, onFinish }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null), table = useRef<PinballState>(newPinball()), pulling = useRef<number | null>(null)
  const [view, setView] = useState({ score: 0, balls: 3, multiplier: 1, message: table.current.message, over: false }), reported = useRef(false)
  useEffect(() => {
    let frame = 0, last = performance.now(), lastSound = 0
    const loop = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000); last = now
      const state = table.current
      if (pulling.current !== null) state.plunger = Math.min(1, (now - pulling.current) / 900)
      if (!paused) for (const event of stepPinball(state, dt)) if (now - lastSound > 40 || event === 'drain' || event === 'bonus') { playSound(SOUND[event] || 'click'); lastSound = now }
      const ctx = canvas.current?.getContext('2d'); if (ctx) draw(ctx, state, now)
      setView(previous => previous.score === state.score && previous.balls === state.balls && previous.message === state.message && previous.multiplier === state.multiplier && previous.over === state.over ? previous : { score: state.score, balls: state.balls, multiplier: state.multiplier, message: state.message, over: state.over })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [paused])
  const flip = (side: 'left' | 'right', up: boolean) => { if (paused && up) return; setFlipper(table.current, side, up); if (up) playSound('click') }
  const pull = () => { if (!paused && table.current.ball.inLane && pulling.current === null) pulling.current = performance.now() }
  const release = () => { if (pulling.current === null) return; launch(table.current, table.current.plunger); pulling.current = null; table.current.plunger = 0; playSound('clack') }
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey) return
      if (LEFT_KEYS.includes(event.key)) { event.preventDefault(); if (!event.repeat) flip('left', true) }
      else if (RIGHT_KEYS.includes(event.key)) { event.preventDefault(); if (!event.repeat) flip('right', true) }
      else if (event.key === ' ' || event.key === 'ArrowDown') { event.preventDefault(); pull() }
    }
    const up = (event: KeyboardEvent) => {
      if (LEFT_KEYS.includes(event.key)) flip('left', false)
      else if (RIGHT_KEYS.includes(event.key)) flip('right', false)
      else if (event.key === ' ' || event.key === 'ArrowDown') release()
    }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [paused])
  useEffect(() => { if (!view.over || reported.current) return; reported.current = true; playSound('lose'); onFinish(view.score) }, [view.over])
  const hold = (start: () => void, end: () => void) => ({ onPointerDown: (event: React.PointerEvent) => { (event.currentTarget as Element).setPointerCapture(event.pointerId); start() }, onPointerUp: end, onPointerCancel: end })
  return <div className="gr-play-layout gr-pinball-layout">
    <div className="gr-pinball-cabinet"><div className="gr-pinball-backbox"><span>SAFARI RUMBLE</span><b>{view.score.toLocaleString().padStart(7, ' ')}</b></div><canvas ref={canvas} width={PB_W} height={PB_H} className="gr-pinball" role="img" aria-label="Pinball table" data-testid="pinball-table" /></div>
    <aside className="gr-game-aside">
      <GameStats items={[['Score', view.score.toLocaleString()], ['Balls', view.balls], ['Bonus', `×${view.multiplier}`]]} />
      <h3>{view.over ? 'Game over' : 'Keep it alive'}</h3>
      <p>{view.message || 'Light all four top lanes for a bigger multiplier. Knock down every pink target for a 2,000 bonus.'}</p>
      <p>Flippers: ← / Z and → / M. Hold Space to pull the plunger, release to launch.</p>
      <div className="gr-pinball-pad"><button type="button" className="gr-control" {...hold(() => flip('left', true), () => flip('left', false))}>◀ Flip</button><button type="button" className="gr-control" {...hold(pull, release)}>Launch</button><button type="button" className="gr-control" {...hold(() => flip('right', true), () => flip('right', false))}>Flip ▶</button></div>
      <div className="gr-circuit-actions"><GameButton onClick={() => { table.current = newPinball(); reported.current = false }}>New game</GameButton></div>
      {view.over && <GameResult title="Final score" text={`${view.score.toLocaleString()} points.`} />}
    </aside>
  </div>
}
