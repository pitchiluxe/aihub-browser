import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const page = fs.readFileSync(path.join(dir, 'DjPage.tsx'), 'utf8')
const css = ['dj-real.css', 'dj-themes.css', 'dj-skins.css', 'dj-skins-pro.css', 'dj-skins-real.css']
  .map(f => { try { return fs.readFileSync(path.join(dir, f), 'utf8') } catch { return '' } }).join('\n')
const looks = [...page.slice(page.indexOf('export const DJ_LOOKS')).split('\n]')[0].matchAll(/id: '([a-z-]+)'/g)].map(m => m[1])

describe('console skins', () => {
  it('offers the six VirtualDJ-style skins alongside the originals', () => {
    for (const id of ['pro-dark', 'carbon', 'cdj', 'neon-night', 'gold-elite', 'daylight']) expect(looks).toContain(id)
  })

  it.each(['pro-dark', 'carbon', 'cdj', 'neon-night', 'gold-elite', 'daylight'])('%s styles panels, displays, buttons, knobs and platters', id => {
    for (const part of ['.dj-panel', '.dj-lcd', '.dj-tbtn', '.dj-knob', '.dj-platter']) {
      expect(css).toContain(`[data-dj-look='${id}'] ${part}`)
    }
  })

  const MORE = ['midnight-blue', 'studio-black', 'graphite', 'crimson-rack', 'emerald', 'arctic']
  it('offers six more professional looks', () => {
    for (const id of MORE) expect(looks).toContain(id)
    expect(looks.length).toBeGreaterThanOrEqual(18)
  })
  /** A rule for this look whose selector names the part (directly or inside :is(...)). */
  const styles = (id: string, part: string) => css.split('}').some(rule => {
    const sel = rule.split('{')[0]
    return sel.includes(`[data-dj-look='${id}']`) && sel.includes(part)
  })
  it.each(MORE)('%s styles panels, displays, buttons, knobs, faders, platters and the library', id => {
    for (const part of ['.dj-panel', '.dj-lcd', '.dj-tbtn', '.dj-knob', '.dj-platter', '.dj-vfader-cap', '.dj-library']) {
      expect(styles(id, part), `${id} ${part}`).toBe(true)
    }
  })
  it('the light look restyles the whole library, not just the decks', () => {
    for (const part of ['.dj-browser', '.dj-thead', '.dj-search input']) expect(styles('arctic', part), part).toBe(true)
  })

  const MATERIAL = ['walnut-hifi', 'rose-gold', 'porcelain', 'field-olive', 'tube-amp', 'concrete', 'titanium', 'mahogany', 'ocean', 'obsidian']
  it('offers ten material skins', () => {
    for (const id of MATERIAL) expect(looks).toContain(id)
    expect(looks.length).toBeGreaterThanOrEqual(28)
  })
  it.each(MATERIAL)('%s styles panels, displays, buttons, knobs, faders, platters and the library', id => {
    for (const part of ['.dj-panel', '.dj-lcd', '.dj-tbtn', '.dj-knob', '.dj-platter', '.dj-vfader-cap', '.dj-library']) {
      expect(styles(id, part), `${id} ${part}`).toBe(true)
    }
  })
  it.each(MATERIAL)('%s paints knobs by part, not by the order of circles in the SVG', id => {
    for (const part of ['.dj-knob-base', '.dj-knob-cap', '.dj-knob-ptr']) expect(styles(id, part), `${id} ${part}`).toBe(true)
  })
  it('the material skins stay off filters and blend modes (they starve the YouTube players)', () => {
    const real = fs.readFileSync(path.join(dir, 'dj-skins-real.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(real).not.toMatch(/\bfilter\s*:|mix-blend-mode|backdrop-filter|animation\s*:/)
  })
  it('the light material skin restyles the whole library, not just the decks', () => {
    for (const part of ['.dj-browser', '.dj-thead', '.dj-search input']) expect(styles('porcelain', part), part).toBe(true)
  })

  it('every listed look has styles — none silently falls back', () => {
    for (const id of looks.filter(l => l !== 'classic')) expect(css).toContain(`[data-dj-look='${id}']`)
  })
})
