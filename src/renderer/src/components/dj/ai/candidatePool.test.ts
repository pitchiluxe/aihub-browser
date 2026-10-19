import { describe, it, expect } from 'vitest'
import { gatherCandidates, isAiMusic, isSong } from './candidatePool'

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

describe('isAiMusic — the AI DJ plays original recordings only', () => {
  const yt = (name: string, album = 'Video · Some Channel') => ({ ...t(name), album }) as any
  it.each([
    'Burna Boy - Last Last (AI Cover)',
    'Drake ft. Michael Jackson - Starlight [AI]',
    'Afrobeats Love Song (Made with Suno)',
    'Calm Down - AI Generated Version',
    'Amapiano 2026 | Udio original',
    'Tems sings Rihanna – A.I. vocals',
    'Midnight Groove (AI Music)',
    'Song created using artificial intelligence',
  ])('drops %s', name => {
    expect(isAiMusic(yt(name))).toBe(true)
    expect(isSong(yt(name))).toBe(false)
  })

  it('drops uploads from a channel that labels itself AI music', () => {
    expect(isAiMusic(yt('Lagos Nights', 'Video · Afro AI Music'))).toBe(true)
  })

  it.each([
    ['Rema - Calm Down (Official Music Video)', 'Official video · Rema'],
    ['Ai - Story', 'Audio · Ai'],
    ['Kizz Daniel - Buga (Lyrics)', 'Lyrics · Kizz Daniel'],
    ['Wizkid - Ojuelegba (Remix) ft. Drake', 'Remix · Wizkid'],
    ['Aidonia - Fight Over Me', 'Video · Aidonia'],
    ['Air - Sexy Boy', 'Audio · Air'],
  ])('keeps the original %s', (name, album) => {
    expect(isAiMusic(yt(name, album))).toBe(false)
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
