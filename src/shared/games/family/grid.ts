import { DIRS4, DIRS8, type FamilyGame, type Move, type Outcome } from './core'
// Two-player placement and movement games on square grids.
// Board cells hold -1 for empty or the owning player (0 or 1).
export interface GridState { board: number[]; turn: number; last: number[]; passes: number; winner: number | null | undefined; history?: string[] }
const fresh = (size: number): GridState => ({ board: Array(size).fill(-1), turn: 0, last: [], passes: 0, winner: undefined })
const clone = (state: GridState): GridState => ({ ...state, board: [...state.board], last: [] })
const at = (cols: number, r: number, c: number) => r * cols + c
const inside = (rows: number, cols: number, r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols
const done = (state: GridState, names = ['White', 'Black']): Outcome | null => state.winner === undefined ? null : { winner: state.winner, text: state.winner === null ? 'A draw.' : `${names[state.winner]} wins.` }
// Longest run through `index` for the owner of that cell.
function runAt(board: number[], rows: number, cols: number, index: number, need: number): boolean {
  const owner = board[index], r0 = Math.floor(index / cols), c0 = index % cols
  return [[0, 1], [1, 0], [1, 1], [1, -1]].some(([dr, dc]) => {
    let count = 1
    for (const sign of [1, -1]) for (let k = 1; ; k++) { const r = r0 + dr * k * sign, c = c0 + dc * k * sign; if (!inside(rows, cols, r, c) || board[at(cols, r, c)] !== owner) break; count++ }
    return count >= need
  })
}
function lineGame(id: string, title: string, rows: number, cols: number, need: number, gravity: boolean, names: string[], colors: string[], depth: number, style: 'plain' | 'intersections'): FamilyGame<GridState> {
  return {
    id, title, players: 2, names, colors, depth, layout: { kind: 'grid', rows, cols, style },
    setup: () => fresh(rows * cols),
    current: state => state.turn,
    moves: state => {
      if (state.winner !== undefined) return []
      if (gravity) return Array.from({ length: cols }, (_, c) => { for (let r = rows - 1; r >= 0; r--) if (state.board[at(cols, r, c)] < 0) return { to: at(cols, r, c), area: Array.from({ length: rows }, (_, rr) => at(cols, rr, c)) } as Move; return null }).filter(Boolean) as Move[]
      const empty = state.board.map((cell, i) => cell < 0 ? i : -1).filter(i => i >= 0)
      if (rows * cols <= 16 || state.board.every(cell => cell < 0)) return (state.board.every(cell => cell < 0) && rows * cols > 16 ? [Math.floor(rows / 2) * cols + Math.floor(cols / 2)] : empty).map(to => ({ to }))
      // Big boards: only cells near existing stones are worth considering.
      return empty.filter(i => DIRS8.some(([dr, dc]) => [1, 2].some(k => { const r = Math.floor(i / cols) + dr * k, c = i % cols + dc * k; return inside(rows, cols, r, c) && state.board[at(cols, r, c)] >= 0 }))).map(to => ({ to }))
    },
    play: (state, move) => {
      const next = clone(state); next.board[move.to!] = state.turn; next.last = [move.to!]
      if (runAt(next.board, rows, cols, move.to!, need)) next.winner = state.turn
      else if (next.board.every(cell => cell >= 0)) next.winner = null
      next.turn = 1 - state.turn
      return next
    },
    outcome: state => done(state, names),
    pieceAt: (state, i) => state.board[i] < 0 ? null : { owner: state.board[i] },
    lastMove: state => state.last,
    evaluate: (state, me) => {
      // Count open windows of `need` cells, weighted by how full each is.
      let score = 0
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        if (!inside(rows, cols, r + dr * (need - 1), c + dc * (need - 1))) continue
        let mine = 0, theirs = 0
        for (let k = 0; k < need; k++) { const cell = state.board[at(cols, r + dr * k, c + dc * k)]; if (cell === me) mine++; else if (cell >= 0) theirs++ }
        if (!theirs && mine) score += mine ** 3; if (!mine && theirs) score -= theirs ** 3 * 1.2
      }
      return score
    },
  }
}
export const TIC_TAC_TOE = lineGame('tictactoe', 'Tic-Tac-Toe', 3, 3, 3, false, ['X', 'O'], ['#ff5f6d', '#3fc1ff'], 9, 'plain')
TIC_TAC_TOE.pieceAt = (state, i) => state.board[i] < 0 ? null : { owner: state.board[i], glyph: state.board[i] ? 'O' : 'X' }
export const FOUR_IN_A_ROW = lineGame('fourrow', 'Four in a Row', 6, 7, 4, true, ['Red', 'Yellow'], ['#e8342c', '#f2c230'], 5, 'plain')
export const GOMOKU = lineGame('gomoku', 'Five in a Row', 13, 13, 5, false, ['Black', 'White'], ['#1d1d24', '#f6efe0'], 2, 'intersections')

