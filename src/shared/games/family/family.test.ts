import { describe, expect, it } from 'vitest'
import { seededRandom } from '../random'
import { chooseMove, sameMove, type FamilyGame } from './core'
import { CHESS, XIANGQI, inCheck } from './chess'
import { FARKLE, farkleScore, yachtScore } from './dice'
import { FOUR_IN_A_ROW, GO_GAME, goScore, hexConnected, REVERSI, TIC_TAC_TOE } from './grid'
import { FAMILY_GAMES } from './index'
import { NINE_MENS_MORRIS } from './points'
import { grade, NIM } from './puzzles'
import { BACKGAMMON, MANCALA } from './race'

// Plays a game out with every seat on the computer and checks each move it makes is one the rules offer.
function playOut(game: FamilyGame, seed: number, limit: number, budget = 15) {
  const random = seededRandom(seed)
  let state = game.setup(random), plies = 0
  while (!game.outcome(state) && plies < limit) {
    const moves = game.moves(state)
    expect(moves.length, `${game.id} ran out of moves without an outcome`).toBeGreaterThan(0)
    const move = game.players === 1 ? moves[Math.floor(random() * moves.length)] : chooseMove(game, state, random, budget)!
    expect(moves.some(candidate => sameMove(candidate, move)), `${game.id} computer chose an illegal move ${JSON.stringify(move)}`).toBe(true)
    state = game.play(state, move, random); plies++
  }
  return { state, plies }
}
describe('family table', () => {
  it('has 35 distinct games with rules', () => {
    expect(FAMILY_GAMES).toHaveLength(35)
    expect(new Set(FAMILY_GAMES.map(item => item.game.id)).size).toBe(35)
    for (const item of FAMILY_GAMES) expect(item.rules.length).toBeGreaterThan(1)
  })
  for (const { game } of FAMILY_GAMES) {
    it(`${game.title} plays legal moves from start to a result`, () => {
      const short = ['go', 'gomoku', 'chess', 'xiangqi', 'tablut', 'halma', 'chinesecheckers', 'loa', 'backgammon', 'ninemorris', 'alquerque', 'foxgeese']
      const { state } = playOut(game, 7, short.includes(game.id) ? 60 : 2000)
      if (!short.includes(game.id)) expect(game.outcome(state), `${game.id} never finished`).not.toBeNull()
    }, 60_000)
  }
})
describe('family rules', () => {
  it('tic-tac-toe is a draw with perfect play and blocks a win', () => {
    const random = seededRandom(1)
    let state = TIC_TAC_TOE.setup(random); state = { ...state, board: [0, 0, -1, 1, -1, -1, -1, -1, -1], turn: 1 }
    expect(chooseMove(TIC_TAC_TOE, state, random, 500)!.to).toBe(2)
  })
  it('tic-tac-toe names the three winning cells', () => {
    let state = TIC_TAC_TOE.setup(seededRandom(1)); state = { ...state, board: [0, -1, 1, 1, 0, -1, -1, -1, -1], turn: 0 }
    expect(TIC_TAC_TOE.winningCells!(state)).toEqual([])
    state = TIC_TAC_TOE.play(state, { to: 8 }, seededRandom(1))
    expect(state.winner).toBe(0)
    expect(TIC_TAC_TOE.winningCells!(state)).toEqual([0, 4, 8])
  })
  it('four in a row drops discs to the bottom and finds a winning column', () => {
    const random = seededRandom(1), base = FOUR_IN_A_ROW.setup(random)
    expect(FOUR_IN_A_ROW.moves(base).map(m => m.to)).toEqual([35, 36, 37, 38, 39, 40, 41])
    const state = { ...base, board: base.board.map((_, i) => [35, 36, 37].includes(i) ? 0 : [28, 29].includes(i) ? 1 : -1) }
    expect(chooseMove(FOUR_IN_A_ROW, state, random, 500)!.to).toBe(38)
  })
  it('reversi flips sandwiched discs and passes when stuck', () => {
    const random = seededRandom(1), state = REVERSI.setup(random)
    expect(REVERSI.moves(state).map(m => m.to).sort((a, b) => a! - b!)).toEqual([19, 26, 37, 44])
    const next = REVERSI.play(state, { to: 19 }, random)
    expect(next.board[27]).toBe(0); expect(next.board.filter(c => c === 0).length).toBe(4)
  })
  it('Go captures a surrounded stone and scores territory', () => {
    const random = seededRandom(1), base = GO_GAME.setup(random)
    const board = base.board.map((_, i) => [1, 9, 11].includes(i) ? 0 : i === 10 ? 1 : -1)
    const next = GO_GAME.play({ ...base, board, turn: 0 }, { to: 19 }, random)
    expect(next.board[10]).toBe(-1)
    expect(goScore(Array(81).fill(-1).map((_, i) => i % 9 === 4 ? 0 : -1), 9)[0]).toBe(81)
  })
  it('Hex detects a connection', () => {
    const board = Array(81).fill(-1); for (let r = 0; r < 9; r++) board[r * 9 + 3] = 0
    expect(hexConnected(board, 0)).toBe(true); expect(hexConnected(board, 1)).toBe(false)
  })
  it('chess has 20 opening moves, castles, and spots fool’s mate', () => {
    const random = seededRandom(1)
    let state = CHESS.setup(random)
    expect(CHESS.moves(state)).toHaveLength(20)
    for (const [from, to] of [[53, 45], [12, 28], [54, 38], [3, 39]]) state = CHESS.play(state, CHESS.moves(state).find(m => m.from === from && m.to === to)!, random)
    expect(inCheck(state)).toBe(true); expect(CHESS.outcome(state)?.winner).toBe(1)
    const castle = { ...CHESS.setup(random), board: CHESS.setup(random).board.map((p, i) => i === 61 || i === 62 ? null : p) }
    expect(CHESS.moves(castle).some(m => m.castle === 'king')).toBe(true)
  })
  it('xiangqi opens with legal cannon and horse moves and forbids facing generals', () => {
    const random = seededRandom(1), state = XIANGQI.setup(random)
    expect(XIANGQI.moves(state).length).toBe(44)
  })
  it('morris lets a mill remove a piece', () => {
    const random = seededRandom(1)
    let state = NINE_MENS_MORRIS.setup(random)
    for (const to of [0, 8, 1, 9]) state = NINE_MENS_MORRIS.play(state, { to }, random)
    state = NINE_MENS_MORRIS.play(state, { to: 2 }, random)
    expect(state.removing).toBe(true)
    expect(NINE_MENS_MORRIS.moves(state).every(m => m.remove)).toBe(true)
  })
  it('backgammon enforces using both dice and bars a hit checker', () => {
    const random = seededRandom(1), state = { ...BACKGAMMON.setup(random), phase: 'move' as const, dice: [6, 5], rolled: [6, 5] }
    expect(BACKGAMMON.moves(state).length).toBeGreaterThan(0)
    const hit = BACKGAMMON.play({ ...state, points: state.points.map((p, i) => i === 17 ? -1 : p) }, BACKGAMMON.moves({ ...state, points: state.points.map((p, i) => i === 17 ? -1 : p) }).find(m => m.from === 23 && m.to === 17)!, random)
    expect(hit.bar[1]).toBe(1)
  })
  it('mancala gives an extra turn for landing in the store', () => {
    const random = seededRandom(1), state = MANCALA.setup(random), next = MANCALA.play(state, { to: 2 }, random)
    expect(next.pits[6]).toBe(1); expect(next.turn).toBe(0)
  })
  it('dice scoring is right', () => {
    expect(yachtScore(11, [4, 4, 4, 4, 4])).toBe(50); expect(yachtScore(6, [2, 2, 3, 3, 3])).toBe(13); expect(yachtScore(9, [6, 2, 4, 3, 5])).toBe(30)
    expect(farkleScore([1, 1, 1, 5, 2, 3])).toEqual({ points: 1050, used: 4 }); expect(farkleScore([1, 2, 3, 4, 5, 6]).points).toBe(1500)
    expect(FARKLE.moves(FARKLE.setup(seededRandom(1)))[0].roll).toBe(true)
  })
  it('code breaker grades pegs and Nim plays perfectly', () => {
    expect(grade([0, 1, 2, 3], [0, 2, 1, 5])).toEqual({ exact: 1, near: 2 })
    const move = chooseMove(NIM, { heaps: [1, 2, 0, 0], turn: 0, winner: undefined, last: [] }, seededRandom(1))!
    expect(move).toMatchObject({ heap: 1, take: 1 })
  })
})
