import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { beatSeconds } from './ClubScene'

const deck = (playing: boolean, bpm: number | null, db: number) => ({ playing, effectiveBpm: bpm, meterDb: () => db })

describe('club lights follow the music', () => {
  it('beat length comes from the loudest playing deck', () => {
    expect(beatSeconds({ decks: { A: deck(true, 128, -10), B: deck(true, 100, -30) } } as any)).toBeCloseTo(60 / 128)
    expect(beatSeconds({ decks: { A: deck(false, 128, -10), B: deck(true, 100, -30) } } as any)).toBeCloseTo(0.6)
  })
  it('idles at 120 BPM when nothing plays or the tempo is unknown', () => {
    expect(beatSeconds({ decks: { A: deck(false, 90, -10), B: deck(true, null, -10) } } as any)).toBeCloseTo(0.5)
  })
  it('moves only by transform and opacity — no filters or blends (they starve the YouTube players)', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
    const css = fs.readFileSync(path.join(dir, 'club.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/\bfilter\s*:|mix-blend-mode|backdrop-filter/)
    for (const kf of css.matchAll(/@keyframes[^{]+\{([\s\S]*?\})\s*\}/g)) {
      const props = [...kf[1].matchAll(/([a-z-]+)\s*:/g)].map(m => m[1])
      for (const p of props) expect(['transform', 'opacity']).toContain(p)
    }
  })
})