/* ── Reversi ── */
const flips = (board: number[], index: number, player: number) => {
  if (board[index] >= 0) return []
  const r0 = Math.floor(index / 8), c0 = index % 8, all: number[] = []
  for (const [dr, dc] of DIRS8) {
    const line: number[] = []
    let r = r0 + dr, c = c0 + dc
    while (inside(8, 8, r, c) && board[at(8, r, c)] === 1 - player) { line.push(at(8, r, c)); r += dr; c += dc }
    if (line.length && inside(8, 8, r, c) && board[at(8, r, c)] === player) all.push(...line)
  }
  return all
}
const CORNER_WEIGHT = [100, -20, 10, 5, 5, 10, -20, 100, -20, -50, -2, -2, -2, -2, -50, -20, 10, -2, 1, 1, 1, 1, -2, 10, 5, -2, 1, 0, 0, 1, -2, 5, 5, -2, 1, 0, 0, 1, -2, 5, 10, -2, 1, 1, 1, 1, -2, 10, -20, -50, -2, -2, -2, -2, -50, -20, 100, -20, 10, 5, 5, 10, -20, 100]
export const REVERSI: FamilyGame<GridState> = {
  id: 'reversi', title: 'Reversi', players: 2, names: ['Black', 'White'], colors: ['#1d1d24', '#f6efe0'], depth: 4, layout: { kind: 'grid', rows: 8, cols: 8, style: 'plain' },
  setup: () => { const state = fresh(64); state.board[27] = state.board[36] = 1; state.board[28] = state.board[35] = 0; return state },
  current: state => state.turn,
  moves: state => {
    if (state.winner !== undefined) return []
    const moves = state.board.map((_, i) => flips(state.board, i, state.turn).length ? { to: i } : null).filter(Boolean) as Move[]
    return moves.length ? moves : [{ label: 'Pass' }]
  },
  play: (state, move) => {
    const next = clone(state)
    if (move.to === undefined) next.passes++
    else { const turned = flips(state.board, move.to, state.turn); next.board[move.to] = state.turn; turned.forEach(i => { next.board[i] = state.turn }); next.last = [move.to, ...turned]; next.passes = 0 }
    next.turn = 1 - state.turn
    if (next.passes >= 2 || next.board.every(cell => cell >= 0)) { const black = next.board.filter(cell => cell === 0).length, white = next.board.filter(cell => cell === 1).length; next.winner = black === white ? null : black > white ? 0 : 1 }
    return next
  },
  outcome: state => state.winner === undefined ? null : { winner: state.winner, text: `${state.board.filter(cell => cell === 0).length}–${state.board.filter(cell => cell === 1).length}. ${state.winner === null ? 'A draw.' : `${['Black', 'White'][state.winner]} wins.`}` },
  pieceAt: (state, i) => state.board[i] < 0 ? null : { owner: state.board[i] },
  lastMove: state => state.last,
  evaluate: (state, me) => state.board.reduce((sum, cell, i) => sum + (cell === me ? CORNER_WEIGHT[i] : cell >= 0 ? -CORNER_WEIGHT[i] : 0), 0) + (state.board.some(cell => cell < 0) ? 0 : state.board.filter(cell => cell === me).length * 10),
  status: state => `Black ${state.board.filter(cell => cell === 0).length} · White ${state.board.filter(cell => cell === 1).length}`,
}

