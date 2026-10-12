import { describe, it, expect } from 'vitest'
import { decimate, FACT_SCAN_RATE } from './factScan'

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
