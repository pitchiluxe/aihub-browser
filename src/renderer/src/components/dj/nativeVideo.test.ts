import { describe, it, expect } from 'vitest'
import { pickNativeDeck } from './nativeVideo'

const deck = (id: string, o: Record<string, unknown> = {}) => ({ id, track: { youtubeId: `${id}0000000000` }, active: true, held: false, volume: 1, ...o }) as any

describe('pickNativeDeck — which deck\'s YouTube player is shown directly', () => {
  it('the only live YouTube deck', () => {
    expect(pickNativeDeck([deck('A'), deck('B', { track: null })], 0.5)).toBe('A')
  })
  it('two live decks: the one the crossfader favours (no dissolve with native video)', () => {
    expect(pickNativeDeck([deck('A'), deck('B')], 0.2)).toBe('A')
    expect(pickNativeDeck([deck('A'), deck('B')], 0.8)).toBe('B')
  })
  it('a channel fader pulled down loses the picture to the louder deck', () => {
    expect(pickNativeDeck([deck('A', { volume: 0 }), deck('B')], 0.5)).toBe('B')
  })
  it('a local song or nothing live: no native video (the canvas shows covers and local videos)', () => {
    expect(pickNativeDeck([deck('A', { track: { path: 'x.mp3' } }), deck('B', { track: null })], 0.5)).toBeNull()
    expect(pickNativeDeck([deck('A', { active: false }), deck('B', { active: false })], 0.5)).toBeNull()
  })
})
