import type { FamilyGame, Move } from './core'
// Chess and Xiangqi. Pieces are letters: uppercase for the first player
// (White / Red), lowercase for the second (Black).
export interface ChessState { board: (string | null)[]; turn: number; castling: string; enPassant: number; quiet: number; last: number[]; winner: number | null | undefined; reason: string }
const isMine = (piece: string | null, turn: number) => !!piece && (turn === 0 ? piece === piece.toUpperCase() : piece === piece.toLowerCase())
const isTheirs = (piece: string | null, turn: number) => !!piece && !isMine(piece, turn)
const rc = (cols: number, i: number) => [Math.floor(i / cols), i % cols]

/* ── Chess ── */
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]], KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]], BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const on = (r: number, c: number) => r >= 0 && c >= 0 && r < 8 && c < 8
function attacked(board: (string | null)[], index: number, byTurn: number): boolean {
  const [r, c] = rc(8, index), own = (p: string) => byTurn === 0 ? p.toUpperCase() : p.toLowerCase()
  const at = (rr: number, cc: number) => on(rr, cc) ? board[rr * 8 + cc] : null
  const pawnRow = byTurn === 0 ? r + 1 : r - 1
  if ([-1, 1].some(dc => at(pawnRow, c + dc) === own('p'))) return true
  if (KNIGHT.some(([dr, dc]) => at(r + dr, c + dc) === own('n'))) return true
  if (KING.some(([dr, dc]) => at(r + dr, c + dc) === own('k'))) return true
  for (const [dirs, kinds] of [[ROOK, ['r', 'q']], [BISHOP, ['b', 'q']]] as [number[][], string[]][]) for (const [dr, dc] of dirs) {
    for (let k = 1; ; k++) { const p = at(r + dr * k, c + dc * k); if (!on(r + dr * k, c + dc * k)) break; if (p) { if (kinds.map(own).includes(p)) return true; break } }
  }
  return false
}
const kingIndex = (board: (string | null)[], turn: number) => board.indexOf(turn === 0 ? 'K' : 'k')
export const inCheck = (state: ChessState) => attacked(state.board, kingIndex(state.board, state.turn), 1 - state.turn)
function pseudoMoves(state: ChessState): Move[] {
  const { board, turn } = state, moves: Move[] = []
  board.forEach((piece, from) => {
    if (!isMine(piece, turn)) return
    const [r, c] = rc(8, from), kind = piece!.toLowerCase()
    const add = (to: number, extra: Partial<Move> = {}) => moves.push({ from, to, ...extra })
    if (kind === 'p') {
      const dir = turn === 0 ? -1 : 1, start = turn === 0 ? 6 : 1, last = turn === 0 ? 0 : 7
      const push = (to: number) => Math.floor(to / 8) === last ? add(to, { promote: turn === 0 ? 'Q' : 'q' }) : add(to)
      if (on(r + dir, c) && !board[(r + dir) * 8 + c]) { push((r + dir) * 8 + c); if (r === start && !board[(r + 2 * dir) * 8 + c]) add((r + 2 * dir) * 8 + c, { double: true }) }
      for (const dc of [-1, 1]) { if (!on(r + dir, c + dc)) continue; const to = (r + dir) * 8 + c + dc; if (isTheirs(board[to], turn)) push(to); else if (to === state.enPassant) add(to, { enPassant: true }) }
    } else if (kind === 'n' || kind === 'k') {
      for (const [dr, dc] of kind === 'n' ? KNIGHT : KING) { if (!on(r + dr, c + dc)) continue; const to = (r + dr) * 8 + c + dc; if (!isMine(board[to], turn)) add(to) }
      if (kind === 'k' && !attacked(board, from, 1 - turn)) {
        const row = turn === 0 ? 56 : 0, rights = turn === 0 ? ['K', 'Q'] : ['k', 'q']
        if (state.castling.includes(rights[0]) && !board[row + 5] && !board[row + 6] && !attacked(board, row + 5, 1 - turn)) add(row + 6, { castle: 'king' })
        if (state.castling.includes(rights[1]) && !board[row + 1] && !board[row + 2] && !board[row + 3] && !attacked(board, row + 3, 1 - turn)) add(row + 2, { castle: 'queen' })
      }
    } else {
      const dirs = kind === 'r' ? ROOK : kind === 'b' ? BISHOP : [...ROOK, ...BISHOP]
      for (const [dr, dc] of dirs) for (let k = 1; on(r + dr * k, c + dc * k); k++) { const to = (r + dr * k) * 8 + c + dc * k; if (isMine(board[to], turn)) break; add(to); if (board[to]) break }
    }
  })
  return moves
}
function apply(state: ChessState, move: Move): ChessState {
  const board = [...state.board], piece = board[move.from!]!, from = move.from!, to = move.to!
  const captured = board[to] || move.enPassant
  board[to] = (move.promote as string) || piece; board[from] = null
  if (move.enPassant) board[to + (state.turn === 0 ? 8 : -8)] = null
  if (move.castle) { const row = state.turn === 0 ? 56 : 0; if (move.castle === 'king') { board[row + 5] = board[row + 7]; board[row + 7] = null } else { board[row + 3] = board[row]; board[row] = null } }
  let castling = state.castling
  if (piece === 'K') castling = castling.replace(/[KQ]/g, ''); if (piece === 'k') castling = castling.replace(/[kq]/g, '')
  for (const [square, right] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']] as [number, string][]) if (from === square || to === square) castling = castling.replace(right, '')
  return { board, turn: 1 - state.turn, castling, enPassant: move.double ? (from + to) / 2 : -1, quiet: piece.toLowerCase() === 'p' || captured ? 0 : state.quiet + 1, last: [from, to], winner: undefined, reason: '' }
}
function legal(state: ChessState): Move[] { return pseudoMoves(state).filter(move => { const next = apply(state, move); return !attacked(next.board, kingIndex(next.board, state.turn), next.turn) }) }
const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
export const CHESS: FamilyGame<ChessState> = {
  id: 'chess', title: 'Chess', players: 2, names: ['White', 'Black'], colors: ['#f6efe0', '#1d1d24'], depth: 3, layout: { kind: 'grid', rows: 8, cols: 8, style: 'checker' },
  setup: () => ({ board: [...'rnbqkbnrpppppppp', ...Array(32).fill(null), ...'PPPPPPPPRNBQKBNR'], turn: 0, castling: 'KQkq', enPassant: -1, quiet: 0, last: [], winner: undefined, reason: '' }),
  current: state => state.turn,
  moves: state => state.winner !== undefined ? [] : legal(state),
  play: (state, move) => {
    const next = apply(state, move)
    if (!legal(next).length) { if (inCheck(next)) { next.winner = state.turn; next.reason = 'Checkmate' } else { next.winner = null; next.reason = 'Stalemate' } }
    else if (next.quiet >= 100) { next.winner = null; next.reason = 'Fifty quiet moves' }
    else if (next.board.filter(Boolean).every(p => p!.toLowerCase() === 'k' || p!.toLowerCase() === 'n' || p!.toLowerCase() === 'b') && next.board.filter(Boolean).length <= 3) { next.winner = null; next.reason = 'Not enough material' }
    return next
  },
  outcome: state => state.winner === undefined ? null : { winner: state.winner, text: `${state.reason}. ${state.winner === null ? 'A draw.' : `${['White', 'Black'][state.winner]} wins.`}` },
  pieceAt: (state, i) => { const p = state.board[i]; return p ? { owner: p === p.toUpperCase() ? 0 : 1, glyph: ({ k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } as Record<string, string>)[p.toLowerCase()] } : null },
  lastMove: state => state.last,
  evaluate: (state, me) => state.board.reduce((sum, p, i) => {
    if (!p) return sum
    const owner = p === p.toUpperCase() ? 0 : 1, [r, c] = rc(8, i), centre = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5))
    const advance = p.toLowerCase() === 'p' ? (owner === 0 ? 6 - r : r - 1) * 8 : 0
    return sum + (owner === me ? 1 : -1) * (VALUE[p.toLowerCase()] + centre * 6 + advance)
  }, 0),
  status: state => state.winner === undefined && inCheck(state) ? `${['White', 'Black'][state.turn]} is in check!` : '',
}

