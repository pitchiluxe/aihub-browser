import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { HITS } from './sampler'

const src = fs.readFileSync('src/renderer/src/components/dj/engine/sampler.ts', 'utf8')

describe('sampler', () => {
  it.each(HITS.map(h => h.id))('%s has a sound', id => {
    expect(src).toContain(`case '${id}': this.${id}(t)`)
    expect(src).toContain(`private ${id}(t: number)`)
  })

  it('every hit reaches the band small speakers play (no sub-only hits)', () => {
    // The impact and toms were pure low sines and were silent on laptops.
    const body = (id: string) => src.slice(src.indexOf(`private ${id}(t: number)`)).split('\n  private ')[0]
    for (const id of ['impact', 'tom']) expect(body(id)).toMatch(/this\.drive\(/)
  })

  it('an offline render is never asked to resume', () => {
    expect(src).toMatch(/!isOffline\(this\.ctx\)/)
  })
})
