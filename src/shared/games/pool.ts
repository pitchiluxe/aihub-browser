import type { Random } from './random'
// Eight-ball on a 2:1 table. Units are table pixels; speeds are pixels per second.
export const TABLE_W = 1000, TABLE_H = 500, BALL_R = 12, POCKET_R = 25, MAX_SPEED = 1900
export const POCKETS: [number, number][] = [[0, 0], [TABLE_W / 2, -6], [TABLE_W, 0], [0, TABLE_H], [TABLE_W / 2, TABLE_H + 6], [TABLE_W, TABLE_H]]
export const HEAD_X = TABLE_W * 0.25
const FRICTION = 0.988, STOP = 6, CUSHION = 0.78
export interface Ball { id: number; x: number; y: number; vx: number; vy: number; sunk: boolean }
export type Group = 'solids' | 'stripes'
export interface PoolState {
  balls: Ball[]; current: 0 | 1; groups: [Group | null, Group | null]; names: [string, string]; bot: [boolean, boolean]
  phase: 'aim' | 'rolling' | 'over'; ballInHand: boolean; winner: 0 | 1 | null; message: string
  shot: { firstHit: number | null; sunk: number[]; cushion: boolean } | null; shots: number
}
export const groupOf = (id: number): Group | 'eight' | 'cue' => id === 0 ? 'cue' : id === 8 ? 'eight' : id < 8 ? 'solids' : 'stripes'
export function newPool(vsComputer = true): PoolState {
  // A legal rack: the 8 in the middle, one solid and one stripe in the back corners.
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 13, 5, 14, 6, 15, 7], balls: Ball[] = [{ id: 0, x: HEAD_X, y: TABLE_H / 2, vx: 0, vy: 0, sunk: false }]
  let n = 0
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) {
    balls.push({ id: order[n++], x: TABLE_W * 0.72 + row * BALL_R * 1.75, y: TABLE_H / 2 + (i - row / 2) * BALL_R * 2.02, vx: 0, vy: 0, sunk: false })
  }
  return { balls, current: 0, groups: [null, null], names: vsComputer ? ['You', 'Computer'] : ['Player 1', 'Player 2'], bot: [false, vsComputer], phase: 'aim', ballInHand: false, winner: null, message: 'Break! Aim with the mouse, hold to build power, release to shoot.', shot: null, shots: 0 }
}
const clone = (state: PoolState): PoolState => ({ ...state, balls: state.balls.map(ball => ({ ...ball })), groups: [...state.groups] as PoolState['groups'], shot: state.shot && { ...state.shot, sunk: [...state.shot.sunk] } })
export const cueBall = (state: PoolState) => state.balls.find(ball => ball.id === 0)!
export function shoot(state: PoolState, angle: number, power: number): PoolState {
  if (state.phase !== 'aim') return state
  const next = clone(state), cue = cueBall(next), speed = Math.max(0.05, Math.min(1, power)) * MAX_SPEED
  cue.vx = Math.cos(angle) * speed; cue.vy = Math.sin(angle) * speed
  next.phase = 'rolling'; next.ballInHand = false; next.shot = { firstHit: null, sunk: [], cushion: false }; next.shots++
  return next
}
export function canPlaceCue(state: PoolState, x: number, y: number): boolean {
  return x > BALL_R && x < TABLE_W - BALL_R && y > BALL_R && y < TABLE_H - BALL_R && state.balls.every(ball => ball.id === 0 || ball.sunk || Math.hypot(ball.x - x, ball.y - y) > BALL_R * 2.05)
}
export function placeCue(state: PoolState, x: number, y: number): PoolState {
  if (!state.ballInHand || state.phase !== 'aim' || !canPlaceCue(state, x, y)) return state
  const next = clone(state), cue = cueBall(next); cue.x = x; cue.y = y; cue.sunk = false
  return next
}
export interface StepEvents { hits: number[]; pockets: number; cushions: number }
/** Advances the balls by `dt` seconds. Returns impact speeds so the table can play sounds. */
export function stepPool(state: PoolState, dt: number): StepEvents {
  const events: StepEvents = { hits: [], pockets: 0, cushions: 0 }
  if (state.phase !== 'rolling' || !state.shot) return events
  const live = state.balls.filter(ball => !ball.sunk), steps = Math.ceil(dt / 0.002), h = dt / steps
  for (let s = 0; s < steps; s++) {
    for (const ball of live) {
      if (ball.sunk) continue
      ball.x += ball.vx * h; ball.y += ball.vy * h
      const pocket = POCKETS.find(([px, py]) => Math.hypot(ball.x - px, ball.y - py) < POCKET_R)
      if (pocket) { ball.sunk = true; ball.vx = ball.vy = 0; state.shot.sunk.push(ball.id); events.pockets++; continue }
      const nearPocket = POCKETS.some(([px, py]) => Math.hypot(ball.x - px, ball.y - py) < POCKET_R + BALL_R * 1.4)
      if (!nearPocket) {
        if (ball.x < BALL_R && ball.vx < 0 || ball.x > TABLE_W - BALL_R && ball.vx > 0) { ball.vx *= -CUSHION; ball.x = Math.min(TABLE_W - BALL_R, Math.max(BALL_R, ball.x)); state.shot.cushion = true; events.cushions++ }
        if (ball.y < BALL_R && ball.vy < 0 || ball.y > TABLE_H - BALL_R && ball.vy > 0) { ball.vy *= -CUSHION; ball.y = Math.min(TABLE_H - BALL_R, Math.max(BALL_R, ball.y)); state.shot.cushion = true; events.cushions++ }
      }
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j]
      if (a.sunk || b.sunk) continue
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy)
      if (distance >= BALL_R * 2 || distance === 0) continue
      const nx = dx / distance, ny = dy / distance, overlap = BALL_R * 2 - distance
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; b.x += nx * overlap / 2; b.y += ny * overlap / 2
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
      if (closing <= 0) continue
      // Equal masses, nearly elastic: swap the velocity along the line of centres.
      const impulse = closing * 0.97
      a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny
      if (state.shot.firstHit === null && (a.id === 0 || b.id === 0)) state.shot.firstHit = a.id === 0 ? b.id : a.id
      events.hits.push(closing)
    }
    const decay = FRICTION ** (h * 60)
    for (const ball of live) { ball.vx *= decay; ball.vy *= decay; if (Math.hypot(ball.vx, ball.vy) < STOP) ball.vx = ball.vy = 0 }
  }
  if (state.balls.every(ball => ball.sunk || (ball.vx === 0 && ball.vy === 0))) resolveShot(state)
  return events
}
const remaining = (state: PoolState, group: Group) => state.balls.filter(ball => !ball.sunk && groupOf(ball.id) === group).length
// Applies the eight-ball rules once every ball has stopped. Mutates the state it is given.
function resolveShot(state: PoolState) {
  const shot = state.shot!, me = state.current, them = (1 - me) as 0 | 1, mine = state.groups[me]
  const cueSunk = shot.sunk.includes(0), eightSunk = shot.sunk.includes(8)
  const objectSunk = shot.sunk.filter(id => id !== 0 && id !== 8)
  const legalTarget = (id: number | null) => id !== null && (mine ? groupOf(id) === mine || (id === 8 && remaining(state, mine) === 0) : id !== 8)
  const foul = cueSunk || !legalTarget(shot.firstHit) || (!objectSunk.length && !eightSunk && !shot.cushion)
  state.phase = 'aim'; state.shot = null
  if (eightSunk) {
    const cleared = !!mine && remaining(state, mine) === 0
    state.winner = cleared && !foul ? me : them; state.phase = 'over'
    state.message = state.winner === me ? `${state.names[me]} sank the 8 ball to win!` : `${state.names[me]} sank the 8 ball too early — ${state.names[them]} win${state.names[them] === 'You' ? '' : 's'}.`
    return
  }
  if (!mine && objectSunk.length && !foul) {
    const first = groupOf(objectSunk[0]) as Group
    state.groups[me] = first; state.groups[them] = first === 'solids' ? 'stripes' : 'solids'
  }
  const owned = state.groups[me]
  const keep = !foul && objectSunk.some(id => !owned || groupOf(id) === owned)
  if (cueSunk) { const cue = cueBall(state); cue.sunk = false; cue.x = HEAD_X; cue.y = TABLE_H / 2; cue.vx = cue.vy = 0 }
  if (foul) {
    state.current = them; state.ballInHand = true
    state.message = `${cueSunk ? 'Scratch' : shot.firstHit === null ? 'No ball hit' : 'Foul'}. ${state.names[them]} ${state.names[them] === 'You' ? 'have' : 'has'} ball in hand — click the table to place the cue ball.`
  } else if (keep) state.message = `${state.names[me]} ${state.names[me] === 'You' ? 'keep' : 'keeps'} shooting${owned ? ` ${owned}` : ''}.`
  else { state.current = them; state.message = `${state.names[them]} to shoot${state.groups[them] ? ` ${state.groups[them]}` : ''}.` }
}
// The computer picks the clearest pot: cut angle, distance and blockers, with a little human error.
function pathClear(state: PoolState, ax: number, ay: number, bx: number, by: number, ignore: number[]): boolean {
  const length = Math.hypot(bx - ax, by - ay)
  return state.balls.every(ball => {
    if (ball.sunk || ignore.includes(ball.id)) return true
    const t = Math.max(0, Math.min(1, ((ball.x - ax) * (bx - ax) + (ball.y - ay) * (by - ay)) / (length * length || 1)))
    return Math.hypot(ax + t * (bx - ax) - ball.x, ay + t * (by - ay) - ball.y) > BALL_R * 2.05
  })
}
export function choosePoolShot(state: PoolState, random: Random = Math.random): { angle: number; power: number; place?: [number, number] } {
  const mine = state.groups[state.current]
  const targets = state.balls.filter(ball => !ball.sunk && ball.id !== 0 && (mine ? groupOf(ball.id) === mine || (ball.id === 8 && remaining(state, mine) === 0) : ball.id !== 8))
  let best: { angle: number; power: number; score: number; place?: [number, number] } | null = null
  for (const ball of targets) for (const [px, py] of POCKETS) {
    const toPocket = Math.hypot(px - ball.x, py - ball.y), ux = (px - ball.x) / toPocket, uy = (py - ball.y) / toPocket
    const ghostX = ball.x - ux * BALL_R * 2, ghostY = ball.y - uy * BALL_R * 2
    let cue = cueBall(state), place: [number, number] | undefined
    if (state.ballInHand) {
      const spot: [number, number] = [ghostX - ux * 160, ghostY - uy * 160]
      if (!canPlaceCue(state, spot[0], spot[1])) continue
      place = spot; cue = { ...cue, x: spot[0], y: spot[1] }
    }
    const toGhost = Math.hypot(ghostX - cue.x, ghostY - cue.y), cut = Math.acos(Math.max(-1, Math.min(1, ((ghostX - cue.x) * ux + (ghostY - cue.y) * uy) / (toGhost || 1))))
    if (cut > 1.25 || !pathClear(state, cue.x, cue.y, ghostX, ghostY, [0, ball.id]) || !pathClear(state, ball.x, ball.y, px, py, [ball.id])) continue
    const score = -cut * 300 - toGhost * 0.35 - toPocket * 0.5
    if (!best || score > best.score) best = { angle: Math.atan2(ghostY - cue.y, ghostX - cue.x), power: Math.min(1, 0.28 + (toGhost + toPocket) / 1500 + cut * 0.15), score, place }
  }
  if (best) return { angle: best.angle + (random() - 0.5) * 0.03, power: best.power, place: best.place }
  // Nothing pots cleanly: roll into the nearest legal ball.
  const cue = cueBall(state), target = targets.sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0] || state.balls.find(ball => ball.id === 8)!
  return { angle: Math.atan2(target.y - cue.y, target.x - cue.x) + (random() - 0.5) * 0.05, power: 0.45 }
}
