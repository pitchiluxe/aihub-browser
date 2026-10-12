import { describe, it, expect } from 'vitest'
import { validFacts, putFacts } from './facts'

const f = (at: number, over: object = {}) => ({ bpm: 120, bpmConfidence: 1, camelot: '8A', keyConfidence: 0.8, energy: 0.6, introEndSec: 8, outroStartSec: 200, durationSec: 210, playable: true, at, ...over })

describe('validFacts', () => {
  it('accepts well-formed facts and rejects junk', () => {
    expect(validFacts(f(1))).toBe(true)
    expect(validFacts(f(1, { bpm: null, camelot: null }))).toBe(true)
    expect(validFacts(f(1, { bpm: 'fast' }))).toBe(false)
    expect(validFacts(f(1, { energy: 4 }))).toBe(false)
    expect(validFacts(f(1, { camelot: '13Z' }))).toBe(false)
    expect(validFacts(null)).toBe(false)
  })
})

describe('putFacts', () => {
  it('evicts the oldest entries past the cap', () => {
    let all: Record<string, any> = {}
    const id = (i: number) => `yt:video${String(i).padStart(6, '0')}`  // 11-char YouTube ids
    for (let i = 0; i < 6; i++) all = putFacts(all, id(i), f(i) as any, 4)
    expect(Object.keys(all).sort()).toEqual([id(2), id(3), id(4), id(5)])
  })
  it('refuses ids that are not yt:/file: keys', () => {
    expect(Object.keys(putFacts({}, 'javascript:1', f(1) as any))).toEqual([])
  })
})
