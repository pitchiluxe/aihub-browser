import { describe, it, expect } from 'vitest'
import { liveSide, loadTarget } from './deckChoice'

describe('liveSide — which deck the audience hears', () => {
  it('one deck playing: that deck', () => {
    expect(liveSide({ A: true, B: false }, 1)).toBe('A')
    expect(liveSide({ A: false, B: true }, 0)).toBe('B')
  })
  it('both playing (mid-blend): the side the crossfader favours', () => {
    expect(liveSide({ A: true, B: true }, 0.2)).toBe('A')
    expect(liveSide({ A: true, B: true }, 0.8)).toBe('B')
  })
  it('nothing playing: none', () => {
    expect(liveSide({ A: false, B: false }, 0.5)).toBeNull()
  })
})

describe('loadTarget — "load X on deck A" never cuts a playing song', () => {
  it('idle deck: load it', () => {
    expect(loadTarget('A', false, { A: false, B: false })).toEqual({ deck: 'A' })
  })
  it('busy deck, play now: mix it in', () => {
    expect(loadTarget('A', true, { A: true, B: false })).toEqual({ mixin: true })
  })
  it('busy deck, load only: use the other deck when it is free', () => {
    expect(loadTarget('A', false, { A: true, B: false })).toEqual({ deck: 'B', moved: true })
  })
  it('busy deck, load only, both busy: say so', () => {
    expect(loadTarget('B', false, { A: true, B: true })).toEqual({ busy: true })
  })
})
