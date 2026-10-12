// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { canvasFrame } from './canvasFrame'

function fakeCanvas() {
  let layoutReads = 0
  const ctx = { setTransform: () => {} }
  const cv = { getContext: () => ctx } as any
  // Reading offsetParent forces a synchronous layout of the whole page.
  for (const p of ['offsetParent', 'offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight']) {
    Object.defineProperty(cv, p, { get: () => { layoutReads++; return 1 } })
  }
  cv.getBoundingClientRect = () => { layoutReads++; return { width: 1, height: 1 } }
  return { cv, ctx, reads: () => layoutReads }
}

describe('canvasFrame — per-frame canvas setup never forces layout', () => {
  it('draws from the measured box without touching layout', () => {
    const { cv, ctx, reads } = fakeCanvas()
    expect(canvasFrame(cv, { w: 200, h: 40, k: 1.5 })).toEqual({ ctx, w: 200, h: 40 })
    expect(reads()).toBe(0)
  })
  it('a hidden canvas (ResizeObserver measured 0×0) is skipped, still without layout', () => {
    const { cv, reads } = fakeCanvas()
    expect(canvasFrame(cv, { w: 0, h: 0, k: 1 })).toBeNull()
    expect(canvasFrame(null, { w: 10, h: 10, k: 1 })).toBeNull()
    expect(reads()).toBe(0)
  })
})
