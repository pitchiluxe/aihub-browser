import { describe, it, expect } from 'vitest'
import { hexHue } from './themeService'

// Regression cover for the AI theme generator silently producing nothing:
// built-in themes carry hex swatches, and feeding those strings into the hue
// distance math yielded NaN, which made every candidate look "too similar".
describe('hexHue', () => {
  it('reads the hue of the built-in theme swatches', () => {
    expect(hexHue('#38BDF8')).toBeCloseTo(198.4, 1)  // Ocean cyan
    expect(hexHue('#34D399')).toBeCloseTo(158.1, 1)  // Forest emerald
    expect(hexHue('#F43F5E')).toBeCloseTo(349.7, 1)  // Crimson scarlet
  })

  it('handles primaries at the ends of the wheel', () => {
    expect(hexHue('#FF0000')).toBe(0)
    expect(hexHue('#00FF00')).toBe(120)
    expect(hexHue('#0000FF')).toBe(240)
  })

  it('accepts shorthand hex and a leading hash either way', () => {
    expect(hexHue('#0F0')).toBe(120)
    expect(hexHue('0000FF')).toBe(240)
  })

  it('returns a usable number for greys and malformed input', () => {
    for (const input of ['#000000', '#FFFFFF', '#808080', '', 'not-a-colour', '#12']) {
      const hue = hexHue(input)
      expect(Number.isFinite(hue)).toBe(true)
      expect(hue).toBe(0)
    }
  })

  it('never returns NaN, which is what broke the distance comparison', () => {
    expect(Number.isNaN(hexHue('#17182B'))).toBe(false)
  })
})
