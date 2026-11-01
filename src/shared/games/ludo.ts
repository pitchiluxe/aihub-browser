import type { Random } from './random'

// Classic Ludo on the usual 15×15 cross. Seats run clockwise from the
// bottom-left: red, green, yellow, blue. A token's position is its progress
// from its own start square: -1 in the yard, 0–50 on the shared track,
// 51–55 in its home column, 56 home.
export const LUDO_SEATS = ['red', 'green', 'yellow', 'blue'] as const
export type LudoColor = typeof LUDO_SEATS[number]
export const LUDO_HOME = 56
const TRACK_LENGTH = 52, LAST_TRACK = 50
const STARTS = [40, 1, 14, 27]
export const LUDO_SAFE = new Set([...STARTS, ...STARTS.map(start => (start + 8) % TRACK_LENGTH)])

export interface LudoPlayer { seat: number; name: string; bot: boolean; tokens: number[] }
export interface LudoState { players: LudoPlayer[]; current: number; dice: number | null; sixes: number; phase: 'roll' | 'move' | 'over'; winner: number | null; turns: number; log: string[] }

export function newLudo(humans = 1, total = 2): LudoState {
  const count = Math.min(4, Math.max(2, total)), seats = count === 2 ? [0, 2] : count === 3 ? [0, 1, 2] : [0, 1, 2, 3]
  const players = seats.map((seat, i) => ({ seat, name: i < humans ? humans === 1 ? 'You' : `${capital(LUDO_SEATS[seat])}` : `Computer ${capital(LUDO_SEATS[seat])}`, bot: i >= humans, tokens: [-1, -1, -1, -1] }))
  return { players, current: 0, dice: null, sixes: 0, phase: 'roll', winner: null, turns: 0, log: ['Roll a 6 to bring your first pawn out.'] }
}
const capital = (text: string) => text[0].toUpperCase() + text.slice(1)

/** Track square (0–51) a token occupies, or null when it is in the yard, home column or home. */
export function ludoSquare(seat: number, progress: number): number | null {
  return progress >= 0 && progress <= LAST_TRACK ? (STARTS[seat] + progress) % TRACK_LENGTH : null
}

export function legalLudoMoves(state: LudoState): number[] {
  if (state.phase !== 'move' || state.dice === null) return []
  const dice = state.dice
  return state.players[state.current].tokens.flatMap((progress, token) => progress === -1 ? dice === 6 ? [token] : [] : progress < LUDO_HOME && progress + dice <= LUDO_HOME ? [token] : [])
}

function passTurn(state: LudoState, note: string): LudoState {
  return { ...state, current: (state.current + 1) % state.players.length, phase: 'roll', sixes: 0, turns: state.turns + 1, log: [note, ...state.log].slice(0, 12) }
}

export function rollLudo(state: LudoState, random: Random = Math.random, forced?: number): LudoState {
  if (state.phase !== 'roll') return state
  const dice = forced ?? 1 + Math.floor(random() * 6), sixes = dice === 6 ? state.sixes + 1 : 0
  const player = state.players[state.current], rolled = { ...state, dice, sixes, phase: 'move' as const }
  if (sixes === 3) return passTurn(rolled, `${player.name} rolled three 6s in a row and lost the turn.`)
  if (!legalLudoMoves(rolled).length) return passTurn(rolled, `${player.name} rolled ${dice} — no pawn can move.`)
  return rolled
}

export function moveLudo(state: LudoState, token: number): LudoState {
  if (!legalLudoMoves(state).includes(token)) return state
  const dice = state.dice!, players = state.players.map(player => ({ ...player, tokens: [...player.tokens] }))
  const mover = players[state.current], from = mover.tokens[token], to = from === -1 ? 0 : from + dice
  mover.tokens[token] = to
  let captured = 0
  const square = ludoSquare(mover.seat, to)
  if (square !== null && !LUDO_SAFE.has(square)) players.forEach((other, index) => {
    if (index === state.current) return
    other.tokens.forEach((progress, i) => { if (ludoSquare(other.seat, progress) === square) { other.tokens[i] = -1; captured++ } })
  })
  const home = to === LUDO_HOME, note = `${mover.name} ${from === -1 ? 'brought a pawn out' : home ? 'brought a pawn home' : `moved ${dice}`}${captured ? ` and sent ${captured === 1 ? 'a pawn' : `${captured} pawns`} back` : ''}.`
  const next = { ...state, players, log: [note, ...state.log].slice(0, 12) }
  if (mover.tokens.every(progress => progress === LUDO_HOME)) return { ...next, phase: 'over', winner: state.current, log: [`${mover.name} won!`, ...next.log].slice(0, 12) }
  if (dice === 6 || captured || home) return { ...next, phase: 'roll' }
  return passTurn(next, `${players[(state.current + 1) % players.length].name} to roll.`)
}

/** Picks a computer move: capture, finish, leave the yard, reach safety, avoid danger, then run. */
export function chooseLudoMove(state: LudoState): number | null {
  const moves = legalLudoMoves(state)
  if (moves.length <= 1) return moves[0] ?? null
  const mover = state.players[state.current], dice = state.dice!
  const threats = (square: number) => state.players.some((other, index) => index !== state.current && other.tokens.some(progress => {
    const at = ludoSquare(other.seat, progress)
    return at !== null && (square - at + TRACK_LENGTH) % TRACK_LENGTH >= 1 && (square - at + TRACK_LENGTH) % TRACK_LENGTH <= 6
  }))
  const value = (token: number) => {
    const from = mover.tokens[token], to = from === -1 ? 0 : from + dice, square = ludoSquare(mover.seat, to), before = ludoSquare(mover.seat, from)
    let score = to * 0.1
    if (square !== null && !LUDO_SAFE.has(square) && state.players.some((other, index) => index !== state.current && other.tokens.some(progress => ludoSquare(other.seat, progress) === square))) score += 100
    if (to === LUDO_HOME) score += 80
    if (from === -1) score += 50
    if (from <= LAST_TRACK && to > LAST_TRACK) score += 40
    if (square !== null && LUDO_SAFE.has(square)) score += 15
    if (square !== null && !LUDO_SAFE.has(square) && threats(square)) score -= 30
    if (before !== null && !LUDO_SAFE.has(before) && threats(before)) score += 25
    return score
  }
  return moves.reduce((best, token) => value(token) > value(best) ? token : best)
}
