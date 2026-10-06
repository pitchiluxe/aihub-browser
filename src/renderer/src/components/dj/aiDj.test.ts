import { describe, it, expect } from 'vitest'
import { parsePicks, buildPrompt } from './aiDj'
import { parseDuration, cleanVideoTitle } from './libraryData'

describe('AI DJ reply parsing', () => {
  it('reads a JSON array wrapped in chatter', () => {
    const r = 'Sure! Here is your set:\n```json\n[{"artist":"Daft Punk","title":"One More Time"},{"artist":"Kygo","title":"Firestone"}]\n```'
    expect(parsePicks(r)).toEqual([{ artist: 'Daft Punk', title: 'One More Time' }, { artist: 'Kygo', title: 'Firestone' }])
  })
  it('falls back to numbered "Artist - Title" lines and drops duplicates', () => {
    const r = 'Here you go:\n1. Burna Boy - Last Last\n2. **Wizkid - Essence** (feat. Tems)\n3. Burna Boy - Last Last'
    expect(parsePicks(r)).toEqual([{ artist: 'Burna Boy', title: 'Last Last' }, { artist: 'Wizkid', title: 'Essence' }])
  })
  it('accepts string entries in the array', () => {
    expect(parsePicks('["Adele - Hello", "Hello"]')).toEqual([{ artist: 'Adele', title: 'Hello' }, { artist: '', title: 'Hello' }])
  })
  it('returns nothing for a refusal', () => {
    expect(parsePicks('I cannot help with that.')).toEqual([])
  })
  it('asks for JSON and lists songs to avoid', () => {
    const p = buildPrompt('chill', 5, ['A - B'])
    expect(p).toContain('JSON')
    expect(p).toContain('A - B')
  })
  it('builds a set from the learnt taste when no vibe is given', () => {
    const p = buildPrompt('', 8, [], undefined, 'Artists they love most: Fally Ipupa.')
    expect(p).toContain('whose taste you know well')
    expect(p).toContain('Fally Ipupa')
    expect(p).not.toContain('Vibe:')
  })
})

describe('YouTube helpers', () => {
  it('parses durations', () => {
    expect(parseDuration('4:21')).toBe(261)
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration('')).toBeUndefined()
    expect(parseDuration('LIVE')).toBeUndefined()
  })
  it('cleans upload titles', () => {
    expect(cleanVideoTitle('Future - WAIT FOR U (Official Audio) ft. Drake, Tems', 'FutureVEVO')).toEqual({ artist: 'Future', title: 'WAIT FOR U ft. Drake, Tems' })
    expect(cleanVideoTitle('Essence', 'Wizkid - Topic')).toEqual({ artist: 'Wizkid', title: 'Essence' })
  })
})
