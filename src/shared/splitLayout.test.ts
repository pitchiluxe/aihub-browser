import { describe, it, expect } from 'vitest'
import { splitPanes, type Rect } from './splitLayout'

const content: Rect = { x: 0, y: 96, width: 1000, height: 800 }

describe('splitPanes', () => {
  it('splits the width evenly, minus the gutter', () => {
    const [left, right] = splitPanes(content, 0.5, 6)
    expect(left.width + right.width + 6).toBe(content.width)
    expect(left.width).toBe(right.width)
  })

  it('never lets the panes overlap or leave a gap other than the gutter', () => {
    for (const ratio of [0.2, 0.35, 0.5, 0.66, 0.8]) {
      const [left, right] = splitPanes(content, ratio, 6)
      expect(right.x - (left.x + left.width)).toBe(6)
      expect(left.width + right.width + 6).toBe(content.width)
    }
  })

  it('keeps both panes on the same row as the content area', () => {
    const [left, right] = splitPanes(content, 0.5)
    expect(left.y).toBe(content.y)
    expect(right.y).toBe(content.y)
    expect(left.height).toBe(content.height)
    expect(right.height).toBe(content.height)
  })

  it('honours the ratio', () => {
    const [left] = splitPanes({ ...content, width: 1006 }, 0.7, 6)
    expect(left.width).toBe(700)
  })

  it('clamps extreme or nonsense ratios instead of collapsing a pane', () => {
    for (const ratio of [0, 1, -5, 42, NaN, Infinity]) {
      const [left, right] = splitPanes(content, ratio as number, 6)
      expect(left.width).toBeGreaterThan(100)
      expect(right.width).toBeGreaterThan(100)
    }
  })

  it('respects an offset content area (sidebar open)', () => {
    const [left, right] = splitPanes({ x: 260, y: 96, width: 740, height: 800 }, 0.5, 6)
    expect(left.x).toBe(260)
    expect(right.x + right.width).toBe(1000)
  })

  it('degrades safely in a window too narrow for a gutter', () => {
    const [left, right] = splitPanes({ x: 0, y: 0, width: 4, height: 100 }, 0.5, 6)
    expect(left.width).toBeGreaterThanOrEqual(0)
    expect(right.width).toBeGreaterThanOrEqual(0)
    expect(left.width + right.width).toBeLessThanOrEqual(4)
  })

  it('produces integer bounds — Chromium wants whole pixels', () => {
    const [left, right] = splitPanes({ x: 10.4, y: 95.6, width: 999.7, height: 799.2 }, 0.5, 6)
    for (const value of [left.x, left.y, left.width, left.height, right.x, right.y, right.width, right.height]) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})