/* ── Go (9 × 9, area scoring, 6.5 komi) ── */
function groupOf(board: number[], size: number, start: number): { stones: number[]; liberties: Set<number> } {
  const owner = board[start], stones = [start], seen = new Set([start]), liberties = new Set<number>()
  for (let i = 0; i < stones.length; i++) {
    const r = Math.floor(stones[i] / size), c = stones[i] % size
    for (const [dr, dc] of DIRS4) { if (!inside(size, size, r + dr, c + dc)) continue; const n = at(size, r + dr, c + dc); if (board[n] < 0) liberties.add(n); else if (board[n] === owner && !seen.has(n)) { seen.add(n); stones.push(n) } }
  }
  return { stones, liberties }
}
function placeStone(board: number[], size: number, index: number, player: number): { board: number[]; captured: number[] } | null {
  if (board[index] >= 0) return null
  const next = [...board]; next[index] = player
  const captured: number[] = []
  const r = Math.floor(index / size), c = index % size
  for (const [dr, dc] of DIRS4) { if (!inside(size, size, r + dr, c + dc)) continue; const n = at(size, r + dr, c + dc); if (next[n] === 1 - player) { const group = groupOf(next, size, n); if (!group.liberties.size) group.stones.forEach(s => { next[s] = -1; captured.push(s) }) } }
  if (!groupOf(next, size, index).liberties.size) return null
  return { board: next, captured }
}
export function goScore(board: number[], size: number): [number, number] {
  const score: [number, number] = [0, 6.5], seen = new Set<number>()
  board.forEach((cell, i) => {
    if (cell >= 0) { score[cell]++; return }
    if (seen.has(i)) return
    // An empty region counts for a player only if it borders nobody else.
    const region = [i], borders = new Set<number>(); seen.add(i)
    for (let k = 0; k < region.length; k++) { const r = Math.floor(region[k] / size), c = region[k] % size; for (const [dr, dc] of DIRS4) { if (!inside(size, size, r + dr, c + dc)) continue; const n = at(size, r + dr, c + dc); if (board[n] < 0 && !seen.has(n)) { seen.add(n); region.push(n) } else if (board[n] >= 0) borders.add(board[n]) } }
    if (borders.size === 1) score[[...borders][0]] += region.length
  })
  return score
}
const GO = 9
export const GO_GAME: FamilyGame<GridState> = {
  id: 'go', title: 'Go', players: 2, names: ['Black', 'White'], colors: ['#1d1d24', '#f6efe0'], depth: 2, layout: { kind: 'grid', rows: GO, cols: GO, style: 'intersections' },
  setup: () => ({ ...fresh(GO * GO), history: [] }),
  current: state => state.turn,
  moves: state => {
    if (state.winner !== undefined) return []
    const moves: Move[] = []
    state.board.forEach((cell, i) => {
      if (cell >= 0) return
      const placed = placeStone(state.board, GO, i, state.turn)
      // Simple ko: no move may recreate an earlier position. Filling your own single-point eye is skipped too.
      if (placed && !state.history!.includes(placed.board.join(''))) {
        const r = Math.floor(i / GO), c = i % GO, eye = DIRS4.every(([dr, dc]) => !inside(GO, GO, r + dr, c + dc) || state.board[at(GO, r + dr, c + dc)] === state.turn)
        if (!eye) moves.push({ to: i })
      }
    })
    return [...moves, { label: 'Pass' }]
  },
  play: (state, move) => {
    const next = clone(state)
    next.history = [...(state.history || []).slice(-8), state.board.join('')]
    if (move.to === undefined) { next.passes++ } else { const placed = placeStone(state.board, GO, move.to, state.turn)!; next.board = placed.board; next.last = [move.to, ...placed.captured]; next.passes = 0 }
    next.turn = 1 - state.turn
    if (next.passes >= 2 || next.history.length > 160) { const [black, white] = goScore(next.board, GO); next.winner = black > white ? 0 : 1 }
    return next
  },
  outcome: state => { if (state.winner === undefined) return null; const [black, white] = goScore(state.board, GO); return { winner: state.winner, text: `Black ${black} · White ${white} (with 6.5 komi). ${['Black', 'White'][state.winner!]} wins.` } },
  pieceAt: (state, i) => state.board[i] < 0 ? null : { owner: state.board[i] },
  lastMove: state => state.last.slice(0, 1),
  evaluate: (state, me) => { const score = goScore(state.board, GO); return score[me] - score[1 - me] },
  status: state => { const [black, white] = goScore(state.board, GO); return `Estimate — Black ${black} · White ${white}` },
}

