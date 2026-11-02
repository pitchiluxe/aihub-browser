import type { Random } from '../random'
import type { FamilyGame, Move } from './core'
const d6 = (random: Random) => 1 + Math.floor(random() * 6)

/* ── Backgammon ──────────────────────────────────────────────────────────
   points[i] > 0: player 0's checkers, < 0: player 1's. Player 0 moves from
   point 23 toward 0 and bears off below 0; player 1 the other way round.
   Move indices: 0–23 points, 24 the bar, 25 off the board. */
export interface BackgammonState { points: number[]; bar: [number, number]; off: [number, number]; dice: number[]; rolled: number[]; turn: number; phase: 'roll' | 'move'; winner: number | null | undefined; last: number[] }
export const BAR = 24, OFF = 25
const sign = (player: number) => player === 0 ? 1 : -1
function single(s: BackgammonState, player: number): Move[] {
  const moves: Move[] = [], dir = player === 0 ? -1 : 1, entry = player === 0 ? 24 : -1
  const open = (i: number) => s.points[i] * sign(player) >= -1
  const home = (i: number) => player === 0 ? i <= 5 : i >= 18
  const allHome = s.bar[player] === 0 && s.points.every((count, i) => !(count * sign(player) > 0) || home(i))
  for (const die of new Set(s.dice)) {
    if (s.bar[player]) { const to = entry + dir * die; if (open(to)) moves.push({ from: BAR, to, die }); continue }
    s.points.forEach((count, from) => {
      if (!(count * sign(player) > 0)) return
      const to = from + dir * die
      if (to >= 0 && to <= 23) { if (open(to)) moves.push({ from, to, die }); return }
      if (!allHome) return
      // Bear off exactly, or with a higher die when no checker sits further back.
      const exact = player === 0 ? to === -1 : to === 24
      const furthest = player === 0 ? !s.points.some((c, i) => i > from && c > 0) : !s.points.some((c, i) => i < from && c < 0)
      if (exact || furthest) moves.push({ from, to: OFF, die })
    })
  }
  return moves
}
function applyOne(s: BackgammonState, move: Move): BackgammonState {
  const next: BackgammonState = { ...s, points: [...s.points], bar: [...s.bar] as [number, number], off: [...s.off] as [number, number], dice: [...s.dice], last: [move.from!, move.to!] }
  const p = s.turn, sg = sign(p)
  next.dice.splice(next.dice.indexOf(move.die as number), 1)
  if (move.from === BAR) next.bar[p]--; else next.points[move.from!] -= sg
  if (move.to === OFF) next.off[p]++
  else { if (next.points[move.to!] === -sg) { next.points[move.to!] = 0; next.bar[1 - p]++ } next.points[move.to!] += sg }
  return next
}
// Players must use as many dice as possible, and the larger die if only one can be played.
function legalBackgammon(s: BackgammonState): Move[] {
  const longest = (state: BackgammonState, depth: number): number => { if (!state.dice.length || depth > 4) return 0; const moves = single(state, state.turn); return moves.length ? 1 + Math.max(...moves.map(m => longest(applyOne(state, m), depth + 1))) : 0 }
  const moves = single(s, s.turn)
  if (!moves.length) return []
  const best = longest(s, 0), allowed = moves.filter(m => 1 + longest(applyOne(s, m), 1) === best)
  if (best === 1 && new Set(s.dice).size > 1) { const top = Math.max(...allowed.map(m => m.die as number)); return allowed.filter(m => m.die === top) }
  return allowed
}
export const BACKGAMMON: FamilyGame<BackgammonState> = {
  id: 'backgammon', title: 'Backgammon', players: 2, names: ['White', 'Red'], colors: ['#f6efe0', '#c3201f'], depth: 2, layout: { kind: 'custom' },
  setup: () => { const points = Array(24).fill(0); points[23] = 2; points[12] = 5; points[7] = 3; points[5] = 5; points[0] = -2; points[11] = -5; points[16] = -3; points[18] = -5; return { points, bar: [0, 0], off: [0, 0], dice: [], rolled: [], turn: 0, phase: 'roll', winner: undefined, last: [] } },
  current: s => s.turn,
  moves: s => s.winner !== undefined ? [] : s.phase === 'roll' ? [{ label: 'Roll dice' }] : legalBackgammon(s).length ? legalBackgammon(s) : [{ label: 'No move — pass' }],
  play: (s, move, random) => {
    if (move.label === 'Roll dice') { const a = d6(random), b = d6(random); return { ...s, rolled: [a, b], dice: a === b ? [a, a, a, a] : [a, b], phase: 'move', last: [] } }
    let next = move.label ? { ...s, dice: [] } : applyOne(s, move)
    if (next.off[s.turn] === 15) return { ...next, winner: s.turn }
    if (!next.dice.length || !legalBackgammon(next).length) next = { ...next, dice: [], phase: 'roll', turn: 1 - s.turn }
    return next
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `${['White', 'Red'][s.winner!]} bore off all fifteen checkers.` },
  evaluate: (s, me) => {
    const pips = (player: number) => s.bar[player] * 25 + s.points.reduce((sum, count, i) => count * sign(player) > 0 ? sum + Math.abs(count) * (player === 0 ? i + 1 : 24 - i) : sum, 0)
    const blots = (player: number) => s.points.filter(count => count * sign(player) === 1).length
    return pips(1 - me) - pips(me) - blots(me) * 6 + blots(1 - me) * 3 + s.off[me] * 4
  },
  status: s => s.phase === 'move' ? `Dice ${s.rolled.join(' and ')} · left to play: ${s.dice.join(', ') || '—'}` : 'Roll the dice.',
  lastMove: s => s.last,
}
export const pointOwner = (s: BackgammonState, i: number) => s.points[i] > 0 ? 0 : s.points[i] < 0 ? 1 : -1


