import { describe, it, expect } from 'vitest'
import { viewRect, EDGE_OVERSHOOT } from './viewBounds'

describe('viewRect', () => {
  it('runs a view that reaches the right and bottom edges past them', () => {
    // 125 % display scaling: content 1441×836, the renderer measures to the edge.
    const r = viewRect({ x: 0.8, y: 92, width: 1440.2, height: 744 }, 1, [1441, 836])
    expect(r.x).toBe(1)
    expect(r.x + r.width).toBe(1441 + EDGE_OVERSHOOT)
    expect(r.y + r.height).toBe(836 + EDGE_OVERSHOOT)
  })

  it('rounds edges, not sizes, so the view never ends a pixel short', () => {
    // Right edge 501.4 → 501, bottom edge 311.4 → 311: sizes follow the edges.
    const r = viewRect({ x: 0.6, y: 10.6, width: 500.8, height: 300.8 }, 1, [2000, 2000])
    expect(r).toEqual({ x: 1, y: 11, width: 500, height: 300 })
    // Rounding the size alone would have ended this one a pixel short of its edge (0.4 + 99.4 = 99.8 → 100).
    const s = viewRect({ x: 0.4, y: 0, width: 99.4, height: 10 }, 1, [2000, 2000])
    expect(s.x + s.width).toBe(100)
  })

  it('leaves a view alone when a side panel sits to its right', () => {
    const r = viewRect({ x: 0, y: 92, width: 1052, height: 808 }, 1, [1440, 900])
    expect(r.x + r.width).toBe(1052)
    expect(r.y + r.height).toBe(900 + EDGE_OVERSHOOT)
  })

  it('scales by the window zoom', () => {
    const r = viewRect({ x: 0, y: 80, width: 1309, height: 738 }, 1.1, [1440, 900])
    expect(r.y).toBe(88)
    expect(r.x + r.width).toBe(1440 + EDGE_OVERSHOOT)
    expect(r.y + r.height).toBe(900 + EDGE_OVERSHOOT)
  })

  it('treats a bad zoom as 1 and never goes negative', () => {
    expect(viewRect({ x: 5, y: 5, width: -10, height: 0 }, NaN, [0, 0])).toEqual({ x: 5, y: 5, width: 0, height: 0 })
  })
})
