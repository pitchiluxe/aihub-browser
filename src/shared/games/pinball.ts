// Safari Rumble, an original pinball table on a 400 × 700 playfield (y grows
// toward the player). The state is mutable and stepped in small substeps.
export const PB_W = 400, PB_H = 700, PB_BALL = 9
const GRAVITY = 820, WALL_BOUNCE = 0.45, FLIPPER_LEN = 62, FLIPPER_SPEED = 26
export interface Segment { ax: number; ay: number; bx: number; by: number; kick?: number; score?: number; kind?: 'sling' }
export interface Bumper { x: number; y: number; r: number; score: number; flash: number }
export interface Target { x: number; y: number; w: number; down: boolean }
export interface Lane { x: number; y: number; lit: boolean }
export interface Flipper { px: number; py: number; side: 'left' | 'right'; angle: number; speed: number; up: boolean }
export interface PinballState {
  ball: { x: number; y: number; vx: number; vy: number; inLane: boolean } ; balls: number; score: number; multiplier: number
  flippers: [Flipper, Flipper]; bumpers: Bumper[]; targets: Target[]; lanes: Lane[]; plunger: number; over: boolean; message: string; events: string[]
}
const REST = 0.52, LIFT = -0.5
export const WALLS: Segment[] = [
  // Outer cabinet with a rounded top.
  { ax: 20, ay: 700, bx: 20, by: 150 }, { ax: 20, ay: 150, bx: 50, by: 80 }, { ax: 50, ay: 80, bx: 110, by: 34 }, { ax: 110, ay: 34, bx: 200, by: 18 }, { ax: 200, ay: 18, bx: 290, by: 34 },
  { ax: 290, ay: 34, bx: 350, by: 70 }, { ax: 350, ay: 70, bx: 380, by: 130 }, { ax: 380, ay: 130, bx: 380, by: 700 },
  // Shooter lane wall, and the deflector that steers a launch into the field.
  { ax: 350, ay: 700, bx: 350, by: 190 }, { ax: 362, ay: 92, bx: 380, by: 120 },
  // Inlanes feeding the flippers.
  { ax: 20, ay: 520, bx: 112, by: 602 }, { ax: 350, ay: 520, bx: 256, by: 602 },
  { ax: 46, ay: 430, bx: 46, by: 515 }, { ax: 324, ay: 430, bx: 324, by: 515 },
  // Slingshots above the flippers.
  { ax: 76, ay: 455, bx: 112, by: 540, kick: 520, score: 10, kind: 'sling' }, { ax: 294, ay: 455, bx: 258, by: 540, kick: 520, score: 10, kind: 'sling' },
  { ax: 76, ay: 455, bx: 76, by: 520 }, { ax: 294, ay: 455, bx: 294, by: 520 },
  // Lane guides at the top.
  { ax: 160, ay: 60, bx: 160, by: 100 }, { ax: 210, ay: 56, bx: 210, by: 96 }, { ax: 260, ay: 60, bx: 260, by: 100 },
]
export function newPinball(): PinballState {
  return {
    ball: { x: 365, y: 660, vx: 0, vy: 0, inLane: true }, balls: 3, score: 0, multiplier: 1,
    flippers: [{ px: 112, py: 606, side: 'left', angle: REST, speed: 0, up: false }, { px: 256, py: 606, side: 'right', angle: Math.PI - REST, speed: 0, up: false }],
    bumpers: [{ x: 140, y: 190, r: 24, score: 100, flash: 0 }, { x: 230, y: 165, r: 24, score: 100, flash: 0 }, { x: 205, y: 255, r: 24, score: 100, flash: 0 }],
    targets: [0, 1, 2, 3].map(i => ({ x: 92 + i * 30, y: 340, w: 24, down: false })),
    lanes: [135, 185, 235, 285].map(x => ({ x, y: 78, lit: false })), plunger: 0, over: false, message: 'Hold Space (or the launch button) to pull the plunger, release to launch.', events: [],
  }
}
const tipOf = (flipper: Flipper) => ({ x: flipper.px + Math.cos(flipper.angle) * FLIPPER_LEN, y: flipper.py + Math.sin(flipper.angle) * FLIPPER_LEN })
export const flipperTip = tipOf
function collideSegment(state: PinballState, segment: Segment, radius: number, bounce: number, surface?: (x: number, y: number) => { vx: number; vy: number }): boolean {
  const ball = state.ball, dx = segment.bx - segment.ax, dy = segment.by - segment.ay, length2 = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((ball.x - segment.ax) * dx + (ball.y - segment.ay) * dy) / length2))
  const cx = segment.ax + t * dx, cy = segment.ay + t * dy, ox = ball.x - cx, oy = ball.y - cy, distance = Math.hypot(ox, oy)
  if (distance >= radius || distance === 0) return false
  const nx = ox / distance, ny = oy / distance
  ball.x = cx + nx * radius; ball.y = cy + ny * radius
  const move = surface?.(cx, cy) ?? { vx: 0, vy: 0 }
  const rvx = ball.vx - move.vx, rvy = ball.vy - move.vy, along = rvx * nx + rvy * ny
  if (along < 0) { ball.vx -= (1 + bounce) * along * nx; ball.vy -= (1 + bounce) * along * ny }
  if (segment.kick) { ball.vx += nx * segment.kick; ball.vy += ny * segment.kick }
  return true
}
export function setFlipper(state: PinballState, side: 'left' | 'right', up: boolean) { state.flippers[side === 'left' ? 0 : 1].up = up }
export function launch(state: PinballState, power: number) {
  if (!state.ball.inLane || state.over) return
  state.ball.vy = -(700 + Math.max(0, Math.min(1, power)) * 900); state.ball.inLane = false; state.message = ''
}
/** Advances the table; returns the sounds that happened (bumper, sling, flipper, drain…). */
export function stepPinball(state: PinballState, dt: number): string[] {
  const events: string[] = []
  if (state.over) return events
  const steps = Math.ceil(dt / 0.0015), h = dt / steps
  for (let s = 0; s < steps; s++) {
    for (const flipper of state.flippers) {
      const rest = flipper.side === 'left' ? REST : Math.PI - REST, lift = flipper.side === 'left' ? LIFT : Math.PI - LIFT
      const target = flipper.up ? lift : rest, before = flipper.angle
      const delta = target - flipper.angle, stepAngle = FLIPPER_SPEED * h
      flipper.angle = Math.abs(delta) < stepAngle ? target : flipper.angle + Math.sign(delta) * stepAngle
      flipper.speed = (flipper.angle - before) / h
    }
    const ball = state.ball
    if (ball.inLane && ball.vy === 0) { ball.x = 365; ball.y = 660 - state.plunger * 40; continue }
    ball.vy += GRAVITY * h; ball.x += ball.vx * h; ball.y += ball.vy * h
    const speed = Math.hypot(ball.vx, ball.vy); if (speed > 2200) { ball.vx *= 2200 / speed; ball.vy *= 2200 / speed }
    for (const wall of WALLS) if (collideSegment(state, wall, PB_BALL + 2, wall.kick ? 0.2 : WALL_BOUNCE) && wall.score) { state.score += wall.score * state.multiplier; events.push('sling') }
    for (const flipper of state.flippers) {
      const tip = tipOf(flipper)
      collideSegment(state, { ax: flipper.px, ay: flipper.py, bx: tip.x, by: tip.y }, PB_BALL + 6, 0.35, (x, y) => ({ vx: -(y - flipper.py) * flipper.speed, vy: (x - flipper.px) * flipper.speed }))
    }
    for (const bumper of state.bumpers) {
      const dx = ball.x - bumper.x, dy = ball.y - bumper.y, distance = Math.hypot(dx, dy)
      if (distance < bumper.r + PB_BALL && distance > 0) {
        const nx = dx / distance, ny = dy / distance
        ball.x = bumper.x + nx * (bumper.r + PB_BALL); ball.y = bumper.y + ny * (bumper.r + PB_BALL)
        const along = ball.vx * nx + ball.vy * ny
        ball.vx -= 2 * along * nx; ball.vy -= 2 * along * ny; ball.vx += nx * 420; ball.vy += ny * 420
        bumper.flash = 0.18; state.score += bumper.score * state.multiplier; events.push('bumper')
      }
    }
    for (const target of state.targets) {
      if (target.down || Math.abs(ball.y - target.y) > PB_BALL + 4 || ball.x < target.x - PB_BALL || ball.x > target.x + target.w + PB_BALL) continue
      target.down = true; ball.vy = -Math.abs(ball.vy) * 0.6 - 120; state.score += 250 * state.multiplier; events.push('target')
      if (state.targets.every(item => item.down)) { state.score += 2000 * state.multiplier; state.targets.forEach(item => { item.down = false }); state.message = 'Targets cleared! +2000'; events.push('bonus') }
    }
    for (const lane of state.lanes) {
      if (lane.lit || Math.abs(ball.x - lane.x) > 12 || Math.abs(ball.y - lane.y) > 12) continue
      lane.lit = true; state.score += 50 * state.multiplier; events.push('lane')
      if (state.lanes.every(item => item.lit)) { state.multiplier = Math.min(5, state.multiplier + 1); state.lanes.forEach(item => { item.lit = false }); state.message = `Multiplier ×${state.multiplier}!`; events.push('bonus') }
    }
    // A weak launch rolls back down the shooter lane and waits for another try.
    if (ball.x > 352 && ball.y > 655 && ball.vy > 0) { state.ball = { x: 365, y: 660, vx: 0, vy: 0, inLane: true }; continue }
    if (ball.y > PB_H + 20) {
      state.balls--; events.push('drain')
      if (state.balls <= 0) { state.over = true; state.message = `Game over — ${state.score.toLocaleString()} points.`; return events }
      state.ball = { x: 365, y: 660, vx: 0, vy: 0, inLane: true }; state.multiplier = 1; state.message = `Ball lost. ${state.balls} left — launch again.`
    }
  }
  for (const bumper of state.bumpers) bumper.flash = Math.max(0, bumper.flash - dt)
  return events
}