/* ── Hex (9 × 9): Red joins top to bottom, Blue joins left to right ── */
const HEX = 9
export function hexConnected(board: number[], player: number): boolean {
  const queue: number[] = [], seen = new Set<number>()
  for (let k = 0; k < HEX; k++) { const start = player === 0 ? k : k * HEX; if (board[start] === player) { queue.push(start); seen.add(start) } }
  const neighbours: [number, number][] = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0]]
  while (queue.length) {
    const cell = queue.pop()!, r = Math.floor(cell / HEX), c = cell % HEX
    if (player === 0 ? r === HEX - 1 : c === HEX - 1) return true
    for (const [dr, dc] of neighbours) { if (!inside(HEX, HEX, r + dr, c + dc)) continue; const n = at(HEX, r + dr, c + dc); if (board[n] === player && !seen.has(n)) { seen.add(n); queue.push(n) } }
  }
  return false
}
export const HEX_GAME: FamilyGame<GridState> = {
  id: 'hex', title: 'Hex', players: 2, names: ['Red', 'Blue'], colors: ['#e8342c', '#2f6fd8'], layout: { kind: 'hex', size: HEX },
  setup: () => fresh(HEX * HEX),
  current: state => state.turn,
  moves: state => state.winner !== undefined ? [] : state.board.map((cell, i) => cell < 0 ? { to: i } : null).filter(Boolean) as Move[],
  play: (state, move) => { const next = clone(state); next.board[move.to!] = state.turn; next.last = [move.to!]; if (hexConnected(next.board, state.turn)) next.winner = state.turn; next.turn = 1 - state.turn; return next },
  outcome: state => done(state, ['Red', 'Blue']),
  pieceAt: (state, i) => state.board[i] < 0 ? null : { owner: state.board[i] },
  lastMove: state => state.last,
  status: () => 'Red joins top to bottom. Blue joins left to right.',
}

/* ── Breakthrough: pawns step forward; the first to the far row wins ── */
export const BREAKTHROUGH: FamilyGame<GridState> = {
  id: 'breakthrough', title: 'Breakthrough', players: 2, names: ['White', 'Black'], colors: ['#f6efe0', '#1d1d24'], depth: 3, layout: { kind: 'grid', rows: 8, cols: 8, style: 'checker' },
  setup: () => { const state = fresh(64); for (let i = 0; i < 16; i++) { state.board[i] = 1; state.board[63 - i] = 0 } return state },
  current: state => state.turn,
  moves: state => {
    if (state.winner !== undefined) return []
    const forward = state.turn === 0 ? -1 : 1, moves: Move[] = []
    state.board.forEach((cell, i) => {
      if (cell !== state.turn) return
      const r = Math.floor(i / 8) + forward, c = i % 8
      for (const dc of [-1, 0, 1]) { if (!inside(8, 8, r, c + dc)) continue; const to = at(8, r, c + dc), target = state.board[to]; if (target < 0 || (dc !== 0 && target === 1 - state.turn)) moves.push({ from: i, to }) }
    })
    return moves
  },
  play: (state, move) => {
    const next = clone(state); next.board[move.to!] = state.turn; next.board[move.from!] = -1; next.last = [move.from!, move.to!]
    const row = Math.floor(move.to! / 8)
    if ((state.turn === 0 && row === 0) || (state.turn === 1 && row === 7) || !next.board.includes(1 - state.turn)) next.winner = state.turn
    next.turn = 1 - state.turn; return next
  },
  outcome: state => done(state),
  pieceAt: (state, i) => state.board[i] < 0 ? null : { owner: state.board[i] },
  lastMove: state => state.last,
  evaluate: (state, me) => state.board.reduce((sum, cell, i) => { if (cell < 0) return sum; const row = Math.floor(i / 8), progress = cell === 0 ? 7 - row : row; return sum + (cell === me ? 1 : -1) * (10 + progress * progress) }, 0),
}

