// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { rosterDelta, soundsEnabled, setSoundsEnabled } from './voiceSounds'

describe('who arrived and who left', () => {
  const SELF = 'me'

  /**
   * The rule this function exists for.
   *
   * Walking into a room where four people are already talking must not fire
   * four arrival chimes at once — which is exactly what diffing the first
   * roster against an empty array does. The first roster is a starting point,
   * not a set of events.
   */
  it('is silent on the first roster it ever sees', () => {
    expect(rosterDelta(null, [SELF, 'a', 'b', 'c', 'd'], SELF))
      .toEqual({ arrived: [], left: [] })
  })

  it('notices somebody arriving', () => {
    expect(rosterDelta([SELF], [SELF, 'a'], SELF))
      .toEqual({ arrived: ['a'], left: [] })
  })

  it('notices somebody leaving', () => {
    expect(rosterDelta([SELF, 'a'], [SELF], SELF))
      .toEqual({ arrived: [], left: ['a'] })
  })

  it('handles an arrival and a departure in the same update', () => {
    expect(rosterDelta([SELF, 'a'], [SELF, 'b'], SELF))
      .toEqual({ arrived: ['b'], left: ['a'] })
  })

  // You are not an event in your own room. Without this, your own join fires
  // an arrival chime at yourself, which sounds like somebody else appearing.
  it('never reports the listener as arriving or leaving', () => {
    expect(rosterDelta([], [SELF], SELF)).toEqual({ arrived: [], left: [] })
    expect(rosterDelta([SELF], [], SELF)).toEqual({ arrived: [], left: [] })
  })

  it('says nothing when the roster has not changed', () => {
    expect(rosterDelta([SELF, 'a', 'b'], [SELF, 'a', 'b'], SELF))
      .toEqual({ arrived: [], left: [] })
  })

  it('reports several at once', () => {
    const out = rosterDelta([SELF, 'a', 'b'], [SELF, 'b', 'c', 'd'], SELF)
    expect(out.arrived).toEqual(['c', 'd'])
    expect(out.left).toEqual(['a'])
  })
})

describe('the preference', () => {
  beforeEach(() => {
    try { window.localStorage.clear() } catch { /* not fatal */ }
  })

  // Sound on by default: a voice room that arrives silent reads as broken
  // rather than as considerate.
  it('is on until somebody turns it off', () => {
    expect(soundsEnabled()).toBe(true)
  })

  it('remembers being turned off, and back on', () => {
    setSoundsEnabled(false)
    expect(soundsEnabled()).toBe(false)
    setSoundsEnabled(true)
    expect(soundsEnabled()).toBe(true)
  })

  // A private window, cleared site data or a browser refusing storage must not
  // throw on the way to answering.
  it('survives localStorage being unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('denied') },
    })
    try {
      expect(soundsEnabled()).toBe(true)
      expect(() => setSoundsEnabled(false)).not.toThrow()
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
