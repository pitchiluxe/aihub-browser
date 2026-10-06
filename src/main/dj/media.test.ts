import { describe, it, expect } from 'vitest'
import { parseRange, matchesQuery, isAudioFile } from './media'

describe('dj media helpers', () => {
  it('parses byte ranges', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('bytes=50-10', 100)).toBe('invalid')
    expect(parseRange('items=1-2', 100)).toBeNull()
  })

  it('matches every query word, case-insensitively', () => {
    expect(matchesQuery('Future - WAIT FOR U.mp3', 'wait future')).toBe(true)
    expect(matchesQuery('Future - WAIT FOR U.mp3', 'wait drake')).toBe(false)
    expect(matchesQuery('anything.mp3', '   ')).toBe(true)
  })

  it('recognises audio extensions only', () => {
    expect(isAudioFile('a.MP3')).toBe(true)
    expect(isAudioFile('a.flac')).toBe(true)
    expect(isAudioFile('a.exe')).toBe(false)
    expect(isAudioFile('mp3')).toBe(false)
  })
})
