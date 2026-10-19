// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Deck } from './engine/DjEngine'
import Platter, { ARM, armAngleFor } from './Platter'
import { RIGS, RigContext, rigFor } from './rigs'

describe('tonearm geometry', () => {
  // The stylus point at rest (end of the headshell), in fractions of the platter size.
  const tip = { x: 1.023, y: 0.873 }
  const at = (deg: number) => {
    const a = deg * Math.PI / 180, dx = tip.x - ARM.px, dy = tip.y - ARM.py
    return { x: ARM.px + dx * Math.cos(a) - dy * Math.sin(a), y: ARM.py + dx * Math.sin(a) + dy * Math.cos(a) }
  }
  const fromCentre = (p: { x: number; y: number }) => Math.hypot(p.x - 0.5, p.y - 0.5)

  it('rests beside the record, off the platter', () => {
    expect(armAngleFor(false, 0)).toBe(ARM.rest)
    expect(fromCentre(at(ARM.rest))).toBeGreaterThan(0.5)
    expect(ARM.px + 0.0).toBeGreaterThan(0.95)
  })
  it('drops onto the lead-in groove when a song loads', () => {
    expect(fromCentre(at(armAngleFor(true, 0)))).toBeCloseTo(0.44, 1)
  })
  it('tracks to the run-out by the end of the song, clear of the label', () => {
    const r = fromCentre(at(armAngleFor(true, 1)))
    expect(r).toBeCloseTo(0.2, 1)
    expect(r).toBeGreaterThan(0.18)   // label radius
  })
})

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

  it('a silver jog shows a live LCD in its hub and has no arm rest', () => {
    const r = render('silver-wave', {})
    try {
      expect(r.host.querySelector('.dj-jog-lcd')).not.toBeNull()
      expect(r.host.querySelector('#jogmetal-A')).not.toBeNull()
      expect(r.host.querySelector('.dj-arm-rest')).toBeNull()
    } finally { r.done() }
  })

  it('turntables carry the Technics arm; battle rigs put a power cap on the record', () => {
    const r = render('battle-black', {})
    try {
      expect(r.host.querySelector('.dj-arm')).not.toBeNull()
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

describe('rig browser and furniture', () => {
  it('no rig hides the cover-flow thumbnails', () => {
    const ref = fs.readFileSync(path.join(dir, 'dj-reference-skins.css'), 'utf8')
    expect(ref + css).not.toMatch(/\.dj-coverflow\s*\{[^}]*display:\s*none/)
  })
  it('every turntable deck has a live playing lamp; jogs and screens do not', () => {
    const deckUi = fs.readFileSync(path.join(dir, 'DeckUI.tsx'), 'utf8')
    expect(deckUi).toContain("const furnished = kind === 'turntable' && rig?.platter !== 'silver'")
    expect(deckUi).toMatch(/dj-hw-lamp \$\{deck\.active \? 'dj-on'/)
    expect(css).toContain('.dj-tt-furnished .dj-hw-lamp')
  })

  it.each(['studio', 'classic-1200', 'battle-black'])('a %s record has the 45 adapter and target light in its corners', look => {
    const r = render(look, { track: { cover: null } as any })
    try {
      expect(r.host.querySelector('.dj-hw-adapter')).not.toBeNull()
      expect(r.host.querySelector('.dj-hw-target.dj-on')).not.toBeNull()
    } finally { r.done() }
  })

  it('a silver jog is not a turntable and has no adapter or target light', () => {
    const r = render('silver-wave', {})
    try {
      expect(r.host.querySelector('.dj-hw-adapter')).toBeNull()
      expect(r.host.querySelector('.dj-hw-target')).toBeNull()
    } finally { r.done() }
  })
})