/* ── Snakes & Ladders: four racers on 100 squares; land exactly on 100 to win ── */
export const SNAKES: Record<number, number> = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 }
export const LADDERS: Record<number, number> = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 }
export interface SnakesState { positions: number[]; turn: number; die: number; winner: number | null | undefined; log: string; last: number[] }
const RACERS = ['Red', 'Blue', 'Green', 'Yellow']
export const SNAKES_AND_LADDERS: FamilyGame<SnakesState> = {
  id: 'snakes', title: 'Snakes & Ladders', players: 4, names: RACERS, colors: ['#e8342c', '#2f6fd8', '#2fa64a', '#f2c230'], layout: { kind: 'custom' },
  setup: () => ({ positions: [0, 0, 0, 0], turn: 0, die: 0, winner: undefined, log: 'Roll to start. A 6 rolls again.', last: [] }),
  current: s => s.turn,
  moves: s => s.winner !== undefined ? [] : [{ label: 'Roll' }],
  play: (s, _move, random) => {
    const die = d6(random), positions = [...s.positions], from = positions[s.turn], name = RACERS[s.turn]
    let to = from + die, log = `${name} rolled ${die}`
    if (to > 100) { to = 100 - (to - 100); log += ' and bounced back' }
    if (LADDERS[to]) { log += ` — a ladder up to ${LADDERS[to]}!`; to = LADDERS[to] } else if (SNAKES[to]) { log += ` — a snake down to ${SNAKES[to]}.`; to = SNAKES[to] } else log += ` to ${to}.`
    positions[s.turn] = to
    return { positions, die, turn: to === 100 || die === 6 ? s.turn : (s.turn + 1) % 4, winner: to === 100 ? s.turn : undefined, log, last: [from, to] }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `${RACERS[s.winner!]} reached 100!` },
  status: s => s.log,
}

