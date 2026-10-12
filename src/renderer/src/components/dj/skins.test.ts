import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const page = fs.readFileSync(path.join(dir, 'DjPage.tsx'), 'utf8')
const css = ['dj-real.css', 'dj-themes.css', 'dj-skins.css']
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

  it('every listed look has styles — none silently falls back', () => {
    for (const id of looks.filter(l => l !== 'classic')) expect(css).toContain(`[data-dj-look='${id}']`)
  })
})
