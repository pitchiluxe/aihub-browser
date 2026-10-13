import { describe, it, expect } from 'vitest'
import { nativeBounds } from './nativeVideo'

describe('nativeBounds — where a deck\'s YouTube player is shown, from the page\'s rectangle', () => {
  it('rounds the page rectangle into view bounds', () => {
    expect(nativeBounds({ x: 10.4, y: 20.6, width: 640.2, height: 360.7 }, 1)).toEqual({ x: 10, y: 21, width: 640, height: 361 })
  })
  it('scales by the page zoom (CSS px → window units)', () => {
    expect(nativeBounds({ x: 100, y: 50, width: 400, height: 225 }, 1.25)).toEqual({ x: 125, y: 63, width: 500, height: 281 })
  })
  it('refuses anything that is not a sane rectangle (the page is not trusted with window geometry)', () => {
    for (const bad of [null, undefined, 'x', {}, { x: 0, y: 0, width: NaN, height: 10 }, { x: -5, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 50000, height: 100 }, { x: 0, y: 0, width: 100, height: Infinity }]) {
      expect(nativeBounds(bad as any, 1)).toBeNull()
    }
  })
  it('too small to be worth showing: hidden instead', () => {
    expect(nativeBounds({ x: 0, y: 0, width: 4, height: 3 }, 1)).toBeNull()
  })
})