/* ── Xiangqi (Chinese chess) on a 9 × 10 grid of points ── */
const XC = 9, XR = 10, xon = (r: number, c: number) => r >= 0 && c >= 0 && r < XR && c < XC
const inPalace = (turn: number, r: number, c: number) => c >= 3 && c <= 5 && (turn === 0 ? r >= 7 : r <= 2)
const ownSide = (turn: number, r: number) => turn === 0 ? r >= 5 : r <= 4
function xPseudo(state: ChessState): Move[] {
  const { board, turn } = state, moves: Move[] = []
  board.forEach((piece, from) => {
    if (!isMine(piece, turn)) return
    const [r, c] = rc(XC, from), kind = piece!.toLowerCase()
    const add = (rr: number, cc: number) => { if (xon(rr, cc) && !isMine(board[rr * XC + cc], turn)) moves.push({ from, to: rr * XC + cc }) }
    if (kind === 'k') for (const [dr, dc] of ROOK) { if (inPalace(turn, r + dr, c + dc)) add(r + dr, c + dc) }
    if (kind === 'a') for (const [dr, dc] of BISHOP) { if (inPalace(turn, r + dr, c + dc)) add(r + dr, c + dc) }
    if (kind === 'e') for (const [dr, dc] of BISHOP) { if (xon(r + dr, c + dc) && !board[(r + dr) * XC + c + dc] && ownSide(turn, r + 2 * dr)) add(r + 2 * dr, c + 2 * dc) }
    if (kind === 'h') for (const [dr, dc] of KNIGHT) { const legR = Math.abs(dr) === 2 ? r + dr / 2 : r, legC = Math.abs(dc) === 2 ? c + dc / 2 : c; if (xon(legR, legC) && !board[legR * XC + legC]) add(r + dr, c + dc) }
    if (kind === 'r' || kind === 'c') for (const [dr, dc] of ROOK) {
      let jumped = false
      for (let k = 1; xon(r + dr * k, c + dc * k); k++) {
        const to = (r + dr * k) * XC + c + dc * k, target = board[to]
        if (kind === 'r') { if (isMine(target, turn)) break; moves.push({ from, to }); if (target) break; continue }
        // The cannon slides like a chariot but captures only by jumping exactly one piece.
        if (!jumped) { if (target) jumped = true; else moves.push({ from, to }) } else if (target) { if (isTheirs(target, turn)) moves.push({ from, to }); break }
      }
    }
    if (kind === 'p') { const forward = turn === 0 ? -1 : 1; add(r + forward, c); if (!ownSide(turn, r)) { add(r, c - 1); add(r, c + 1) } }
  })
  return moves
}
function xInDanger(board: (string | null)[], turn: number): boolean {
  const king = board.indexOf(turn === 0 ? 'K' : 'k'), other = board.indexOf(turn === 0 ? 'k' : 'K')
  if (king < 0) return true
  // Flying general: the two generals may never face each other on an open file.
  if (other >= 0 && king % XC === other % XC) { let blocked = false; for (let i = Math.min(king, other) + XC; i < Math.max(king, other); i += XC) if (board[i]) blocked = true; if (!blocked) return true }
  return xPseudo({ board, turn: 1 - turn, castling: '', enPassant: -1, quiet: 0, last: [], winner: undefined, reason: '' }).some(move => move.to === king)
}
function xApply(state: ChessState, move: Move): ChessState {
  const board = [...state.board], captured = !!board[move.to!]; board[move.to!] = board[move.from!]; board[move.from!] = null
  return { ...state, board, turn: 1 - state.turn, last: [move.from!, move.to!], quiet: captured ? 0 : state.quiet + 1, winner: undefined, reason: '' }
}
const xLegal = (state: ChessState) => xPseudo(state).filter(move => !xInDanger(xApply(state, move).board, state.turn))
const XVALUE: Record<string, number> = { k: 0, a: 20, e: 20, h: 40, r: 90, c: 45, p: 10 }
export const XIANGQI: FamilyGame<ChessState> = {
  id: 'xiangqi', title: 'Xiangqi', players: 2, names: ['Red', 'Black'], colors: ['#c3201f', '#1d1d24'], depth: 3, layout: { kind: 'grid', rows: XR, cols: XC, style: 'xiangqi' },
  setup: () => {
    const board: (string | null)[] = Array(XR * XC).fill(null), back = 'rheakaehr'
    ;[...back].forEach((p, c) => { board[c] = p; board[9 * XC + c] = p.toUpperCase() })
    for (const c of [1, 7]) { board[2 * XC + c] = 'c'; board[7 * XC + c] = 'C' }
    for (const c of [0, 2, 4, 6, 8]) { board[3 * XC + c] = 'p'; board[6 * XC + c] = 'P' }
    return { board, turn: 0, castling: '', enPassant: -1, quiet: 0, last: [], winner: undefined, reason: '' }
  },
  current: state => state.turn,
  moves: state => state.winner !== undefined ? [] : xLegal(state),
  play: (state, move) => {
    const next = xApply(state, move)
    if (!xLegal(next).length) { next.winner = state.turn; next.reason = xInDanger(next.board, next.turn) ? 'Checkmate' : 'No legal move' }
    else if (next.quiet >= 120) { next.winner = null; next.reason = 'Sixty quiet moves each' }
    return next
  },
  outcome: state => state.winner === undefined ? null : { winner: state.winner, text: `${state.reason}. ${state.winner === null ? 'A draw.' : `${['Red', 'Black'][state.winner]} wins.`}` },
  pieceAt: (state, i) => { const p = state.board[i]; if (!p) return null; const red = p === p.toUpperCase(); return { owner: red ? 0 : 1, glyph: (red ? { k: '帥', a: '仕', e: '相', h: '傌', r: '俥', c: '炮', p: '兵' } : { k: '將', a: '士', e: '象', h: '馬', r: '車', c: '砲', p: '卒' } as Record<string, string>)[p.toLowerCase()] } },
  lastMove: state => state.last,
  evaluate: (state, me) => state.board.reduce((sum, p, i) => { if (!p) return sum; const owner = p === p.toUpperCase() ? 0 : 1, crossed = p.toLowerCase() === 'p' && !ownSide(owner, Math.floor(i / XC)) ? 10 : 0; return sum + (owner === me ? 1 : -1) * (XVALUE[p.toLowerCase()] + crossed) }, 0),
  status: state => state.winner === undefined && xInDanger(state.board, state.turn) ? `${['Red', 'Black'][state.turn]}'s general is in check!` : '',
}
