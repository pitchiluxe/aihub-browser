import { describe, it, expect } from 'vitest'
import { decimate, FACT_SCAN_RATE, scanStep } from './factScan'

describe('decimate', () => {
  it('box-averages across chunk boundaries', () => {
    const out = decimate([Float32Array.from([1, 1, 3]), Float32Array.from([3, 5, 5, 7])], 2)
    expect(Array.from(out)).toEqual([1, 3, 5])
  })
  it('drops an incomplete trailing group', () => {
    expect(decimate([Float32Array.from([1, 2, 3])], 2).length).toBe(1)
  })
})

describe('scan rate', () => {
  it('is 2× — 4× measurably lost accuracy in the 2026-10-12 probe', () => {
    expect(FACT_SCAN_RATE).toBe(2)
  })
})

describe('scanStep — ads never pollute a measurement', () => {
  const base = { ad: false, paused: false, ended: false, t: 10, d: 200 }
  it('records the song, not the ad', () => {
    expect(scanStep(false, base).record).toBe(true)
    expect(scanStep(false, { ...base, ad: true }).record).toBe(false)
  })
  it('the end of an ad is not the end of the song', () => {
    expect(scanStep(false, { ...base, ad: true, t: 14.5, d: 15 }).complete).toBe(false)
    expect(scanStep(false, { ...base, ad: true, ended: true }).complete).toBe(false)
    expect(scanStep(false, { ...base, t: 199.5 }).complete).toBe(true)
  })
  it('re-applies the 2x scan rate when an ad finishes', () => {
    expect(scanStep(true, base).reapplyRate).toBe(true)
    expect(scanStep(false, base).reapplyRate).toBe(false)
  })
})