/* ── Konane: Hawaiian checkers — jump orthogonally to capture; no move, you lose ── */
const KONANE = 6
export const KONANE_GAME: FamilyGame<GridState> = {
  id: 'konane', title: 'Konane', players: 2, names: ['Black', 'White'], colors: ['#1d1d24', '#f6efe0'], depth: 3, layout: { kind: 'grid', rows: KONANE, cols: KONANE, style: 'plain' },
  setup: () => { const state = fresh(KONANE * KONANE); state.board = state.board.map((_, i) => (Math.floor(i / KONANE) + i % KONANE) % 2); state.board[at(KONANE, 2, 2)] = -1; state.board[at(KONANE, 2, 3)] = -1; return state },
  current: state => state.turn,
  moves: state => {
    if (state.winner !== undefined) return []
    const moves: Move[] = []
    state.board.forEach((cell, i) => {
      if (cell !== state.turn) return
      for (const [dr, dc] of DIRS4) for (let k = 1; ; k++) {
        const r = Math.floor(i / KONANE) + dr * 2 * k, c = i % KONANE + dc * 2 * k, mid = at(KONANE, r - dr, c - dc)
        if (!inside(KONANE, KONANE, r, c) || state.board[mid] !== 1 - state.turn || state.board[at(KONANE, r, c)] >= 0) break
        moves.push({ from: i, to: at(KONANE, r, c) })
      }
    })
    return moves
  },
  play: (state, move) => {
    const next = clone(state), dr = Math.sign(Math.floor(move.to! / KONANE) - Math.floor(move.from! / KONANE)), dc = Math.sign(move.to! % KONANE - move.from! % KONANE)
    for (let cell = move.from!; cell !== move.to; cell += dr * KONANE + dc) next.board[cell] = -1
    next.board[move.to!] = state.turn; next.last = [move.from!, move.to!]; next.turn = 1 - state.turn
    if (!KONANE_GAME.moves(next).length) next.winner = state.turn
    return next
  },
  outcome: state => done(state, ['Black', 'White']),
  pieceAt: (state, i) => state.board[i] < 0 ? null : { owner: state.board[i] },
  lastMove: state => state.last,
  evaluate: (state, me) => { const mine = KONANE_GAME.moves({ ...state, turn: me }).length, theirs = KONANE_GAME.moves({ ...state, turn: 1 - me }).length; return mine - theirs * 1.5 },
}

