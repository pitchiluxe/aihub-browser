import { describe, it, expect } from 'vitest'
import {
  rectFromPoints, clampRect, isUsableRegion, toFraction, toPixels,
  regionInStream, toEvenSize, describeRegion, MIN_REGION_PX,
} from './captureRegion'

describe('rectFromPoints', () => {
  it('reads a drag down and to the right', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 110, y: 70 }))
      .toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })
  it('reads a drag up and to the left the same way', () => {
    // Dragging backwards is as natural as forwards, and taken literally it
    // produces a negative width that reads downstream as an empty selection.
    expect(rectFromPoints({ x: 110, y: 70 }, { x: 10, y: 20 }))
      .toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })
  it('gives a zero rect for a click', () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 }))
      .toEqual({ x: 5, y: 5, width: 0, height: 0 })
  })
})

describe('clampRect', () => {
  it('trims a rectangle that runs off the edge rather than moving it', () => {
    expect(clampRect({ x: 90, y: 90, width: 50, height: 50 }, 100, 100))
      .toEqual({ x: 90, y: 90, width: 10, height: 10 })
  })
  it('pulls a negative origin back to zero', () => {
    expect(clampRect({ x: -10, y: -10, width: 30, height: 30 }, 100, 100))
      .toEqual({ x: 0, y: 0, width: 30, height: 30 })
  })
  it('never returns a negative size', () => {
    const out = clampRect({ x: 200, y: 200, width: 50, height: 50 }, 100, 100)
    expect(out.width).toBe(0)
    expect(out.height).toBe(0)
  })
})

describe('isUsableRegion', () => {
  it('rejects a click that travelled a pixel or two', () => {
    expect(isUsableRegion({ x: 0, y: 0, width: 3, height: 2 })).toBe(false)
  })
  it('accepts a deliberate drag', () => {
    expect(isUsableRegion({ x: 0, y: 0, width: MIN_REGION_PX, height: MIN_REGION_PX })).toBe(true)
  })
  it('rejects a sliver in one axis only', () => {
    expect(isUsableRegion({ x: 0, y: 0, width: 400, height: 4 })).toBe(false)
  })
})

describe('toFraction / toPixels', () => {
  it('expresses a rectangle as a share of its image', () => {
    expect(toFraction({ x: 100, y: 50, width: 200, height: 100 }, 400, 200))
      .toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
  })

  it('survives the round trip back to pixels', () => {
    const rect = { x: 100, y: 50, width: 200, height: 100 }
    expect(toPixels(toFraction(rect, 400, 200), 400, 200)).toEqual(rect)
  })

  it('rounds outward, so the edge the user included is not shaved off', () => {
    const out = toPixels({ x: 0.101, y: 0.101, width: 0.5, height: 0.5 }, 100, 100)
    expect(out.x).toBe(10)
    expect(out.width).toBeGreaterThanOrEqual(50)
  })

  it('rescales cleanly when the image is a different size', () => {
    // The still is captured at one scale and cropped from another; the
    // fraction is what makes that safe.
    const frac = toFraction({ x: 100, y: 50, width: 200, height: 100 }, 400, 200)
    expect(toPixels(frac, 800, 400)).toEqual({ x: 200, y: 100, width: 400, height: 200 })
  })

  it('falls back to the whole image rather than dividing by zero', () => {
    expect(toFraction({ x: 0, y: 0, width: 10, height: 10 }, 0, 0))
      .toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('regionInStream', () => {
  // A window 1000×600 whose page area starts 200px in and 100px down.
  const view = { x: 200, y: 100, width: 800, height: 500 }
  const content = { width: 1000, height: 600 }

  it('maps a page region into a same-sized stream', () => {
    const half = { x: 0.5, y: 0, width: 0.5, height: 0.5 }
    expect(regionInStream(half, view, content, { width: 1000, height: 600 }))
      .toEqual({ x: 600, y: 100, width: 400, height: 250 })
  })

  it('scales for a stream captured at twice the window size', () => {
    // The whole point of the fraction pivot: a HiDPI stream must not need the
    // caller to know its scale factor.
    const half = { x: 0.5, y: 0, width: 0.5, height: 0.5 }
    expect(regionInStream(half, view, content, { width: 2000, height: 1200 }))
      .toEqual({ x: 1200, y: 200, width: 800, height: 500 })
  })

  it('covers the whole page area for a full selection', () => {
    const all = { x: 0, y: 0, width: 1, height: 1 }
    expect(regionInStream(all, view, content, { width: 1000, height: 600 }))
      .toEqual({ x: 200, y: 100, width: 800, height: 500 })
  })

  it('stays inside the stream when the page runs to the window edge', () => {
    const out = regionInStream(
      { x: 0.9, y: 0.9, width: 0.2, height: 0.2 }, view, content, { width: 1000, height: 600 })!
    expect(out.x + out.width).toBeLessThanOrEqual(1000)
    expect(out.y + out.height).toBeLessThanOrEqual(600)
  })

  it('returns null rather than a confidently wrong rectangle', () => {
    const frac = { x: 0, y: 0, width: 1, height: 1 }
    expect(regionInStream(frac, { x: 0, y: 0, width: 0, height: 0 }, content, { width: 10, height: 10 })).toBeNull()
    expect(regionInStream(frac, view, { width: 0, height: 0 }, { width: 10, height: 10 })).toBeNull()
    expect(regionInStream(frac, view, content, { width: 0, height: 0 })).toBeNull()
  })

  it('returns null for a region too small to encode', () => {
    expect(regionInStream({ x: 0, y: 0, width: 0.0005, height: 0.0005 }, view, content,
      { width: 1000, height: 600 })).toBeNull()
  })
})

describe('toEvenSize', () => {
  it('rounds down to even, because odd dimensions break encoders', () => {
    expect(toEvenSize({ x: 0, y: 0, width: 101, height: 99 }))
      .toEqual({ x: 0, y: 0, width: 100, height: 98 })
  })
  it('leaves an already-even size alone', () => {
    expect(toEvenSize({ x: 4, y: 4, width: 100, height: 50 }))
      .toEqual({ x: 4, y: 4, width: 100, height: 50 })
  })
  it('never falls below a encodable size', () => {
    expect(toEvenSize({ x: 0, y: 0, width: 1, height: 1 }))
      .toEqual({ x: 0, y: 0, width: 2, height: 2 })
  })
})

describe('describeRegion', () => {
  it('names a region by its size and a full capture as full', () => {
    expect(describeRegion({ x: 0, y: 0, width: 640, height: 480 })).toBe('640x480')
    expect(describeRegion(null)).toBe('full')
  })
})
