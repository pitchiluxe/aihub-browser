import { describe, it, expect } from 'vitest'
import { gatherCandidates, isSong } from './candidatePool'

const t = (name: string, title = name, durationHint = 220) => ({ token: 'x', path: '', size: 0, name, title, artist: '', durationHint }) as any

describe('isSong', () => {
  it('keeps real songs', () => {
    expect(isSong(t('Rema - Calm Down (Official Music Video)', 'Calm Down'))).toBe(true)
    expect(isSong(t('Chris Brown - Residuals (Official Video)', 'Residuals'))).toBe(true)
    expect(isSong(t('Burna Boy - Last Last', 'Last Last'))).toBe(true)
  })

  it('drops mixes and hour-long videos', () => {
    expect(isSong(t('Afrobeats Mix 2026', 'Afrobeats Mix 2026'))).toBe(false)
    expect(isSong(t('Chill Afrobeats', 'Chill Afrobeats', 3700))).toBe(false)
  })

  it('drops keyword-stuffed filler uploads (played live in a "Late night" set)', () => {
    expect(isSong(t('Sabrina Lust - SHAGALÉ — New Video, Iconic Models,  Deep House Music 2026', 'SHAGALÉ — New Video, Iconic Models, Deep House Music 2026'))).toBe(false)
    expect(isSong(t('Lazy Vibes - Afro Lofi Background Music', 'Afro Lofi Background Music'))).toBe(false)
    expect(isSong(t('Lazy Vibes - Afro Lofi Study Beats', 'Afro Lofi Study Beats'))).toBe(false)
    expect(isSong(t('Lazy Vibes - Afro Lofi BGM', 'Afro Lofi BGM'))).toBe(false)
  })
})

describe('gatherCandidates', () => {
  it('the track carries its genres, so the deck reading its tempo knows them (and any added later)', async () => {
    const song = { ...t('Burna Boy - Last Last', 'Last Last'), youtubeId: 'll', artist: 'Burna Boy' }
    const deps = { profile: () => ({ topArtists: [], avoidArtists: [], lovedTracks: [] }), favorites: () => [], search: async () => [song] } as any
    const [c] = await gatherCandidates(['afrobeats'], deps, { genre: 'afrobeats' })
    expect(c.track.genres).toEqual(['afrobeats'])
    c.genres.push('afro pop')
    expect(c.track.genres).toEqual(['afrobeats', 'afro pop'])
    expect(song).not.toHaveProperty('genres') // the search result itself is left alone
  })
})
