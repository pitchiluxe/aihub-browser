import React, { useEffect, useRef, useState } from 'react'
import { BALL_R, canPlaceCue, choosePoolShot, cueBall, groupOf, newPool, placeCue, POCKET_R, POCKETS, shoot, stepPool, TABLE_H, TABLE_W, type PoolState } from '../../../../shared/games/pool'
import { GameButton, GameResult, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './tabletop.css'

const COLORS = ['#f6f2e8', '#f2c230', '#2c62c8', '#d8342c', '#6a3aa8', '#ef7d22', '#1f8a4c', '#8a2a2a', '#151515']
const colorOf = (id: number) => COLORS[id === 8 ? 8 : id > 8 ? id - 8 : id]
const RAIL = 46, CHARGE_MS = 1300

function drawTable(ctx: CanvasRenderingContext2D, state: PoolState, aim: { angle: number; power: number } | null, place: [number, number] | null) {
  const w = TABLE_W + RAIL * 2, h = TABLE_H + RAIL * 2
  ctx.clearRect(0, 0, w, h)
  // Wooden rails, cushions and felt under a hanging lamp.
  const wood = ctx.createLinearGradient(0, 0, 0, h); wood.addColorStop(0, '#6b3f22'); wood.addColorStop(.5, '#4a2a16'); wood.addColorStop(1, '#3a200f')
  ctx.fillStyle = wood; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 26); ctx.fill()
  ctx.save(); ctx.translate(RAIL, RAIL)
  ctx.fillStyle = '#17633f'; ctx.fillRect(-14, -14, TABLE_W + 28, TABLE_H + 28)
  const felt = ctx.createRadialGradient(TABLE_W / 2, TABLE_H / 2, 40, TABLE_W / 2, TABLE_H / 2, TABLE_W * .62); felt.addColorStop(0, '#2fa36a'); felt.addColorStop(1, '#16683f')
  ctx.fillStyle = felt; ctx.fillRect(0, 0, TABLE_W, TABLE_H)
  ctx.strokeStyle = '#ffffff22'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(TABLE_W * .25, 0); ctx.lineTo(TABLE_W * .25, TABLE_H); ctx.stroke(); ctx.setLineDash([])
  ctx.fillStyle = '#ffffff55'; [[TABLE_W * .25, TABLE_H / 2], [TABLE_W * .72, TABLE_H / 2]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill() })
  for (const [x, y] of POCKETS) { const g = ctx.createRadialGradient(x, y, 2, x, y, POCKET_R + 4); g.addColorStop(0, '#000'); g.addColorStop(.8, '#0b0b0b'); g.addColorStop(1, '#3a200f'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, POCKET_R + 3, 0, Math.PI * 2); ctx.fill() }
  ctx.fillStyle = '#f2e3c2'; for (let i = 1; i < 8; i++) if (i !== 4) [[TABLE_W * i / 8, -RAIL / 2 - 2], [TABLE_W * i / 8, TABLE_H + RAIL / 2 + 2]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill() })
  const cue = cueBall(state)
  if (aim && !cue.sunk) {
    // Guide line to the first ball it would meet, with a ghost ball there.
    const dx = Math.cos(aim.angle), dy = Math.sin(aim.angle)
    let t = 900
    for (const ball of state.balls) {
      if (ball.sunk || ball.id === 0) continue
      const bx = ball.x - cue.x, by = ball.y - cue.y, along = bx * dx + by * dy, off = Math.abs(bx * dy - by * dx)
      if (along > 0 && off < BALL_R * 2) t = Math.min(t, along - Math.sqrt(BALL_R * BALL_R * 4 - off * off))
    }
    ctx.strokeStyle = '#ffffff70'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(cue.x, cue.y); ctx.lineTo(cue.x + dx * t, cue.y + dy * t); ctx.stroke(); ctx.setLineDash([])
    if (t < 900) { ctx.strokeStyle = '#ffffffa0'; ctx.beginPath(); ctx.arc(cue.x + dx * t, cue.y + dy * t, BALL_R, 0, Math.PI * 2); ctx.stroke() }
  }
  for (const ball of state.balls) {
    if (ball.sunk) continue
    ctx.fillStyle = '#00000055'; ctx.beginPath(); ctx.ellipse(ball.x + 3, ball.y + 4, BALL_R, BALL_R * .9, 0, 0, Math.PI * 2); ctx.fill()
    const base = colorOf(ball.id), stripe = ball.id > 8
    ctx.save(); ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); ctx.clip()
    ctx.fillStyle = stripe ? '#f6f2e8' : base; ctx.fillRect(ball.x - BALL_R, ball.y - BALL_R, BALL_R * 2, BALL_R * 2)
    if (stripe) { ctx.fillStyle = base; ctx.fillRect(ball.x - BALL_R, ball.y - BALL_R * .55, BALL_R * 2, BALL_R * 1.1) }
    if (ball.id) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R * .48, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#111'; ctx.font = `bold ${BALL_R * .62}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(ball.id), ball.x, ball.y + .5) }
    const shine = ctx.createRadialGradient(ball.x - BALL_R * .4, ball.y - BALL_R * .45, 1, ball.x, ball.y, BALL_R * 1.1); shine.addColorStop(0, '#ffffffcc'); shine.addColorStop(.25, '#ffffff22'); shine.addColorStop(1, '#00000066')
    ctx.fillStyle = shine; ctx.fillRect(ball.x - BALL_R, ball.y - BALL_R, BALL_R * 2, BALL_R * 2); ctx.restore()
  }
  if (aim && !cue.sunk) {
    // The cue stick, pulled back by the power being built.
    const back = 18 + aim.power * 90, dx = Math.cos(aim.angle), dy = Math.sin(aim.angle)
    const sx = cue.x - dx * (BALL_R + back), sy = cue.y - dy * (BALL_R + back), ex = sx - dx * 380, ey = sy - dy * 380
    const stick = ctx.createLinearGradient(sx, sy, ex, ey); stick.addColorStop(0, '#f0e6d2'); stick.addColorStop(.03, '#3a6ab0'); stick.addColorStop(.06, '#e8c98f'); stick.addColorStop(.7, '#a36a32'); stick.addColorStop(1, '#2a160a')
    ctx.strokeStyle = stick; ctx.lineCap = 'round'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
  }
  if (place) { ctx.strokeStyle = canPlaceCue(state, ...place) ? '#ffffffcc' : '#ff6b6bcc'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(place[0], place[1], BALL_R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
  ctx.restore()
}

export default function PoolGame({ paused, onFinish }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null), stateRef = useRef<PoolState>(newPool()), [view, setView] = useState(stateRef.current)
  const aim = useRef({ angle: 0, power: 0 }), charging = useRef<number | null>(null), pointer = useRef<[number, number] | null>(null), reported = useRef(false)
  const human = !view.bot[view.current] && view.phase === 'aim'
  const sync = () => setView({ ...stateRef.current })
  useEffect(() => {
    let frame = 0, last = performance.now(), lastHit = 0
    const loop = (now: number) => {
      const dt = Math.min(0.034, (now - last) / 1000); last = now
      const state = stateRef.current
      if (!paused && state.phase === 'rolling') {
        const events = stepPool(state, dt)
        const hardest = Math.max(0, ...events.hits)
        if (hardest > 60 && now - lastHit > 45) { playSound('clack'); lastHit = now }
        if (events.pockets) playSound('pocket')
        if (state.phase !== 'rolling') sync()
      }
      if (charging.current !== null) aim.current.power = Math.min(1, (now - charging.current) / CHARGE_MS)
      const ctx = canvas.current?.getContext('2d')
      const showAim = state.phase === 'aim' && !state.bot[state.current] && !state.ballInHand
      if (ctx) drawTable(ctx, state, showAim || charging.current !== null ? aim.current : null, state.phase === 'aim' && state.ballInHand && !state.bot[state.current] ? pointer.current : null)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [paused])
  // The computer lines up, pauses as if thinking, then strikes.
  useEffect(() => {
    if (paused || view.phase !== 'aim' || !view.bot[view.current]) return
    const choice = choosePoolShot(stateRef.current)
    const timer = setTimeout(() => {
      if (choice.place) stateRef.current = placeCue(stateRef.current, ...choice.place)
      aim.current = { angle: choice.angle, power: choice.power }; sync()
      setTimeout(() => { playSound('clack'); stateRef.current = shoot(stateRef.current, choice.angle, choice.power); sync() }, 650)
    }, 700)
    return () => clearTimeout(timer)
  }, [paused, view.phase, view.current, view.shots])
  useEffect(() => {
    if (view.phase !== 'over' || reported.current) return
    reported.current = true
    const won = !view.bot[view.winner!]
    playSound(won ? 'win' : 'lose')
    if (won && view.bot.some(Boolean)) onFinish(Math.max(100, 1500 - view.shots * 20))
  }, [view.phase])
  const tablePoint = (event: React.PointerEvent): [number, number] => {
    const box = canvas.current!.getBoundingClientRect(), scale = (TABLE_W + RAIL * 2) / box.width
    return [(event.clientX - box.left) * scale - RAIL, (event.clientY - box.top) * scale - RAIL]
  }
  const move = (event: React.PointerEvent) => {
    const point = tablePoint(event); pointer.current = point
    if (!human || charging.current !== null) return
    const cue = cueBall(stateRef.current); aim.current.angle = Math.atan2(point[1] - cue.y, point[0] - cue.x)
  }
  const down = (event: React.PointerEvent) => {
    if (paused || !human) return
    const point = tablePoint(event)
    if (stateRef.current.ballInHand) { const next = placeCue(stateRef.current, ...point); if (next === stateRef.current) playSound('error'); else { stateRef.current = { ...next, ballInHand: false }; playSound('knock'); sync() } return }
    canvas.current!.setPointerCapture(event.pointerId); charging.current = performance.now()
  }
  const up = () => {
    if (charging.current === null) return
    const power = aim.current.power; charging.current = null; aim.current.power = 0
    if (power < 0.04 || paused) return
    playSound('clack'); stateRef.current = shoot(stateRef.current, aim.current.angle, power); sync()
  }
  const restart = (vsComputer: boolean) => { stateRef.current = newPool(vsComputer); reported.current = false; sync() }
  const groupText = (player: 0 | 1) => view.groups[player] ? `${view.groups[player]} · ${view.balls.filter(ball => !ball.sunk && groupOf(ball.id) === view.groups[player]).length} left` : 'open table'
  return <div className="gr-pool-layout">
    <div className="gr-pool-lamp" aria-hidden="true" />
    <canvas ref={canvas} className={`gr-pool-table ${human ? 'is-aiming' : ''}`} width={TABLE_W + RAIL * 2} height={TABLE_H + RAIL * 2} role="img" aria-label="Pool table" data-testid="pool-table" onPointerMove={move} onPointerDown={down} onPointerUp={up} onPointerCancel={up} />
    <div className="gr-pool-bar">
      {view.names.map((name, at) => <div key={at} className={`gr-pool-player ${view.current === at ? 'current' : ''}`}><strong>{name}</strong><small>{groupText(at as 0 | 1)}</small><span className="gr-pool-rack">{view.balls.filter(ball => ball.sunk && view.groups[at] && groupOf(ball.id) === view.groups[at]).map(ball => <i key={ball.id} style={{ background: colorOf(ball.id) }} />)}</span></div>)}
      <p aria-live="polite">{view.phase === 'rolling' ? 'Balls rolling…' : view.message}</p>
      <div className="gr-circuit-actions"><GameButton onClick={() => restart(true)}>You vs computer</GameButton><GameButton onClick={() => restart(false)}>2 players</GameButton></div>
    </div>
    {view.phase === 'over' && <GameResult title={`${view.names[view.winner!]} ${view.names[view.winner!] === 'You' ? 'win' : 'wins'}`} text={view.message} />}
  </div>
}
