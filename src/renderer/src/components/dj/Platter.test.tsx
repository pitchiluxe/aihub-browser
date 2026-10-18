// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import type { Deck } from './engine/DjEngine'
import Platter from './Platter'

vi.mock('./controls', () => ({ useDeck: () => {}, useRafThrottled: () => {}, fmtTime: () => '0:00' }))
vi.mock('./jogHooks', () => ({ useScratch: () => ({}), useDeckSpin: () => {} }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  const gradient = () => ({ addColorStop: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    scale: vi.fn(), createConicGradient: gradient, createRadialGradient: gradient,
    fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
  } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,')
})
afterEach(() => vi.restoreAllMocks())

describe('platter artwork', () => {
  it.each([200, 320])('fills the record at size %i without a silver hub covering the image', size => {
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      const deck = { id: 'A', track: { cover: 'https://example.com/cover.jpg' } } as Deck
      act(() => root.render(<Platter deck={deck} size={size} />))
      const image = host.querySelector('.dj-record-artwork')!
      expect(Number(image.getAttribute('width'))).toBeCloseTo(size * 0.9)
      expect(Number(image.getAttribute('height'))).toBeCloseTo(size * 0.9)
      expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice')
      expect(image.getAttribute('clip-path')).toBe('url(#disc-clip-A)')
      expect(Number(host.querySelector('clipPath circle')!.getAttribute('r'))).toBeCloseTo(size * 0.45)
      expect(host.querySelector('.dj-reference-hub')).toBeNull()
    } finally { act(() => root.unmount()) }
  })

  it('lets the SVG record boundary clip artwork, without skin-specific center crops', () => {
    const css = fs.readFileSync('src/renderer/src/components/dj/dj-reference-skins.css', 'utf8')
    expect(css).not.toMatch(/\.dj-record-artwork\s*\{[^}]*clip-path\s*:/)
  })

  it('keeps the silver hub available for records without artwork', () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      act(() => root.render(<Platter deck={{ id: 'B', track: null } as Deck} />))
      expect(host.querySelector('.dj-record-artwork')).toBeNull()
      expect(host.querySelector('.dj-reference-hub')).not.toBeNull()
    } finally { act(() => root.unmount()) }
  })
})
