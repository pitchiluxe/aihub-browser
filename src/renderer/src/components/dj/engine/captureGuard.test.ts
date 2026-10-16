import { describe, expect, it } from 'vitest'
import { CaptureGuard, SILENT_MS } from './captureGuard'

const LOUD = 0.3
const QUIET = 0

describe('CaptureGuard', () => {
  it('leaves a capture that carries sound alone', () => {
    const g = new CaptureGuard()
    for (let t = 0; t < 30000; t += 20) expect(g.check(t, true, LOUD, false)).toBe('ok')
  })

  it('does not judge a deck that is not meant to be heard', () => {
    const g = new CaptureGuard()
    for (let t = 0; t < 30000; t += 20) expect(g.check(t, false, QUIET, false)).toBe('ok')
  })

  it('captures again after a playing song has been silent, then falls back to the player', () => {
    const g = new CaptureGuard()
    expect(g.check(0, true, QUIET, false)).toBe('ok')
    expect(g.check(SILENT_MS - 20, true, QUIET, false)).toBe('ok')
    expect(g.check(SILENT_MS, true, QUIET, false)).toBe('recapture')
    // The fresh capture gets the same grace before it is given up on.
    expect(g.check(SILENT_MS + 1000, true, QUIET, false)).toBe('ok')
    expect(g.check(2 * SILENT_MS, true, QUIET, false)).toBe('fallback')
  })

  it('forgets the silence once sound comes back', () => {
    const g = new CaptureGuard()
    g.check(0, true, QUIET, false)
    expect(g.check(SILENT_MS, true, QUIET, false)).toBe('recapture')
    expect(g.check(SILENT_MS + 100, true, LOUD, false)).toBe('ok')
    // A later quiet stretch starts over with a fresh capture, not a fallback.
    g.check(20000, true, QUIET, false)
    expect(g.check(20000 + SILENT_MS, true, QUIET, false)).toBe('recapture')
  })

  it('a quiet passage shorter than the grace never touches the capture', () => {
    const g = new CaptureGuard()
    let t = 0
    for (let i = 0; i < 5; i++) {
      for (const end = t + SILENT_MS - 500; t < end; t += 20) expect(g.check(t, true, QUIET, false)).toBe('ok')
      expect(g.check(t, true, LOUD, false)).toBe('ok')
    }
  })

  it('a pause or ad restarts the count', () => {
    const g = new CaptureGuard()
    g.check(0, true, QUIET, false)
    g.check(SILENT_MS - 100, false, QUIET, false)
    expect(g.check(SILENT_MS, true, QUIET, false)).toBe('ok')
  })

  it('captures a dead stream again at once', () => {
    const g = new CaptureGuard()
    expect(g.check(0, true, QUIET, true)).toBe('recapture')
    expect(g.check(20, true, QUIET, true)).toBe('fallback')
  })

  it('reset gives a new song its own fresh capture', () => {
    const g = new CaptureGuard()
    g.check(0, true, QUIET, true)
    g.reset()
    expect(g.check(40, true, QUIET, true)).toBe('recapture')
  })
})
