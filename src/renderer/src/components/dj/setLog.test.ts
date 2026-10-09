import { describe, it, expect } from 'vitest'
import { fmtStamp, formatTracklist, type SetEntry } from './setLog'

const e = (at: number, artist: string, title: string, bpm: number | null = null, key: string | null = null): SetEntry =>
  ({ at, artist, title, bpm, key, token: `${artist}${title}` })

describe('set log', () => {
  it('stamps minutes, and hours only when needed', () => {
    expect(fmtStamp(0)).toBe('00:00')
    expect(fmtStamp(61_000)).toBe('01:01')
    expect(fmtStamp(3_725_000)).toBe('1:02:05')
  })

  it('times the list from the first song', () => {
    const list = formatTracklist([e(50_000, 'Wizkid', 'Essence'), e(290_000, '', 'Solo Track')])
    expect(list).toBe('00:00 Wizkid - Essence\n04:00 Solo Track')
  })

  it('can add tempo and key', () => {
    expect(formatTracklist([e(0, 'A', 'B', 123.6, '8A')], true)).toBe('00:00 A - B (124 BPM, 8A)')
  })

  it('is empty for an empty set', () => {
    expect(formatTracklist([])).toBe('')
  })
})