/* ── Lines of Action: move as far as there are pieces on the line; connect all your pieces ── */
function connectedAll(board: number[], player: number): boolean {
  const pieces = board.map((cell, i) => cell === player ? i : -1).filter(i => i >= 0)
  if (pieces.length <= 1) return true
  const seen = new Set([pieces[0]]), queue = [pieces[0]]
  while (queue.length) { const cell = queue.pop()!, r = Math.floor(cell / 8), c = cell % 8; for (const [dr, dc] of DIRS8) { if (!inside(8, 8, r + dr, c + dc)) continue; const n = at(8, r + dr, c + dc); if (board[n] === player && !seen.has(n)) { seen.add(n); queue.push(n) } } }
  return seen.size === pieces.length
}
export const LINES_OF_ACTION: FamilyGame<GridState> = {
  id: 'loa', title: 'Lines of Action', players: 2, names: ['Black', 'White'], colors: ['#1d1d24', '#f6efe0'], depth: 2, layout: { kind: 'grid', rows: 8, cols: 8, style: 'checker' },
  setup: () => { const state = fresh(64); for (let k = 1; k < 7; k++) { state.board[k] = state.board[56 + k] = 0; state.board[k * 8] = state.board[k * 8 + 7] = 1 } return state },
  current: state => state.turn,
  moves: state => {
    if (state.winner !== undefined) return []
    const moves: Move[] = []
    state.board.forEach((cell, i) => {
      if (cell !== state.turn) return
      const r0 = Math.floor(i / 8), c0 = i % 8
      for (const [dr, dc] of DIRS8) {
        let count = 0
        for (const sign of [1, -1]) for (let k = sign === 1 ? 0 : 1; ; k++) { const r = r0 + dr * k * sign, c = c0 + dc * k * sign; if (!inside(8, 8, r, c)) break; if (state.board[at(8, r, c)] >= 0) count++ }
        const r = r0 + dr * count, c = c0 + dc * count
        if (!inside(8, 8, r, c) || state.board[at(8, r, c)] === state.turn) continue
        let blocked = false
        for (let k = 1; k < count; k++) if (state.board[at(8, r0 + dr * k, c0 + dc * k)] === 1 - state.turn) blocked = true
        if (!blocked) moves.push({ from: i, to: at(8, r, c) })
      }
    })
    return moves
  },
  play: (state, move) => {
    const next = clone(state); next.board[move.to!] = state.turn; next.board[move.from!] = -1; next.last = [move.from!, move.to!]
    const mine = connectedAll(next.board, state.turn), theirs = connectedAll(next.board, 1 - state.turn)
    if (mine) next.winner = state.turn; else if (theirs) next.winner = 1 - state.turn
    next.turn = 1 - state.turn
    if (next.winner === undefined && !LINES_OF_ACTION.moves(next).length) next.winner = state.turn
    return next
  },
  outcome: state => done(state, ['Black', 'White']),
  pieceAt: (state, i) => state.board[i] < 0 ? null : { owner: state.board[i] },
  lastMove: state => state.last,
  // Pieces huddled near their own centre of mass are closer to connecting.
  evaluate: (state, me) => {
    const spread = (player: number) => { const cells = state.board.map((cell, i) => cell === player ? i : -1).filter(i => i >= 0); const cr = cells.reduce((s, i) => s + Math.floor(i / 8), 0) / cells.length, cc = cells.reduce((s, i) => s + i % 8, 0) / cells.length; return cells.reduce((s, i) => s + Math.max(Math.abs(Math.floor(i / 8) - cr), Math.abs(i % 8 - cc)), 0) / cells.length }
    return spread(1 - me) - spread(me)
  },
}

/* ── Peg solitaire (English cross): jump and remove until one peg is left ── */
const PEG_HOLE = (i: number) => { const r = Math.floor(i / 7), c = i % 7; return (r < 2 || r > 4) && (c < 2 || c > 4) }
export const PEG_SOLITAIRE: FamilyGame<GridState> = {
  id: 'pegs', title: 'Peg Solitaire', players: 1, names: ['You'], colors: ['#e6a93a'], layout: { kind: 'grid', rows: 7, cols: 7, style: 'plain', holes: PEG_HOLE },
  setup: () => { const state = fresh(49); state.board = state.board.map((_, i) => PEG_HOLE(i) ? -2 : 0); state.board[24] = -1; return state },
  current: () => 0,
  moves: state => {
    const moves: Move[] = []
    state.board.forEach((cell, i) => {
      if (cell !== 0) return
      for (const [dr, dc] of DIRS4) { const r = Math.floor(i / 7) + dr * 2, c = i % 7 + dc * 2; if (inside(7, 7, r, c) && state.board[at(7, r, c)] === -1 && state.board[at(7, r - dr, c - dc)] === 0) moves.push({ from: i, to: at(7, r, c) }) }
    })
    return moves
  },
  play: (state, move) => {
    const next = clone(state), mid = (move.from! + move.to!) / 2
    next.board[move.from!] = -1; next.board[mid] = -1; next.board[move.to!] = 0; next.last = [move.to!]
    if (!PEG_SOLITAIRE.moves(next).length) next.winner = next.board.filter(cell => cell === 0).length === 1 ? 0 : null
    return next
  },
  outcome: state => state.winner === undefined ? null : { winner: state.winner, text: state.winner === 0 ? 'One peg left — a perfect game!' : `${state.board.filter(cell => cell === 0).length} pegs left. Try for one.` },
  pieceAt: (state, i) => state.board[i] === 0 ? { owner: 0 } : null,
  lastMove: state => state.last,
  status: state => `${state.board.filter(cell => cell === 0).length} pegs left`,
}
