import { describe, it, expect } from 'vitest'
import { parseInstruction, parseModelInstructions, ruleLabel, type SetRule } from './instructions'

const NOW = 1_000_000
const rule = (t: string) => parseInstruction(t, NOW).items.map(i => ('rule' in i ? i.rule : null)).filter(Boolean)[0] as SetRule | undefined
const action = (t: string) => parseInstruction(t, NOW).items.map(i => ('action' in i ? i.action : null)).filter(Boolean)[0]

describe('rules — phrasings that failed on 2026-10-12', () => {
  it.each([
    ['no more slow songs', { kind: 'minEnergy', level: 0.5 }],
    ['no slow songs', { kind: 'minEnergy', level: 0.5 }],
    ["don't play drake", { kind: 'banArtist', artist: 'drake' }],
    ["don't play any Drake", { kind: 'banArtist', artist: 'drake' }],
    ['no more Drake', { kind: 'banArtist', artist: 'drake' }],
    ['no Drake', { kind: 'banArtist', artist: 'drake' }],
    ['play only afrobeats', { kind: 'onlyGenres', genres: ['afrobeats'] }],
    ['stick to amapiano', { kind: 'onlyGenres', genres: ['amapiano'] }],
    ['switch to amapiano', { kind: 'onlyGenres', genres: ['amapiano'] }],
    ['keep it under 110 bpm', { kind: 'tempoRange', max: 110 }],
    ['between 100 and 120 bpm', { kind: 'tempoRange', min: 100, max: 120 }],
    ['less hip hop', { kind: 'lessGenre', genre: 'hip hop' }],
    ['more house music', { kind: 'moreGenre', genre: 'house' }],
    ['avoid explicit songs', { kind: 'noExplicit' }],
    ['clean versions only', { kind: 'noExplicit' }],
    ['stop after this song', { kind: 'stopAfterCurrent' }],
    ['play something I have never heard', { kind: 'discoveryBurst', tracks: 3 }],
    ['play my favorites', { kind: 'favoritesOnly', tracks: 5 }],
    ['play Calm Down by Rema next', { kind: 'playNext', query: 'calm down rema' }],
    ['play "Calm Down" next', { kind: 'playNext', query: 'calm down' }],
  ])('%s', (text, want) => {
    expect(rule(text)).toMatchObject(want)
  })

  it('timed energy: keep the energy high for the next hour', () => {
    expect(rule('keep the energy high for the next hour')).toEqual({ kind: 'minEnergy', level: 0.65, untilMs: NOW + 3_600_000 })
  })

  it('sequences: play 3 Wizkid songs then Davido', () => {
    expect(rule('play 3 Wizkid songs then Davido')).toEqual({ kind: 'sequence', steps: [{ query: 'wizkid', count: 3 }, { query: 'davido', count: 1 }] })
  })
})

describe('never the opposite', () => {
  it.each(['no more slow songs', 'no slow songs', 'play Calm Down by Rema next', 'stop the chill stuff'])('%s does not choose chill', text => {
    const a = action(text) as any
    expect(a?.type === 'energy' && a.to === 'chill').toBe(false)
  })
  it('slow songs please → chill', () => {
    expect(action('slow songs please')).toEqual({ type: 'energy', to: 'chill' })
  })
})

describe('one-shot actions still work', () => {
  it.each([
    ['skip', { type: 'skip' }],
    ['next song', { type: 'skip' }],
    ['pause', { type: 'pause' }],
    ['turn it down a bit', { type: 'volume', delta: -0.1 }],
    ['louder', { type: 'volume', delta: 0.1 }],
    ['I love this song', { type: 'like' }],
    ["I don't like this", { type: 'dislike' }],
    ['more energy', { type: 'energy', to: 'build' }],
    ['air horn', { type: 'hit', id: 'horn' }],
  ])('%s', (text, want) => { expect(action(text)).toEqual(want) })
})

describe('playing a song on request', () => {
  const first = (t: string) => parseInstruction(t, NOW).items[0]
  it.each([
    ['play Calm Down by Rema', { action: { type: 'mixin', query: 'calm down rema' } }],
    ['play Essence by Wizkid now', { action: { type: 'mixin', query: 'essence wizkid' } }],
    ['play "Last Last"', { action: { type: 'mixin', query: 'last last' } }],
    ['put Last Last by Burna Boy on deck B', { load: { query: 'last last burna boy', deck: 'B', play: false } }],
    ['load Essence on deck a', { load: { query: 'essence', deck: 'A', play: false } }],
    ['play Peru by Fireboy on deck B', { load: { query: 'peru fireboy', deck: 'B', play: true } }],
  ])('%s', (text, want) => { expect(first(text)).toEqual(want) })

  it('"next" still queues instead of interrupting', () => {
    expect(first('play Calm Down by Rema next')).toEqual({ rule: { kind: 'playNext', query: 'calm down rema' } })
  })
  it('confirms what it will play', () => {
    expect(parseInstruction('play Calm Down by Rema', NOW).confirm).toMatch(/calm down/i)
    expect(parseInstruction('load Essence on deck a', NOW).confirm).toMatch(/deck a/i)
  })
})

describe('removing rules and confirmations', () => {
  it('"you can play Drake again" removes the ban', () => {
    expect(parseInstruction('you can play Drake again', NOW).items[0]).toEqual({ removeRule: 'banArtist', value: 'drake' })
  })
  it('confirms what it understood', () => {
    expect(parseInstruction("don't play drake", NOW).confirm).toMatch(/no drake/i)
  })
  it('says so when it did not understand', () => {
    const p = parseInstruction('the moon is made of cheese', NOW)
    expect(p.understood).toBe(false)
  })
  it('labels rules for chips', () => {
    expect(ruleLabel({ kind: 'tempoRange', max: 110 })).toBe('≤ 110 BPM')
    expect(ruleLabel({ kind: 'banArtist', artist: 'drake' })).toBe('No Drake')
  })
})

describe('model fallback', () => {
  it('accepts whitelisted rules and drops anything else', () => {
    const p = parseModelInstructions('{"rules":[{"kind":"banArtist","artist":"Kanye"},{"kind":"rm -rf"}],"actions":[{"type":"skip"},{"type":"format"}]}', NOW)
    expect(p.items).toEqual([{ rule: { kind: 'banArtist', artist: 'kanye' } }, { action: { type: 'skip' } }])
  })
})
