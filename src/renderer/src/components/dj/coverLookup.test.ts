// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { withDeckCover, displayCover } from './coverLookup'

afterEach(() => { delete (window as any).electronAPI; localStorage.clear() })

describe('withDeckCover — the deck shows the cover that was dragged', () => {
  it('keeps a track\'s own cover, shown bar-free like the library shows it', async () => {
    const t = await withDeckCover({ token: 'yt-x', title: 'Halo', youtubeId: 'x', cover: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' } as any)
    expect(t.cover).toBe('https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg')
  })

  it('gives a song with no artwork the cover the library looked up for it', async () => {
    ;(window as any).electronAPI = { dj: { youtubeSearch: vi.fn(async () => ({ ok: true, videos: [{ thumbnail: 'https://i.ytimg.com/vi/zzzzzzzzzzz/hqdefault.jpg' }] })) } }
    const t = await withDeckCover({ token: 'yt-y', title: 'Jehovah', artist: "L'or Mbongo" } as any)
    expect(t.cover).toBe(displayCover('https://i.ytimg.com/vi/zzzzzzzzzzz/hqdefault.jpg'))
  })

  it('never holds a load up for long when no cover can be found', async () => {
    ;(window as any).electronAPI = { dj: { youtubeSearch: () => new Promise(() => {}) } }
    const start = Date.now()
    const t = await withDeckCover({ token: 'yt-z', title: 'Unknown song' } as any, 50)
    expect(t.cover).toBeUndefined()
    expect(Date.now() - start).toBeLessThan(1000)
  })
})
