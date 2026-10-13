// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { createAiFinds } from './aiFinds'

const yt = (id: string, title = id) => ({ token: id, path: '', name: title, title, artist: 'Beyoncé', size: 0, youtubeId: id.padEnd(11, '0'), cover: `https://i.ytimg.com/vi/${id}/hq.jpg`, durationHint: 200 }) as any

beforeEach(() => localStorage.clear())

describe('aiFinds — songs the AI DJ found, kept for the library', () => {
  it('keeps every found song with its thumbnail, newest search first, no duplicates', () => {
    const f = createAiFinds()
    f.add([yt('a', 'Halo'), yt('b', 'Formation')], 'Beyonce')
    f.add([yt('c', 'Residuals'), yt('a', 'Halo')], 'R&B')
    const items = f.get()
    expect(items.map(i => i.title)).toEqual(['Residuals', 'Halo', 'Formation'])
    expect(items[0].cover).toMatch(/ytimg/)
    expect(items[0].query).toBe('R&B')
  })
  it('survives a restart (saved locally)', () => {
    createAiFinds().add([yt('a', 'Halo')], 'Beyonce')
    expect(createAiFinds().get().map(i => i.title)).toEqual(['Halo'])
  })
  it('is capped so it never grows without bound', () => {
    const f = createAiFinds(5)
    f.add(Array.from({ length: 8 }, (_, i) => yt(`s${i}`)), 'x')
    expect(f.get()).toHaveLength(5)
  })
  it('notifies the library when songs are added', () => {
    const f = createAiFinds(); let n = 0
    f.subscribe(() => n++)
    f.add([yt('a')], 'q')
    expect(n).toBe(1)
  })
})