/* ── Mancala (Kalah) and Oware: sow seeds counter-clockwise around the pits ── */
export interface PitState { pits: number[]; stores: [number, number]; turn: number; winner: number | null | undefined; last: number[]; log: string; plies: number }
const KALAH_STORE = [6, 13]
export const MANCALA: FamilyGame<PitState> = {
  id: 'mancala', title: 'Mancala', players: 2, names: ['South', 'North'], colors: ['#e6a93a', '#2fb38c'], depth: 6, layout: { kind: 'custom' },
  setup: () => ({ pits: Array.from({ length: 14 }, (_, i) => KALAH_STORE.includes(i) ? 0 : 4), stores: [0, 0], turn: 0, winner: undefined, last: [], log: 'Pick one of your pits to sow its seeds.', plies: 0 }),
  current: s => s.turn,
  moves: s => s.winner !== undefined ? [] : Array.from({ length: 6 }, (_, k) => s.turn * 7 + k).filter(i => s.pits[i] > 0).map(i => ({ to: i })),
  play: (s, move) => {
    const pits = [...s.pits], me = s.turn
    let seeds = pits[move.to!], at = move.to!
    pits[at] = 0
    const sown: number[] = []
    while (seeds) { at = (at + 1) % 14; if (at === KALAH_STORE[1 - me]) continue; pits[at]++; seeds--; sown.push(at) }
    let log = '', turn = 1 - me
    if (at === KALAH_STORE[me]) { turn = me; log = 'Last seed in the store — go again!' }
    else if (Math.floor(at / 7) === me && pits[at] === 1 && pits[12 - at] > 0) { pits[KALAH_STORE[me]] += pits[12 - at] + 1; log = `Captured ${pits[12 - at] + 1} seeds!`; pits[12 - at] = 0; pits[at] = 0 }
    const sideEmpty = (player: number) => Array.from({ length: 6 }, (_, k) => pits[player * 7 + k]).every(count => !count)
    let winner: number | null | undefined
    if (sideEmpty(0) || sideEmpty(1)) {
      for (const player of [0, 1]) for (let k = 0; k < 6; k++) { pits[KALAH_STORE[player]] += pits[player * 7 + k]; pits[player * 7 + k] = 0 }
      winner = pits[6] === pits[13] ? null : pits[6] > pits[13] ? 0 : 1
    }
    return { pits, stores: [pits[6], pits[13]], turn, winner, last: sown, log, plies: s.plies + 1 }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `${s.pits[6]}–${s.pits[13]}. ${s.winner === null ? 'A draw.' : `${['South', 'North'][s.winner]} wins.`}` },
  evaluate: (s, me) => s.pits[KALAH_STORE[me]] - s.pits[KALAH_STORE[1 - me]],
  status: s => s.log || `Stores: South ${s.pits[6]} · North ${s.pits[13]}`,
  lastMove: s => s.last,
}
// Oware: twelve pits, captures of 2 or 3 in the opponent's row, and you must leave them something to play.
function owareSow(s: PitState, pit: number): { pits: number[]; captured: number; last: number } {
  const pits = [...s.pits]
  let seeds = pits[pit], at = pit
  pits[pit] = 0
  while (seeds) { at = (at + 1) % 12; if (at === pit) continue; pits[at]++; seeds-- }
  const theirs = (i: number) => Math.floor(i / 6) !== s.turn
  const trial = [...pits]
  let captured = 0, back = at
  while (theirs(back) && (trial[back] === 2 || trial[back] === 3)) { captured += trial[back]; trial[back] = 0; back = (back + 11) % 12 }
  // Capturing every seed on the other side would leave them nothing, so it captures nothing.
  const grandSlam = Array.from({ length: 6 }, (_, k) => trial[(1 - s.turn) * 6 + k]).every(count => !count)
  return grandSlam ? { pits, captured: 0, last: at } : { pits: trial, captured, last: at }
}
export const OWARE: FamilyGame<PitState> = {
  id: 'oware', title: 'Oware', players: 2, names: ['South', 'North'], colors: ['#e6a93a', '#2fb38c'], depth: 5, layout: { kind: 'custom' },
  setup: () => ({ pits: Array(12).fill(4), stores: [0, 0], turn: 0, winner: undefined, last: [], log: 'Sow from one of your pits. Capture 2s and 3s on the far side.', plies: 0 }),
  current: s => s.turn,
  moves: s => {
    if (s.winner !== undefined) return []
    const options = Array.from({ length: 6 }, (_, k) => s.turn * 6 + k).filter(i => s.pits[i] > 0)
    const starving = Array.from({ length: 6 }, (_, k) => s.pits[(1 - s.turn) * 6 + k]).every(count => !count)
    const feeding = starving ? options.filter(i => { const { pits } = owareSow(s, i); return Array.from({ length: 6 }, (_, k) => pits[(1 - s.turn) * 6 + k]).some(Boolean) }) : options
    return (feeding.length ? feeding : options).map(to => ({ to }))
  },
  play: (s, move) => {
    const { pits, captured, last } = owareSow(s, move.to!), stores: [number, number] = [...s.stores] as [number, number]
    stores[s.turn] += captured
    const next: PitState = { pits, stores, turn: 1 - s.turn, winner: undefined, last: [last], log: captured ? `Captured ${captured}!` : '', plies: s.plies + 1 }
    if (stores[0] > 24) next.winner = 0; else if (stores[1] > 24) next.winner = 1
    else if (!OWARE.moves(next).length || next.plies > 300) {
      // Nobody can continue: each player keeps the seeds on their own side.
      for (const player of [0, 1]) for (let k = 0; k < 6; k++) { next.stores[player] += next.pits[player * 6 + k]; next.pits[player * 6 + k] = 0 }
      next.winner = next.stores[0] === next.stores[1] ? null : next.stores[0] > next.stores[1] ? 0 : 1
    }
    return next
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `${s.stores[0]}–${s.stores[1]}. ${s.winner === null ? 'A draw.' : `${['South', 'North'][s.winner]} wins.`}` },
  evaluate: (s, me) => s.stores[me] - s.stores[1 - me],
  status: s => s.log || `Captured: South ${s.stores[0]} · North ${s.stores[1]}`,
  lastMove: s => s.last,
}
