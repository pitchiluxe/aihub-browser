import { describe, expect, it } from 'vitest'
import { BOARD_SIZE, canBuild, chooseCircuitAction, circuitAction, circuitActor, circuitRent, JAIL, newCircuit, ownsGroup, PROPERTY_BOARD, tradeValue, type CircuitState } from './property'
import { seededRandom } from './random'

// Dice that land on chosen faces, in order.
const dice = (...faces: number[]) => { let at = 0; return () => (faces[at++ % faces.length] - 1) / 6 + 0.01 }
const fresh = (humans = 1, bots = 1) => newCircuit(humans, bots, seededRandom(7))

describe('Property Circuit board', () => {
  it('has 36 spaces, four corners and eight districts', () => {
    expect(BOARD_SIZE).toBe(36)
    expect([0, 9, 18, 27].map(at => PROPERTY_BOARD[at].type)).toEqual(['start', 'jail', 'rest', 'gotojail'])
    expect(new Set(PROPERTY_BOARD.filter(space => space.type === 'property').map(space => space.group)).size).toBe(8)
    expect(PROPERTY_BOARD.filter(space => space.type === 'station')).toHaveLength(4)
    expect(PROPERTY_BOARD.filter(space => space.type === 'utility')).toHaveLength(2)
  })
})
describe('Property Circuit turns', () => {
  it('buys a street and passes the turn only when ended', () => {
    const landed = circuitAction(fresh(), { type: 'roll' }, dice(1, 2))
    expect(landed.players[0].position).toBe(3); expect(landed.phase).toBe('buy')
    const bought = circuitAction(landed, { type: 'buy' })
    expect(bought.owners[3]).toBe(0); expect(bought.players[0].cash).toBe(1430)
    expect(circuitAction(bought, { type: 'end' }).current).toBe(1)
  })
  it('rolls again after doubles and jails the third double', () => {
    let state = circuitAction(fresh(), { type: 'roll' }, dice(1, 1))
    expect(state.again).toBe(true); expect(circuitAction(state, { type: 'end' })).toBe(state)
    state = { ...state, phase: 'end' }; state = circuitAction(state, { type: 'roll' }, dice(2, 2))
    state = { ...state, phase: 'end' }; state = circuitAction(state, { type: 'roll' }, dice(3, 3))
    expect(state.players[0].position).toBe(JAIL); expect(state.players[0].jail).toBe(0); expect(state.again).toBe(false)
  })
  it('leaves the lockup on doubles, by paying, or after three tries', () => {
    const base = fresh(); base.players[0].position = JAIL; base.players[0].jail = 0
    const stuck = circuitAction(base, { type: 'roll' }, dice(1, 2))
    expect(stuck.players[0].position).toBe(JAIL); expect(stuck.phase).toBe('end')
    expect(circuitAction(base, { type: 'roll' }, dice(4, 4)).players[0].position).toBe(JAIL + 8)
    const paid = circuitAction(base, { type: 'payJail' })
    expect(paid.players[0].jail).toBe(-1); expect(paid.players[0].cash).toBe(1450)
    base.players[0].jail = 2
    const forced = circuitAction(base, { type: 'roll' }, dice(1, 2))
    expect(forced.players[0].jail).toBe(-1); expect(forced.players[0].position).toBe(JAIL + 3); expect(forced.players[0].cash).toBe(1450)
  })
  it('collects for passing Launch and sends Go to lockup straight to jail', () => {
    const state = fresh(); state.players[0].position = 34
    expect(circuitAction(state, { type: 'roll' }, dice(1, 2)).players[0].cash).toBe(1700)
    state.players[0].position = 24
    const jailed = circuitAction(state, { type: 'roll' }, dice(1, 2))
    expect(jailed.players[0].position).toBe(JAIL); expect(jailed.players[0].cash).toBe(1500)
  })
})
describe('Property Circuit rent and building', () => {
  const owned = (): CircuitState => { const state = fresh(); state.owners[1] = state.owners[3] = 0; return state }
  it('doubles bare rent for a full district and scales with buildings', () => {
    const state = owned()
    expect(ownsGroup(state, 1)).toBe(true); expect(circuitRent(state, 1, 7)).toBe(PROPERTY_BOARD[1].rents![0] * 2)
    state.levels[1] = 3; expect(circuitRent(state, 1, 7)).toBe(PROPERTY_BOARD[1].rents![3])
    state.mortgaged[3] = true; expect(circuitRent(state, 3, 7)).toBe(0)
  })
  it('requires even building across the district', () => {
    let state = owned()
    state = circuitAction(state, { type: 'build', space: 1 })
    expect(state.levels[1]).toBe(1); expect(canBuild(state, 1)).toBe(false); expect(canBuild(state, 3)).toBe(true)
    expect(circuitAction(state, { type: 'build', space: 1 })).toBe(state)
    expect(circuitAction(state, { type: 'mortgage', space: 3 })).toBe(state)
  })
  it('charges station fares by count and works by dice', () => {
    const state = fresh(); state.owners[5] = state.owners[14] = 0; state.owners[11] = 0
    expect(circuitRent(state, 5, 7)).toBe(50); expect(circuitRent(state, 11, 7)).toBe(28)
    state.owners[25] = 0; expect(circuitRent(state, 11, 7)).toBe(70)
  })
  it('pays rent to the owner when landing', () => {
    const state = owned(); state.current = 1
    const next = circuitAction(state, { type: 'roll' }, dice(1, 2))
    const rent = PROPERTY_BOARD[3].rents![0] * 2
    expect(next.players[1].cash).toBe(1500 - rent); expect(next.players[0].cash).toBe(1500 + rent)
  })
})
describe('Property Circuit auctions, trades and debt', () => {
  it('auctions a declined street to the highest bidder', () => {
    let state = circuitAction(fresh(), { type: 'roll' }, dice(1, 2))
    state = circuitAction(state, { type: 'decline' })
    expect(state.phase).toBe('auction'); expect(circuitActor(state)).toBe(0)
    state = circuitAction(state, { type: 'bid', amount: 40 })
    expect(circuitActor(state)).toBe(1)
    state = circuitAction(state, { type: 'pass' })
    expect(state.owners[3]).toBe(0); expect(state.players[0].cash).toBe(1460); expect(state.phase).toBe('end')
  })
  it('lets the computer value trades that complete a district', () => {
    const state = fresh(); state.owners[1] = 0; state.owners[3] = 1; state.owners[6] = 0
    const fair = { from: 0, to: 1, give: [6], get: [3], cash: 0 }
    expect(tradeValue(state, fair)).toBeLessThan(0)
    const generous = { ...fair, cash: 400 }
    expect(tradeValue(state, generous)).toBeGreaterThan(0)
    const accepted = circuitAction(state, { type: 'offer', trade: generous })
    expect(accepted.owners[3]).toBe(0); expect(accepted.owners[6]).toBe(1); expect(accepted.players[0].cash).toBe(1100)
    expect(circuitAction(state, { type: 'offer', trade: fair }).owners[3]).toBe(1)
  })
  it('puts a short player in debt, and bankruptcy hands assets to the creditor', () => {
    const state = fresh(); state.current = 1; state.owners[3] = 0; state.owners[6] = 1; state.players[1].cash = 2
    let next = circuitAction(state, { type: 'roll' }, dice(1, 2))
    expect(next.phase).toBe('debt')
    next = circuitAction(next, { type: 'mortgage', space: 6 })
    expect(next.phase).toBe('end'); expect(next.players[0].cash).toBe(1500 + PROPERTY_BOARD[3].rents![0])
    state.players[1].cash = 0; state.owners[6] = -1
    const broke = circuitAction(circuitAction(state, { type: 'roll' }, dice(1, 2)), { type: 'bankrupt' })
    expect(broke.phase).toBe('over'); expect(broke.winner).toBe(0)
  })
})
describe('Property Circuit computer player', () => {
  it('plays whole games to completion without stalling', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const random = seededRandom(seed)
      let state = newCircuit(0, 4, random), moves = 0
      while (state.phase !== 'over' && moves < 20_000) {
        const move = chooseCircuitAction(state)
        expect(move).not.toBeNull()
        state = circuitAction(state, move!, random); moves++
      }
      expect(state.phase).toBe('over')
      expect(state.players.filter(player => !player.out).every(player => player.cash >= 0)).toBe(true)
    }
  })
})
