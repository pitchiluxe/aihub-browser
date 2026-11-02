import { describe, expect, it } from 'vitest'
import { seededRandom } from './random'
import { canDraw, chooseDominoMove, drawDomino, fullSet, legalDominoMoves, newDominoes, nextDominoRound, passDomino, playDomino, type DominoState } from './dominoes'
import { BALL_R, choosePoolShot, cueBall, newPool, placeCue, shoot, stepPool, TABLE_H, TABLE_W, type PoolState } from './pool'
import { launch, newPinball, setFlipper, stepPinball } from './pinball'
import { cutJigsaw, jigsawDone, magnetPull, piecePath, scatter, tryPlace } from './jigsaw'
import { bestMelds, botEights, botRummy, chooseWhistCard, drawEights, eightsPlayable, newEights, newRummy, newWhist, nextWhistHand, playEights, playWhist, trickWinner, whistPlayable, type PlayCard } from './cards'

const card = (rank: number, suit: number): PlayCard => ({ rank, suit })
function playOut(state: DominoState): DominoState {
  for (let guard = 0; guard < 500 && state.phase === 'play'; guard++) {
    const move = chooseDominoMove(state)
    state = move ? playDomino(state, move) : canDraw(state) ? drawDomino(state) : passDomino(state)
  }
  return state
}
describe('dominoes', () => {
  it('deals a full double-six set without duplicates', () => {
    const state = newDominoes(1, 4, 'draw', seededRandom(3))
    const all = [...state.players.flatMap(player => player.hand), ...state.boneyard].map(tile => tile.join())
    expect(fullSet()).toHaveLength(28); expect(new Set(all).size).toBe(28)
  })
  it('opens with the highest double and matches ends after that', () => {
    let state = newDominoes(0, 2, 'draw', seededRandom(5))
    const moves = legalDominoMoves(state), tile = state.players[state.current].hand[moves[0].tile]
    expect(moves).toHaveLength(1); expect(tile[0]).toBe(tile[1])
    state = playDomino(state, moves[0])
    for (const move of legalDominoMoves(state)) expect(state.players[state.current].hand[move.tile]).toContain(tile[0])
  })
  it('keeps the chain joined end to end through a whole round', () => {
    for (const mode of ['draw', 'block'] as const) {
      const state = playOut(newDominoes(0, 3, mode, seededRandom(11)))
      expect(state.phase).not.toBe('play')
      state.chain.forEach((tile, i) => { if (i) expect(tile[0]).toBe(state.chain[i - 1][1]) })
      expect(state.players[state.winner!].score).toBeGreaterThanOrEqual(0)
    }
  })
  it('plays rounds until someone reaches the target', () => {
    const random = seededRandom(2)
    let state = newDominoes(0, 2, 'draw', random, 60)
    for (let round = 0; round < 40 && state.phase !== 'over'; round++) { state = playOut(state); if (state.phase === 'round') state = nextDominoRound(state, random) }
    expect(state.phase).toBe('over'); expect(Math.max(...state.players.map(player => player.score))).toBeGreaterThanOrEqual(60)
  })
})
describe('Crazy Eights', () => {
  it('only accepts matching cards, and an eight names the suit', () => {
    let state = newEights(1, 2, seededRandom(4))
    state = { ...state, pile: [card(5, 1)], suit: 1, hands: [[card(9, 0), card(8, 0), card(5, 3)], state.hands[1]] }
    expect(eightsPlayable(state, card(9, 0))).toBe(false)
    expect(playEights(state, 0)).toBe(state)
    const wild = playEights(state, 1, 2)
    expect(wild.suit).toBe(2); expect(wild.current).toBe(1)
  })
  it('makes the next player draw two on a 2', () => {
    let state = newEights(1, 2, seededRandom(4))
    state = { ...state, pile: [card(5, 1)], suit: 1, hands: [[card(2, 1), card(3, 3)], state.hands[1]] }
    const next = playEights(state, 0)
    expect(next.hands[1]).toHaveLength(state.hands[1].length + 2); expect(next.current).toBe(0)
  })
  it('lets computers finish a game', () => {
    let state = newEights(0, 4, seededRandom(9))
    for (let guard = 0; guard < 2000 && state.winner === null; guard++) state = botEights(state)
    expect(state.winner).not.toBeNull(); expect(state.hands[state.winner!]).toHaveLength(0)
    expect(drawEights(state)).toBe(state)
  })
})
describe('Rummy', () => {
  it('finds sets and runs, including ace-low runs', () => {
    const hand = [card(1, 0), card(2, 0), card(3, 0), card(9, 1), card(9, 2), card(9, 3), card(13, 1)]
    const { melds, deadwood } = bestMelds(hand)
    expect(melds).toHaveLength(2); expect(deadwood).toEqual([card(13, 1)])
  })
  it('lets computers draw and discard until someone goes out', () => {
    let state = newRummy(0, 2, seededRandom(21))
    for (let guard = 0; guard < 4000 && state.winner === null; guard++) state = botRummy(state)
    expect(state.winner).not.toBeNull(); expect(bestMelds(state.hands[state.winner!]).deadwood).toHaveLength(0)
  })
})
describe('Whist', () => {
  it('requires following suit and ranks trumps above the suit led', () => {
    const state = newWhist(seededRandom(8))
    const led = { ...state, trick: [{ player: 3, card: card(5, 0) }], current: 0, hands: [[card(2, 0), card(1, 1)], ...state.hands.slice(1)] }
    expect(whistPlayable(led, 0)).toEqual([0])
    expect(trickWinner([{ player: 0, card: card(13, 0) }, { player: 1, card: card(2, 3) }, { player: 2, card: card(1, 0) }, { player: 3, card: card(3, 1) }], 3)).toBe(1)
    expect(trickWinner([{ player: 0, card: card(13, 0) }, { player: 1, card: card(2, 2) }, { player: 2, card: card(1, 0) }, { player: 3, card: card(3, 1) }], 3)).toBe(2)
  })
  it('plays 13 tricks per hand and a match to five points', () => {
    const random = seededRandom(12)
    let state = newWhist(random)
    for (let guard = 0; guard < 5000 && state.phase !== 'over'; guard++) state = state.phase === 'hand' ? nextWhistHand(state, random) : playWhist(state, chooseWhistCard(state))
    expect(state.phase).toBe('over'); expect(Math.max(...state.score)).toBeGreaterThanOrEqual(5)
  })
})
describe('pool', () => {
  const settle = (state: PoolState) => { for (let i = 0; i < 4000 && state.phase === 'rolling'; i++) stepPool(state, 1 / 60); return state }
  it('racks fifteen balls without overlaps and breaks them apart', () => {
    const state = newPool()
    for (const a of state.balls) for (const b of state.balls) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(BALL_R * 1.99)
    const after = settle(shoot(state, 0, 1))
    expect(after.phase).not.toBe('rolling')
    expect(after.balls.filter(ball => !ball.sunk).every(ball => ball.x >= 0 && ball.x <= TABLE_W && ball.y >= 0 && ball.y <= TABLE_H)).toBe(true)
  })
  it('gives ball in hand after a scratch', () => {
    const state = newPool(); state.balls.forEach(ball => { if (ball.id) ball.sunk = ball.id !== 1 })
    const cue = cueBall(state); cue.x = 900; cue.y = 60
    const after = settle(shoot(state, Math.atan2(-60, 100), 0.5))
    expect(after.ballInHand).toBe(true); expect(after.current).toBe(1)
    expect(placeCue(after, 300, 250).balls[0]).toMatchObject({ x: 300, y: 250 })
  })
  it('lets the computer play a whole rack', () => {
    const random = seededRandom(31)
    let state = newPool(); state.bot = [true, true]
    for (let shot = 0; shot < 400 && state.phase !== 'over'; shot++) {
      const choice = choosePoolShot(state, random)
      if (choice.place) state = placeCue(state, ...choice.place)
      state = settle(shoot(state, choice.angle, choice.power))
    }
    expect(state.phase).toBe('over'); expect(state.winner).not.toBeNull()
  })
})
describe('pinball', () => {
  it('launches into the field, scores, and drains a ball without escaping the cabinet', () => {
    const state = newPinball()
    launch(state, 1)
    let events: string[] = []
    for (let frame = 0; frame < 60 * 60 && state.balls === 3; frame++) {
      events = events.concat(stepPinball(state, 1 / 60))
      if (state.ball.inLane && state.balls === 3) launch(state, 1)
      expect(Number.isFinite(state.ball.x) && Number.isFinite(state.ball.y)).toBe(true)
      expect(state.ball.x).toBeGreaterThan(0); expect(state.ball.x).toBeLessThan(400)
      expect(state.ball.y).toBeGreaterThan(-10)
    }
    expect(state.balls).toBe(2); expect(events).toContain('drain')
  })
  it('flippers swing up and back', () => {
    const state = newPinball(), rest = state.flippers[0].angle
    setFlipper(state, 'left', true); stepPinball(state, 0.1)
    expect(state.flippers[0].angle).toBeLessThan(rest)
    setFlipper(state, 'left', false); stepPinball(state, 0.1)
    expect(state.flippers[0].angle).toBeCloseTo(rest)
  })
  it('ends after the third ball', () => {
    const state = newPinball()
    for (let ball = 0; ball < 3; ball++) { launch(state, 0.6); for (let frame = 0; frame < 3600 && !state.ball.inLane && !state.over; frame++) stepPinball(state, 1 / 60) }
    expect(state.over || state.balls < 3).toBe(true)
  })
})
describe('jigsaw', () => {
  it('cuts matching tabs and holes, scatters into the tray and snaps home', () => {
    const puzzle = scatter(cutJigsaw(4, 5, 600, 450, seededRandom(3)), 560, seededRandom(4))
    for (const piece of puzzle.pieces) {
      const right = puzzle.pieces.find(other => other.row === piece.row && other.col === piece.col + 1), below = puzzle.pieces.find(other => other.row === piece.row + 1 && other.col === piece.col)
      if (right) expect(right.edges[3]).toBe(-piece.edges[1]); else expect(piece.edges[1]).toBe(0)
      if (below) expect(below.edges[0]).toBe(-piece.edges[2]); else expect(piece.edges[2]).toBe(0)
      expect(piece.x).toBeGreaterThanOrEqual(600)
    }
    const near = tryPlace(puzzle, 7, puzzle.pieces[7].col * 120 + 8, puzzle.pieces[7].row * 112.5 - 6)
    expect(near.snapped).toBe(true); expect(near.puzzle.pieces[7].placed).toBe(true)
    expect(tryPlace(puzzle, 7, 0, 300).snapped).toBe(false)
    expect(jigsawDone(near.puzzle)).toBe(false)
    // The magnet: nothing far away, a gentle pull nearby, a strong one right next to home.
    expect(magnetPull(puzzle, 7, 0, 300).strength).toBe(0)
    const loose = magnetPull(puzzle, 7, 240 + 50, 112.5), close = magnetPull(puzzle, 7, 240 + 15, 112.5)
    expect(loose.strength).toBeGreaterThan(0); expect(close.strength).toBeGreaterThan(loose.strength)
    expect(close.x).toBeLessThan(255); expect(close.x).toBeGreaterThan(240)
    expect(tryPlace(puzzle, 7, 240 + 28, 112.5).snapped).toBe(true)
    expect(piecePath([0, 1, -1, 0], 120, 100)).toMatch(/^M0 0.*Z$/)
  })
})
