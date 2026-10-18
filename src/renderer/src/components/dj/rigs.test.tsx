// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Deck } from './engine/DjEngine'
import Platter from './Platter'
import { RIGS, RigContext, rigFor } from './rigs'

vi.mock('./controls', () => ({ useDeck: () => {}, useRafThrottled: () => {}, fmtTime: () => '0:00' }))
vi.mock('./jogHooks', () => ({ useScratch: () => ({}), useDeckSpin: () => {} }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const dir = 'src/renderer/src/components/dj'
const css = fs.readFileSync(path.join(dir, 'dj-rigs.css'), 'utf8')
const page = fs.readFileSync(path.join(dir, 'DjPage.tsx'), 'utf8')
const looks = [...page.slice(page.indexOf('export const DJ_LOOKS')).split('\n]')[0].matchAll(/id: '([a-z0-9-]+)'/g)].map(m => m[1])

beforeEach(() => {
  const gradient = () => ({ addColorStop: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    scale: vi.fn(), createConicGradient: gradient, createRadialGradient: gradient,
    fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
  } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,')
})
afterEach(() => vi.restoreAllMocks())

function render(look: string, deck: Partial<Deck>) {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<RigContext.Provider value={rigFor(look)}><Platter deck={{ id: 'A', track: null, ...deck } as Deck} size={300} /></RigContext.Provider>))
  return { host, done: () => act(() => root.unmount()) }
}

describe('hardware rigs', () => {
  it('offers all six reference rigs in the skin picker', () => {
    for (const id of ['silver-wave', 'silver-classic', 'classic-1200', 'battle-art', 'battle-black', 'ember-vinyl']) {
      expect(RIGS[id], id).toBeTruthy()
      expect(looks).toContain(id)
    }
  })

  it.each(Object.keys(RIGS))('%s has its own finish in dj-rigs.css', id => {
    expect(css).toMatch(new RegExp(`data-dj-look='${id}'`))
  })

  it('looks without a rig keep their own parts', () => {
    expect(rigFor('studio')).toBeNull()
  })

  it('a silver jog shows a live LCD in its hub and no tonearm swap', () => {
    const r = render('silver-wave', {})
    try {
      expect(r.host.querySelector('.dj-jog-lcd')).not.toBeNull()
      expect(r.host.querySelector('#jogmetal-A')).not.toBeNull()
      expect(r.host.querySelector('.dj-sarm')).toBeNull()
    } finally { r.done() }
  })

  it('vinyl rigs carry the S-arm; battle rigs put a power cap on the record', () => {
    const r = render('battle-black', {})
    try {
      expect(r.host.querySelector('.dj-sarm')).not.toBeNull()
      expect(r.host.querySelector('.dj-power-cap')).not.toBeNull()
    } finally { r.done() }
  })

  it('artwork still fills the record on a battle rig, with only a small cap over the spindle', () => {
    const r = render('battle-art', { track: { cover: 'https://example.com/c.jpg' } as any })
    try {
      expect(Number(r.host.querySelector('.dj-record-artwork')!.getAttribute('width'))).toBeCloseTo(300 * 0.9)
      expect(Number(r.host.querySelector('.dj-power-cap circle')!.getAttribute('r'))).toBeLessThan(150 * 0.15)
    } finally { r.done() }
  })

  it('palettes repaint the rig finish (anything but Skin original)', () => {
    expect(css).toMatch(/\[data-dj-reference='1'\]\[data-dj-theme\]:not\(\[data-dj-theme='original'\]\)\s*\{[^}]*--rig-deck:[^}]*var\(--dj-metal\)/)
  })

  it('stays off filters, blend modes and animations (they starve the YouTube players)', () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(plain).not.toMatch(/\bfilter\s*:|mix-blend-mode|backdrop-filter|animation\s*:/)
  })
})
