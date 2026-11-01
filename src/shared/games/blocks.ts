import { shuffled, type Random } from './random'
export const BLOCK_SHAPES = [
  [[1, 1, 1, 1]], [[1, 1], [1, 1]], [[0, 1, 0], [1, 1, 1]],
  [[0, 1, 1], [1, 1, 0]], [[1, 1, 0], [0, 1, 1]], [[1, 0, 0], [1, 1, 1]], [[0, 0, 1], [1, 1, 1]],
]
export interface BlockPiece { kind: number; cells: number[][]; x: number; y: number }
export interface BlocksState { board: number[][]; piece: BlockPiece; queue: number[]; hold: number | null; held: boolean; score: number; lines: number; over: boolean }
const pieceFor = (kind: number): BlockPiece => ({ kind, cells: BLOCK_SHAPES[kind].map(row => [...row]), x: 3, y: 0 })
export function newBlocks(random: Random = Math.random): BlocksState {
  const queue = shuffled([0, 1, 2, 3, 4, 5, 6], random)
  return { board: Array.from({ length: 20 }, () => Array(10).fill(0)), piece: pieceFor(queue.shift()!), queue, hold: null, held: false, score: 0, lines: 0, over: false }
}
export function blockFits(board: number[][], piece: BlockPiece): boolean {
  return piece.cells.every((row, y) => row.every((cell, x) => !cell || (piece.x + x >= 0 && piece.x + x < 10 && piece.y + y >= 0 && piece.y + y < 20 && !board[piece.y + y][piece.x + x])))
}
export function clearBlockLines(board: number[][]): { board: number[][]; cleared: number } {
  const kept = board.filter(row => row.some(cell => !cell)).map(row => [...row])
  const cleared = board.length - kept.length
  return { board: [...Array.from({ length: cleared }, () => Array(10).fill(0)), ...kept], cleared }
}
export function ghostPiece(state: BlocksState): BlockPiece {
  let piece = state.piece
  while (blockFits(state.board, { ...piece, y: piece.y + 1 })) piece = { ...piece, y: piece.y + 1 }
  return piece
}
export function blocksAction(state: BlocksState, action: 'left' | 'right' | 'down' | 'rotate' | 'drop' | 'hold' | 'tick', random: Random = Math.random): BlocksState {
  if (state.over) return state
  if (action === 'hold') {
    if (state.held) return state
    const queue = state.queue.length ? [...state.queue] : shuffled([0, 1, 2, 3, 4, 5, 6], random)
    const piece = pieceFor(state.hold ?? queue.shift()!)
    return { ...state, piece, queue, hold: state.piece.kind, held: true, over: !blockFits(state.board, piece) }
  }
  if (action === 'left' || action === 'right') {
    const piece = { ...state.piece, x: state.piece.x + (action === 'left' ? -1 : 1) }
    return blockFits(state.board, piece) ? { ...state, piece } : state
  }
  if (action === 'rotate') {
    const cells = state.piece.cells[0].map((_, x) => state.piece.cells.map(row => row[x]).reverse())
    for (const offset of [0, -1, 1, -2, 2]) {
      const piece = { ...state.piece, cells, x: state.piece.x + offset }
      if (blockFits(state.board, piece)) return { ...state, piece }
    }
    return state
  }
  const landing = action === 'drop' ? ghostPiece(state) : { ...state.piece, y: state.piece.y + 1 }
  if (action !== 'drop' && blockFits(state.board, landing)) return { ...state, piece: landing, score: state.score + (action === 'down' ? 1 : 0) }
  const piece = action === 'drop' ? landing : state.piece
  const board = state.board.map(row => [...row])
  piece.cells.forEach((row, y) => row.forEach((cell, x) => { if (cell) board[piece.y + y][piece.x + x] = piece.kind + 1 }))
  const cleared = clearBlockLines(board)
  const queue = [...state.queue]
  if (queue.length < 7) queue.push(...shuffled([0, 1, 2, 3, 4, 5, 6], random))
  const next = pieceFor(queue.shift()!)
  return { ...state, board: cleared.board, piece: next, queue, held: false,
    score: state.score + ([0, 100, 300, 500, 800][cleared.cleared] || 0) * (1 + Math.floor(state.lines / 10)) + (action === 'drop' ? (piece.y - state.piece.y) * 2 : 0),
    lines: state.lines + cleared.cleared, over: !blockFits(cleared.board, next) }
}
