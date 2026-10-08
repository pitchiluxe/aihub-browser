import { describe, it, expect } from 'vitest'
import { buildCommandPrompt, contextLines, fallbackQueries, introLine, parseCommand, parseModelIntents } from './djBrain'
import type { TasteProfile } from './taste'

describe('DJ commands (rules)', () => {
  it.each([
    ['skip', { type: 'skip' }],
    ['Hey DJ, could you please skip this song', { type: 'skip' }],
    ['next track', { type: 'skip' }],
    ['pause', { type: 'pause' }],
    ['stop the music', { type: 'pause' }],
    ['play', { type: 'resume' }],
    ['fade now', { type: 'fade' }],
    ['sync the decks', { type: 'sync' }],
    ['loop 4 beats', { type: 'loop' }],
    ["what's playing?", { type: 'status' }],
    ['I love this song', { type: 'like' }],
    ["I don't like this one", { type: 'dislike' }],
    ['louder', { type: 'volume', delta: 0.1 }],
    ['turn it down', { type: 'volume', delta: -0.1 }],
    ['more energy', { type: 'energy', to: 'build' }],
    ['pump it up', { type: 'energy', to: 'build' }],
    ['go all out', { type: 'energy', to: 'peak' }],
    ['chill it down a bit', { type: 'energy', to: 'chill' }],
    ['automix on', { type: 'automix', on: true }],
    ['turn off automix', { type: 'automix', on: false }],
    ['let the ai take over', { type: 'takeover', on: true }],
    ["i'll take back the decks", { type: 'takeover', on: false }],
    ['dj voice on', { type: 'voice', on: true }],
    ['voice off', { type: 'voice', on: false }],
    ['air horn', { type: 'hit', id: 'horn' }],
    ['hit the siren', { type: 'hit', id: 'siren' }],
    ['play Essence by Wizkid', { type: 'mixin', query: 'essence by wizkid' }],
    ['queue Last Last', { type: 'queue', query: 'last last' }],
    ['add Burna Boy Ye to the queue', { type: 'queue', query: 'burna boy ye' }],
    ['play some deep house', { type: 'vibe', text: 'deep house' }],
    ["i'm in the mood for gospel praise", { type: 'vibe', text: 'gospel praise' }],
  ])('%s', (said, intent) => {
    expect(parseCommand(said)).toEqual(intent)
  })

  it('leaves what it does not recognise to the model', () => {
    expect(parseCommand('')).toBeNull()
    expect(parseCommand('is the crowd enjoying this')).toBeNull()
  })

  it('does not mistake a song name for a command', () => {
    // "Horn" in a longer title must not fire the sampler.
    expect(parseCommand('play Fanfare of the Horn Section by Nobody')).toMatchObject({ type: 'mixin' })
  })
})

describe('model actions', () => {
  it('keeps only whitelisted actions with valid fields', () => {
    const reply = 'Sure:\n[{"type":"energy","to":"peak"},{"type":"hit","id":"horn"},{"type":"hit","id":"nuke"},{"type":"rm","path":"/"},{"type":"volume","delta":5},{"type":"mixin","query":"Wizkid Essence"}]'
    expect(parseModelIntents(reply)).toEqual([
      { type: 'energy', to: 'peak' },
      { type: 'hit', id: 'horn' },
      { type: 'volume', delta: 0.3 },
      { type: 'mixin', query: 'Wizkid Essence' },
    ])
  })
  it('survives nonsense', () => {
    expect(parseModelIntents('I am not sure what you mean')).toEqual([])
    expect(parseModelIntents('[not json')).toEqual([])
  })
  it('describes the vocabulary and quotes the request safely', () => {
    const p = buildCommandPrompt('say "hi"', 'A - B (120 BPM)')
    expect(p).toContain('A - B (120 BPM)')
    expect(p).toContain('mixin')
    expect(p).not.toContain('say "hi"')
  })
})

describe('set context', () => {
  it('tells the model what is playing, the energy and the hour', () => {
    const lines = contextLines({ now: { artist: 'Wizkid', title: 'Essence', bpm: 104.2, key: '8A' }, energy: 'build', hour: 22 }).join('\n')
    expect(lines).toContain('Wizkid - Essence')
    expect(lines).toContain('104 BPM')
    expect(lines).toContain('key 8A')
    expect(lines).toContain('Build the energy')
    expect(lines).toContain('night')
  })
  it('works with nothing playing', () => {
    const lines = contextLines({ energy: 'auto', hour: 9 }).join('\n')
    expect(lines).not.toContain('Playing right now')
    expect(lines).toContain('morning')
  })
})

describe('fallback searches', () => {
  const profile: TasteProfile = {
    topArtists: [{ artist: 'Fally Ipupa', score: 9 }, { artist: 'Burna Boy', score: 6 }],
    avoidArtists: [], lovedTracks: [{ artist: 'Wizkid', title: 'Essence', score: 5 }],
    recentSearches: [], nowArtists: [], stats: { minutes: 0, plays: 0, completes: 0, skips: 0 },
  }
  it('uses the vibe first, then the loved artists', () => {
    const q = fallbackQueries('gospel praise', profile, 'auto', 20, () => 0.5)
    expect(q[0]).toBe('gospel praise songs')
    expect(q).toContain('Fally Ipupa best songs')
    expect(q).toContain('Wizkid Essence similar songs')
  })
  it('follows the energy asked for', () => {
    expect(fallbackQueries('', profile, 'chill', 5, () => 0.5).some(x => x.includes('chill songs'))).toBe(true)
    expect(fallbackQueries('', profile, 'peak', 5, () => 0.5).some(x => x.includes('dance hits'))).toBe(true)
  })
  it('still finds something for a brand-new listener', () => {
    const empty = { ...profile, topArtists: [], lovedTracks: [] }
    expect(fallbackQueries('', empty, 'auto', 3).length).toBe(3)
  })
})

describe('voice drops', () => {
  it('names the song, the same way every time', () => {
    const a = introLine('Wizkid', 'Essence', 'auto')
    expect(a).toContain('Essence by Wizkid')
    expect(introLine('Wizkid', 'Essence', 'auto')).toBe(a)
  })
  it('matches the energy', () => {
    expect(introLine('A', 'B', 'peak')).toMatch(/!/)
    expect(introLine('', 'Solo', 'chill')).toContain('Solo')
  })
})
