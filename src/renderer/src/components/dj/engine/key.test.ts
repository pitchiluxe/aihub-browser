import { describe, it, expect } from 'vitest'
import { detectKey, keyFrom, keyMatch, parseKey } from './key'
import { analyze } from './analysis'

/** A sustained triad (root, third, fifth) with a couple of harmonics. */
function chord(rootHz: number, minor: boolean, seconds: number, sr: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sr))
  const third = rootHz * Math.pow(2, (minor ? 3 : 4) / 12)
  const fifth = rootHz * Math.pow(2, 7 / 12)
  for (const [f, g] of [[rootHz, 1], [third, 0.8], [fifth, 0.9], [rootHz * 2, 0.4]] as const) {
    for (let i = 0; i < out.length; i++) out[i] += 0.2 * g * Math.sin((2 * Math.PI * f * i) / sr)
  }
  return out
}

describe('musical key', () => {
  const sr = 22050

  it('maps keys onto the Camelot wheel', () => {
    expect(keyFrom(9, true).camelot).toBe('8A') // A minor
    expect(keyFrom(0, false).camelot).toBe('8B') // C major
    expect(keyFrom(6, true).camelot).toBe('11A') // F# minor
    expect(keyFrom(2, false).camelot).toBe('10B') // D major
  })

  it('detects a minor and a major chord', () => {
    const am = detectKey(chord(220, true, 20, sr), sr)
    expect(am?.camelot).toBe('8A')
    const c = detectKey(chord(261.63, false, 20, sr), sr)
    expect(c?.camelot).toBe('8B')
  })

  it('declines silence and very short clips', () => {
    expect(detectKey(new Float32Array(sr * 30), sr)).toBeNull()
    expect(detectKey(chord(220, true, 3, sr), sr)).toBeNull()
  })

  it('is part of a track analysis', () => {
    expect(analyze([chord(220, true, 20, sr)], sr).key?.camelot).toBe('8A')
  })

  it('reads tags in several spellings', () => {
    expect(parseKey('8A')?.name).toBe('A minor')
    expect(parseKey('Am')?.camelot).toBe('8A')
    expect(parseKey('F#m')?.camelot).toBe('11A')
    expect(parseKey('Db')?.camelot).toBe('3B')
    expect(parseKey('C major')?.camelot).toBe('8B')
    expect(parseKey('nonsense')).toBeNull()
    expect(parseKey('')).toBeNull()
  })

  it('judges how two keys mix', () => {
    const am = parseKey('8A'), em = parseKey('9A'), cmaj = parseKey('8B'), g = parseKey('10A'), far = parseKey('2A')
    expect(keyMatch(am, am)).toBe('perfect')
    expect(keyMatch(am, em)).toBe('smooth')
    expect(keyMatch(am, cmaj)).toBe('smooth')
    expect(keyMatch(am, g)).toBe('energy')
    expect(keyMatch(am, far)).toBe('clash')
    expect(keyMatch(am, null)).toBeNull()
  })
})
