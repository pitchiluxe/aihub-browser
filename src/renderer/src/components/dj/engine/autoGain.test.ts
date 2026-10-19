import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { autoGainFor } from './DjEngine'

const src = fs.readFileSync('src/renderer/src/components/dj/engine/DjEngine.ts', 'utf8')

describe('auto-gain never turns up a song the listener is hearing', () => {
  it('a quiet stream would be boosted up to 4x — far too much to apply mid-song', () => {
    expect(autoGainFor(0.05)).toBe(4)
  })

  it('a streamed song is levelled only while it cannot be heard', () => {
    // The live measurement (~24 s into playback) is the only auto-gain that can land mid-song.
    const live = src.slice(src.indexOf('private async measureTempo()'))
    expect(live).toMatch(/if \(this\.autoGain === 1 && !this\.audible\(\)\)/)
  })

  it('audible means playing with the channel fader and crossfader side open', () => {
    expect(src).toMatch(/audible\(\): boolean \{\s*return this\.playing && faderGain\(this\.volume\) \* this\.xfade\.gain\.value > 0\.05/)
  })
})
