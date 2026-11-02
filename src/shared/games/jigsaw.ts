import type { Random } from './random'
// Jigsaw cuts: every inner edge gets a tab that points one way or the other,
// and the two neighbouring pieces share it with opposite signs.
export interface JigsawPiece { row: number; col: number; edges: [number, number, number, number]; x: number; y: number; placed: boolean }
export interface Jigsaw { rows: number; cols: number; width: number; height: number; pieces: JigsawPiece[] }

export function cutJigsaw(rows: number, cols: number, width: number, height: number, random: Random = Math.random): Jigsaw {
  const horizontal = Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, () => random() < 0.5 ? 1 : -1))
  const vertical = Array.from({ length: rows }, () => Array.from({ length: cols - 1 }, () => random() < 0.5 ? 1 : -1))
  const pieces: JigsawPiece[] = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    // Edge order: top, right, bottom, left. +1 is a tab sticking out, −1 a hole, 0 the border.
    const edges: [number, number, number, number] = [row ? -horizontal[row - 1][col] : 0, col < cols - 1 ? vertical[row][col] : 0, row < rows - 1 ? horizontal[row][col] : 0, col ? -vertical[row][col - 1] : 0]
    pieces.push({ row, col, edges, x: 0, y: 0, placed: false })
  }
  return { rows, cols, width, height, pieces }
}
/** Deals the pieces into loose rows in the tray to the right of the board, shuffled and slightly askew. */
export function scatter(puzzle: Jigsaw, trayWidth: number, random: Random = Math.random): Jigsaw {
  const w = puzzle.width / puzzle.cols, h = puzzle.height / puzzle.rows, count = puzzle.pieces.length
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * trayWidth / puzzle.height))), rows = Math.ceil(count / columns)
  const stepX = (trayWidth - w - 30) / Math.max(1, columns - 1), stepY = (puzzle.height - h) / Math.max(1, rows - 1)
  const slots = Array.from({ length: count }, (_, i) => i).sort(() => random() - 0.5)
  return { ...puzzle, pieces: puzzle.pieces.map((piece, i) => {
    const slot = slots[i], jitter = () => (random() - 0.5) * Math.min(w, h) * 0.25
    return { ...piece, placed: false, x: puzzle.width + 30 + (slot % columns) * stepX + jitter(), y: Math.max(0, Math.min(puzzle.height - h, Math.floor(slot / columns) * stepY + jitter())) }
  }) }
}
/** The outline of one piece, in its own coordinates with the cell at (0,0)–(w,h). */
export function piecePath(edges: [number, number, number, number], w: number, h: number): string {
  const side = (x0: number, y0: number, x1: number, y1: number, sign: number) => {
    if (!sign) return `L${x1} ${y1}`
    const dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy), nx = dy / length, ny = -dx / length, at = (t: number, out: number) => `${x0 + dx * t + nx * out * sign * length} ${y0 + dy * t + ny * out * sign * length}`
    return `L${at(0.36, 0)}C${at(0.42, 0.02)} ${at(0.32, 0.2)} ${at(0.5, 0.22)}C${at(0.68, 0.2)} ${at(0.58, 0.02)} ${at(0.64, 0)}L${x1} ${y1}`
  }
  const [top, right, bottom, left] = edges
  return `M0 0${side(0, 0, w, 0, top)}${side(w, 0, w, h, right)}${side(w, h, 0, h, bottom)}${side(0, h, 0, 0, left)}Z`
}
export const SNAP = 18
// Pieces behave as if a magnet sat in their home cell: within MAGNET of a piece's
// size the pull starts, growing as it gets closer, and inside SNAP_SHARE it clicks in.
export const MAGNET = 0.6, SNAP_SHARE = 0.26
const reach = (puzzle: Jigsaw) => Math.min(puzzle.width / puzzle.cols, puzzle.height / puzzle.rows)
const home = (puzzle: Jigsaw, index: number) => { const piece = puzzle.pieces[index]; return { tx: piece.col * puzzle.width / puzzle.cols, ty: piece.row * puzzle.height / puzzle.rows } }
/** Where a dragged piece shows when the pointer puts it at (x, y): drawn toward its home once it is near. */
export function magnetPull(puzzle: Jigsaw, index: number, x: number, y: number): { x: number; y: number; strength: number } {
  const { tx, ty } = home(puzzle, index), radius = reach(puzzle) * MAGNET, distance = Math.hypot(x - tx, y - ty)
  if (distance >= radius) return { x, y, strength: 0 }
  const strength = (1 - distance / radius) ** 2 * 0.85
  return { x: x + (tx - x) * strength, y: y + (ty - y) * strength, strength }
}
export function tryPlace(puzzle: Jigsaw, index: number, x: number, y: number): { puzzle: Jigsaw; snapped: boolean } {
  const { tx, ty } = home(puzzle, index), snapped = Math.hypot(x - tx, y - ty) < Math.max(SNAP, reach(puzzle) * SNAP_SHARE)
  const pieces = puzzle.pieces.map((other, i) => i === index ? { ...other, x: snapped ? tx : x, y: snapped ? ty : y, placed: snapped } : other)
  return { puzzle: { ...puzzle, pieces }, snapped }
}
export const jigsawDone = (puzzle: Jigsaw) => puzzle.pieces.every(piece => piece.placed)
