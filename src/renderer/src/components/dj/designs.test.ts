import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CLASSIC_PARTS, DESIGN_PARTS, partsFor } from './designs'

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const page = fs.readFileSync(path.join(dir, 'DjPage.tsx'), 'utf8')
const looks = [...page.slice(page.indexOf('export const DJ_LOOKS')).split('\n]')[0].matchAll(/id: '([a-z-]+)'/g)].map(m => m[1])
const css = fs.readFileSync(path.join(dir, 'dj-designs.css'), 'utf8')

describe('console designs — looks built from different parts', () => {
  it('offers ten designs, each one a look the picker lists', () => {
    expect(Object.keys(DESIGN_PARTS)).toHaveLength(10)
    for (const id of Object.keys(DESIGN_PARTS)) expect(looks).toContain(id)
  })

  it('every other look keeps the original hardware', () => {
    expect(partsFor('studio')).toBe(CLASSIC_PARTS)
    expect(partsFor('arctic')).toEqual({ deck: 'turntable', meter: 'led', knob: 'classic' })
  })

  it('the designs really use every new part, not one part in ten colours', () => {
    const parts = Object.values(DESIGN_PARTS)
    for (const deck of ['turntable', 'cdj', 'ledjog', 'screen']) expect(parts.some(p => p.deck === deck), deck).toBe(true)
    for (const knob of ['chicken', 'ledring']) expect(parts.some(p => p.knob === knob), knob).toBe(true)
    expect(parts.some(p => p.meter === 'needle')).toBe(true)
    // Builds barely repeat: at most two designs share the same set of parts.
    const builds = new Set(parts.map(p => `${p.deck}/${p.meter}/${p.knob}`))
    expect(builds.size).toBeGreaterThanOrEqual(9)
  })

  it('each design is arranged by the Classic layout only, so a chosen layout still wins', () => {
    for (const rule of css.split('}').filter(r => /grid-template|[\s;{]order\s*:|--dj-cols/.test(r))) {
      expect(rule.split('{')[0]).toContain("[data-dj-layout='classic']")
    }
  })

  it('stays off filters, blend modes and looping animation (they starve the YouTube players)', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bfilter\s*:|mix-blend-mode|backdrop-filter|animation\s*:/)
  })
})
