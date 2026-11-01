import { describe, expect, it } from 'vitest'
import { chooseLudoMove, legalLudoMoves, LUDO_HOME, LUDO_SAFE, ludoSquare, moveLudo, newLudo, rollLudo, type LudoState } from './ludo'

const withTokens = (state: LudoState, tokens: number[][], current = 0): LudoState =>
  ({ ...state, current, players: state.players.map((player, i) => ({ ...player, tokens: tokens[i] ?? player.tokens })) })

describe('Ludo', () => {
  it('seats two players opposite each other with every pawn in the yard', () => {
    const state = newLudo()
    expect(state.players.map(player => player.seat)).toEqual([0, 2])
    expect(state.players.every(player => player.tokens.every(progress => progress === -1))).toBe(true)
    expect(newLudo(2, 4).players.map(player => player.bot)).toEqual([false, false, true, true])
  })
  it('needs a 6 to leave the yard and passes the turn otherwise', () => {
    const missed = rollLudo(newLudo(), Math.random, 4)
    expect(missed.current).toBe(1); expect(missed.phase).toBe('roll')
    const six = rollLudo(newLudo(), Math.random, 6)
    expect(legalLudoMoves(six)).toEqual([0, 1, 2, 3])
    const out = moveLudo(six, 0)
    expect(out.players[0].tokens[0]).toBe(0)
    expect(out.current).toBe(0); expect(out.phase).toBe('roll')
  })
  it('three 6s in a row forfeit the turn', () => {
    let state = withTokens(newLudo(), [[10, -1, -1, -1]])
    for (let i = 0; i < 2; i++) state = moveLudo(rollLudo(state, Math.random, 6), 0)
    expect(state.sixes).toBe(2)
    state = rollLudo(state, Math.random, 6)
    expect(state.current).toBe(1); expect(state.players[0].tokens[0]).toBe(22)
  })
  it('captures on ordinary squares, never on safe ones, and grants another roll', () => {
    // Red's progress 3 is track square 43; yellow reaches 43 at progress 29.
    expect(ludoSquare(0, 3)).toBe(ludoSquare(2, 29))
    const state = { ...withTokens(newLudo(), [[1, -1, -1, -1], [29, -1, -1, -1]]), dice: 2, phase: 'move' as const }
    const next = moveLudo(state, 0)
    expect(next.players[1].tokens[0]).toBe(-1)
    expect(next.current).toBe(0); expect(next.phase).toBe('roll')
    const safeSquare = ludoSquare(0, 8)!
    expect(LUDO_SAFE.has(safeSquare)).toBe(true)
    const yellowOnSafe = (safeSquare - 14 + 52) % 52
    const safe = moveLudo({ ...withTokens(newLudo(), [[5, -1, -1, -1], [yellowOnSafe, -1, -1, -1]]), dice: 3, phase: 'move' }, 0)
    expect(safe.players[1].tokens[0]).toBe(yellowOnSafe)
  })
  it('needs an exact roll to reach home and wins with all four pawns home', () => {
    const near = { ...withTokens(newLudo(), [[53, LUDO_HOME, LUDO_HOME, LUDO_HOME]]), dice: 5, phase: 'move' as const }
    expect(legalLudoMoves(near)).toEqual([])
    const done = moveLudo({ ...near, dice: 3 }, 0)
    expect(done.phase).toBe('over'); expect(done.winner).toBe(0)
  })
  it('home-column pawns are safe from capture', () => {
    expect(ludoSquare(0, 51)).toBeNull(); expect(ludoSquare(0, -1)).toBeNull()
  })
  it('computer prefers a capture', () => {
    const state = { ...withTokens(newLudo(), [[-1, -1, -1, -1], [1, 40, -1, -1]], 1), dice: 2, phase: 'move' as const }
    const square = ludoSquare(2, 3)!
    const red = (square - 40 + 52) % 52
    const target = withTokens(state, [[red, -1, -1, -1], [1, 40, -1, -1]], 1)
    expect(chooseLudoMove(target)).toBe(0)
    expect(moveLudo(target, chooseLudoMove(target)!).players[0].tokens[0]).toBe(-1)
  })
})
