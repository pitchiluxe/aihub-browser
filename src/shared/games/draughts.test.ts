import { describe, expect, it } from 'vitest'
import { applyDraughts, chooseDraughtsMove, legalDraughtsMoves, newDraughts, type DraughtsState, type DraughtsVariant } from './draughts'
import { seededRandom } from './random'

// Builds a position from rows of text: w/b men, W/B kings, '.' empty.
function position(variant: DraughtsVariant, rows: string[], turn: 1 | -1 = 1): DraughtsState {
  const board = rows.join('').split('').map(c => ({ w: 1, W: 2, b: -1, B: -2 } as Record<string, number>)[c] || 0)
  return { ...newDraughts(variant), board, turn }
}
const sq = (size: number, x: number, y: number) => y * size + x

describe('draughts', () => {
  it('sets up both variants on dark squares', () => {
    for (const [variant, size, men] of [['checkers', 8, 12], ['dames', 10, 20]] as const) {
      const state = newDraughts(variant)
      expect(state.size).toBe(size)
      expect(state.board.filter(p => p === 1)).toHaveLength(men)
      expect(state.board.filter(p => p === -1)).toHaveLength(men)
      expect(state.board.every((p, i) => !p || (i % size + Math.floor(i / size)) % 2 === 1)).toBe(true)
      expect(legalDraughtsMoves(state).length).toBeGreaterThan(0)
    }
  })
  it('forces a capture and chains jumps', () => {
    const state = position('checkers', ['........', '........', '........', '..b.....', '........', '..b.....', '.w......', '........'])
    const moves = legalDraughtsMoves(state)
    expect(moves).toHaveLength(1)
    expect(moves[0].path).toEqual([sq(8, 3, 4), sq(8, 1, 2)])
    expect(moves[0].captures).toHaveLength(2)
    const next = applyDraughts(state, moves[0])
    expect(next.board.filter(p => p < 0)).toHaveLength(0)
    expect(next.over).toBe(true); expect(next.winner).toBe(1)
  })
  it('lets dames men capture backwards but not checkers men', () => {
    const rows = ['........', '........', '........', '........', '...w....', '....b...', '........', '...b....']
    expect(legalDraughtsMoves(position('checkers', rows)).every(move => !move.captures.length)).toBe(true)
    const dames = position('dames', ['..........', '..........', '..........', '..........', '...w......', '....b.....', '..........', '.......b..', '..........', '..........'])
    expect(legalDraughtsMoves(dames)[0].captures).toEqual([sq(10, 4, 5)])
  })
  it('requires the longest capture in dames', () => {
    const state = position('dames', [
      '..........', '..........', '...b......', '..........', '.b...b....', '..........', '...b...b..', '....w.....', '..........', '..........'])
    const moves = legalDraughtsMoves(state)
    expect(moves.every(move => move.captures.length === Math.max(...moves.map(m => m.captures.length)))).toBe(true)
    expect(moves[0].captures.length).toBeGreaterThanOrEqual(2)
  })
  it('flies dames kings and captures from a distance', () => {
    const state = position('dames', ['..........', '..........', '..........', '..........', '..........', '..........', '..........', '..b.......', '..........', 'W.........'])
    const moves = legalDraughtsMoves(state)
    expect(moves.every(move => move.captures.includes(sq(10, 2, 7)))).toBe(true)
    expect(moves.map(move => move.path.at(-1)).sort((a, b) => a! - b!)).toEqual([sq(10, 3, 6), sq(10, 4, 5), sq(10, 5, 4), sq(10, 6, 3), sq(10, 7, 2), sq(10, 8, 1), sq(10, 9, 0)].sort((a, b) => a - b))
  })
  it('crowns a man that reaches the far row', () => {
    const state = position('checkers', ['........', '..w.....', '........', '........', '........', '........', '........', 'b.......'])
    const next = applyDraughts(state, legalDraughtsMoves(state).find(move => move.path[0] === sq(8, 1, 0))!)
    expect(next.board[sq(8, 1, 0)]).toBe(2)
    expect(next.turn).toBe(-1)
  })
  it('declares a win when the opponent cannot move', () => {
    const state = position('checkers', ['........', '........', '........', '........', '........', 'b.......', '.w......', '..w.....'], -1)
    expect(legalDraughtsMoves(state)).toHaveLength(0)
  })
  it('computer opponent picks a legal move and takes free material', () => {
    const state = position('checkers', ['........', '........', '...b....', '....w...', '........', '........', '........', 'w.......'], -1)
    const move = chooseDraughtsMove(state, seededRandom(4))!
    expect(legalDraughtsMoves(state)).toContainEqual(move)
    expect(move.captures).toHaveLength(1)
    const opening = newDraughts('dames')
    expect(legalDraughtsMoves(opening)).toContainEqual(chooseDraughtsMove(opening, seededRandom(1)))
  })
})
