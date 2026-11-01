import { describe, expect, it } from 'vitest'
import { challengeCode, dailySeed, echoStep, newEcho, newOrbit, newQuake, orbitStep, parseChallenge, quakeMatches, quakePick, quakeTick, type EchoDirection } from './originals'

describe('Originals challenge codes', () => {
  it('roundtrips unsigned seed boundaries for each game', () => {
    for (const id of ['echo', 'orbit', 'rulequake'] as const) for (const seed of [0, 1, 42, 0x7fffffff, 0xffffffff]) expect(parseChallenge(id, challengeCode(id, seed).toLowerCase())).toBe(seed)
  })
  it('rejects wrong-game, overflowing and malformed codes', () => {
    for (const code of ['RQ-0000001', 'EH-ZZZZZZZ', 'EH-1', 'EH-00000!1', 'EH--000001']) expect(parseChallenge('echo', code)).toBeNull()
  })
  it('gives each day and game a reproducible distinct setup', () => {
    expect(dailySeed('echo', '2026-11-01')).toBe(dailySeed('echo', '2026-11-01'))
    expect(dailySeed('echo', '2026-11-01')).not.toBe(dailySeed('echo', '2026-11-02'))
    expect(dailySeed('orbit', '2026-11-01')).not.toBe(dailySeed('echo', '2026-11-01'))
  })
})
describe('Echo Heist', () => {
  it('deals five distinct crystals off the player and reproduces moves', () => {
    let a = newEcho(42), b = newEcho(42)
    expect(new Set(a.crystals).size).toBe(5); expect(a.crystals).not.toContain(a.player)
    for (const direction of ['right', 'up', 'left', 'down'] as EchoDirection[]) { a = echoStep(a, direction); b = echoStep(b, direction) }
    expect(a).toEqual(b)
  })
  it('blocks edge wrapping without spending a turn', () => {
    const state = { ...newEcho(1), player: 0 }
    expect(echoStep(state, 'left')).toBe(state); expect(echoStep(state, 'up')).toBe(state)
  })
  it('collects and replenishes crystals without mutating the old state', () => {
    const state = { ...newEcho(1), crystals: [25, 0, 1, 2, 3] }, result = echoStep(state, 'right')
    expect(result.score).toBe(100); expect(result.crystals).toHaveLength(5); expect(result.crystals).not.toContain(25)
    expect(state.player).toBe(24); expect(state.turn).toBe(0)
  })
  it('collides with the delayed echo and clamps score at zero', () => {
    let state = { ...newEcho(1), hearts: 1, crystals: [] as number[] }
    for (const direction of ['right', 'up', 'left'] as EchoDirection[]) state = echoStep(state, direction)
    const result = echoStep(state, 'down')
    expect(result.hearts).toBe(0); expect(result.over).toBe(true); expect(result.score).toBe(0)
    expect(echoStep(result, 'left')).toBe(result)
  })
  it('ends after exactly 36 legal moves', () => {
    const result = echoStep({ ...newEcho(1), turn: 35 }, 'up')
    expect(result.turn).toBe(36); expect(result.over).toBe(true)
  })
})
describe('Orbit Auction', () => {
  it('reproduces a complete action sequence', () => {
    let a = newOrbit(987), b = newOrbit(987)
    for (const action of ['coast', 'reverse', 'coast', 'bank'] as const) { a = orbitStep(a, action); b = orbitStep(b, action) }
    expect(a).toEqual(b); expect(a.over).toBe(true)
  })
  it('spends fuel only when reversing and rejects a dry reversal', () => {
    const reversed = orbitStep(newOrbit(1), 'reverse')
    expect(reversed.player).toBe(11); expect(reversed.fuel).toBe(5); expect(reversed.direction).toBe(-1)
    const dry = { ...newOrbit(1), fuel: 0 }; expect(orbitStep(dry, 'reverse')).toBe(dry)
    expect(orbitStep(dry, 'coast').turn).toBe(1)
  })
  it('collects and replaces stars while preserving distinct positions', () => {
    const result = orbitStep({ ...newOrbit(1), stars: [1, 3, 7, 9] }, 'coast')
    expect(result.cargo).toBe(100); expect(new Set(result.stars).size).toBe(4); expect(result.stars).not.toContain(1)
  })
  it('drifts stars every third beat', () => {
    const result = orbitStep({ ...newOrbit(1), turn: 2, stars: [2, 4, 7, 9] }, 'coast')
    expect(result.stars).toEqual([3, 5, 8, 10])
  })
  it('handles same-slot collisions and crossing the storm', () => {
    for (const hazard of [1, 2]) {
      const result = orbitStep({ ...newOrbit(1), hazard, stars: [], cargo: 400 }, 'coast')
      expect(result.cargo).toBe(200); expect(result.shields).toBe(2)
    }
  })
  it('banks all cargo voluntarily and rescues half at timeout', () => {
    const state = { ...newOrbit(1), cargo: 501, stars: [] }
    expect(orbitStep(state, 'bank').score).toBe(501)
    const expired = orbitStep({ ...state, turn: 23 }, 'coast')
    expect(expired.score).toBe(250); expect(expired.over).toBe(true)
    expect(orbitStep(expired, 'bank')).toBe(expired)
  })
})
describe('Rulequake', () => {
  it('implements AND, exclusive OR, and negation with parity exactly', () => {
    const tile = { color: 0, shape: 1, value: 4 }, base = { color: 0, shape: 1, even: true }
    expect(quakeMatches(tile, { ...base, kind: 'and' })).toBe(true)
    expect(quakeMatches(tile, { ...base, kind: 'xor' })).toBe(false)
    expect(quakeMatches(tile, { ...base, shape: 2, kind: 'xor' })).toBe(true)
    expect(quakeMatches(tile, { ...base, shape: 2, kind: 'not' })).toBe(true)
    expect(quakeMatches(tile, { ...base, shape: 2, even: false, kind: 'not' })).toBe(false)
  })
  it('guarantees a valid answer across seeds and rule rotations', () => {
    for (let seed = 0; seed < 100; seed++) {
      let state = newQuake(seed)
      for (let round = 0; round < 30; round++) {
        const index = state.board.findIndex(tile => quakeMatches(tile, state.rule))
        expect(index).toBeGreaterThanOrEqual(0)
        state = quakePick(state, index)
      }
      expect(state.round).toBe(30); expect(state.combo).toBe(30)
    }
  })
  it('reproduces deals, caps streak bonuses, and rotates rule types', () => {
    const state = newQuake(42), index = state.board.findIndex(tile => quakeMatches(tile, state.rule))
    expect(quakePick(state, index)).toEqual(quakePick(newQuake(42), index))
    expect(quakePick(state, index).rule.kind).toBe('xor')
    expect(quakePick({ ...state, combo: 100 }, index).score).toBe(300)
  })
  it('penalizes errors and ends on the last heart', () => {
    const state = { ...newQuake(3), hearts: 1, combo: 4 }
    const wrong = state.board.findIndex(tile => !quakeMatches(tile, state.rule))
    expect(wrong).toBeGreaterThanOrEqual(0)
    const result = quakePick(state, wrong)
    expect(result.hearts).toBe(0); expect(result.remaining).toBe(410); expect(result.combo).toBe(0); expect(result.over).toBe(true)
  })
  it('expires after 450 ticks and ignores invalid or post-game picks', () => {
    let state = newQuake(1)
    for (const invalid of [-1, .5, 16, NaN]) expect(quakePick(state, invalid)).toBe(state)
    for (let tick = 0; tick < 450; tick++) state = quakeTick(state)
    expect(state.remaining).toBe(0); expect(state.over).toBe(true)
    expect(quakeTick(state)).toBe(state); expect(quakePick(state, 0)).toBe(state)
  })
})
