import type { Random } from './random'

// Checkers: 8×8, men capture forward only, kings step one square, any capture
// sequence may be chosen and a man is crowned the moment it reaches the far row.
// Dames (international draughts): 10×10, men capture both ways, kings fly, the
// longest capture is compulsory and promotion happens only where a move ends.
// Pieces: 1 = your man, 2 = your king, -1/-2 = opponent. You start at the bottom.
export type DraughtsVariant = 'checkers' | 'dames'
export interface DraughtsMove { from: number; path: number[]; captures: number[] }
export interface DraughtsState { variant: DraughtsVariant; size: number; board: number[]; turn: 1 | -1; quiet: number; over: boolean; winner: 1 | -1 | 0 | null; last: DraughtsMove | null }
const DIRECTIONS = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
const DRAW_AFTER = 50

export function newDraughts(variant: DraughtsVariant): DraughtsState {
  const size = variant === 'checkers' ? 8 : 10, rows = variant === 'checkers' ? 3 : 4
  const board = Array.from({ length: size * size }, (_, i) => {
    const x = i % size, y = Math.floor(i / size)
    return (x + y) % 2 === 0 ? 0 : y < rows ? -1 : y >= size - rows ? 1 : 0
  })
  return { variant, size, board, turn: 1, quiet: 0, over: false, winner: null, last: null }
}

const farRow = (size: number, side: number) => side > 0 ? 0 : size - 1

function captureSequences(state: DraughtsState, board: number[], from: number): DraughtsMove[] {
  const { size, variant } = state, piece = board[from], side = Math.sign(piece), king = Math.abs(piece) === 2
  const flying = king && variant === 'dames', results: DraughtsMove[] = []
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size
  const search = (at: number, path: number[], captures: number[]) => {
    let extended = false
    const x0 = at % size, y0 = Math.floor(at / size)
    for (const [dx, dy] of DIRECTIONS) {
      if (!king && variant === 'checkers' && dy !== -side) continue
      let x = x0 + dx, y = y0 + dy
      if (flying) while (inside(x, y) && board[y * size + x] === 0) { x += dx; y += dy }
      if (!inside(x, y)) continue
      const over = y * size + x
      // Captured pieces stay on the board until the move ends, so they block and cannot be jumped twice.
      if (Math.sign(board[over]) !== -side || captures.includes(over)) continue
      for (let lx = x + dx, ly = y + dy; inside(lx, ly) && board[ly * size + lx] === 0; lx += dx, ly += dy) {
        const land = ly * size + lx, nextPath = [...path, land], nextCaptures = [...captures, over]
        extended = true
        if (!king && variant === 'checkers' && ly === farRow(size, side)) results.push({ from, path: nextPath, captures: nextCaptures })
        else search(land, nextPath, nextCaptures)
        if (!flying) break
      }
    }
    if (!extended && captures.length) results.push({ from, path, captures })
  }
  const lifted = board[from]; board[from] = 0
  search(from, [], [])
  board[from] = lifted
  return results
}

export function legalDraughtsMoves(state: DraughtsState): DraughtsMove[] {
  if (state.over) return []
  const { size, board, turn } = state, work = [...board], captures: DraughtsMove[] = [], steps: DraughtsMove[] = []
  board.forEach((piece, from) => {
    if (Math.sign(piece) !== turn) return
    captures.push(...captureSequences(state, work, from))
    const king = Math.abs(piece) === 2, x0 = from % size, y0 = Math.floor(from / size)
    for (const [dx, dy] of DIRECTIONS) {
      if (!king && dy !== -turn) continue
      for (let x = x0 + dx, y = y0 + dy; x >= 0 && y >= 0 && x < size && y < size && board[y * size + x] === 0; x += dx, y += dy) {
        steps.push({ from, path: [y * size + x], captures: [] })
        if (!king || state.variant === 'checkers') break
      }
    }
  })
  if (!captures.length) return steps
  if (state.variant === 'checkers') return captures
  const longest = Math.max(...captures.map(move => move.captures.length))
  return captures.filter(move => move.captures.length === longest)
}

export function applyDraughts(state: DraughtsState, move: DraughtsMove): DraughtsState {
  const board = [...state.board], piece = board[move.from], to = move.path[move.path.length - 1]
  board[move.from] = 0
  move.captures.forEach(at => { board[at] = 0 })
  board[to] = Math.floor(to / state.size) === farRow(state.size, Math.sign(piece)) ? Math.sign(piece) * 2 : piece
  const quiet = move.captures.length || Math.abs(piece) === 1 ? 0 : state.quiet + 1
  const next: DraughtsState = { ...state, board, turn: state.turn === 1 ? -1 : 1, quiet, last: move }
  if (!legalDraughtsMoves(next).length) return { ...next, over: true, winner: state.turn }
  if (quiet >= DRAW_AFTER) return { ...next, over: true, winner: 0 }
  return next
}

function evaluate(state: DraughtsState, side: number): number {
  if (state.over) return state.winner === 0 ? 0 : state.winner === side ? 1000 : -1000
  return state.board.reduce((score, piece, i) => {
    if (!piece) return score
    const owner = Math.sign(piece), y = Math.floor(i / state.size)
    const advance = Math.abs(piece) === 1 ? (owner > 0 ? state.size - 1 - y : y) * 0.04 : 0
    return score + owner * side * ((Math.abs(piece) === 2 ? 3 : 1) + advance)
  }, 0)
}

function search(state: DraughtsState, depth: number, alpha: number, beta: number, side: number): number {
  if (depth === 0 || state.over) return evaluate(state, side)
  const moves = legalDraughtsMoves(state), maximizing = state.turn === side
  let best = maximizing ? -Infinity : Infinity
  for (const move of moves) {
    const value = search(applyDraughts(state, move), depth - 1, alpha, beta, side)
    if (maximizing) { best = Math.max(best, value); alpha = Math.max(alpha, value) } else { best = Math.min(best, value); beta = Math.min(beta, value) }
    if (beta <= alpha) break
  }
  return best
}

export function chooseDraughtsMove(state: DraughtsState, random: Random = Math.random): DraughtsMove | null {
  const moves = legalDraughtsMoves(state)
  if (moves.length <= 1) return moves[0] ?? null
  const depth = state.variant === 'checkers' ? 4 : 3
  const scored = moves.map(move => ({ move, value: search(applyDraughts(state, move), depth - 1, -Infinity, Infinity, state.turn) }))
  const best = Math.max(...scored.map(entry => entry.value))
  const choices = scored.filter(entry => entry.value >= best - 1e-9)
  return choices[Math.floor(random() * choices.length)].move
}
