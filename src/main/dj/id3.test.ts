import { describe, it, expect } from 'vitest'
import { parseId3, id3TagSize } from './id3'

function frame23(id: string, data: Buffer): Buffer {
  const h = Buffer.alloc(10)
  h.write(id, 0, 'latin1')
  h.writeUInt32BE(data.length, 4)
  return Buffer.concat([h, data])
}

function textFrame(id: string, s: string, enc = 3): Buffer {
  const body = enc === 1 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]) : Buffer.from(s, 'utf8')
  return frame23(id, Buffer.concat([Buffer.from([enc]), body]))
}

function tag23(frames: Buffer[], padding = 32): Buffer {
  const body = Buffer.concat([...frames, Buffer.alloc(padding)])
  const h = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])
  let n = body.length
  for (let i = 9; i >= 6; i--) { h[i] = n & 0x7f; n >>= 7 }
  return Buffer.concat([h, body])
}

describe('id3', () => {
  it('reports no tag for plain audio', () => {
    expect(id3TagSize(Buffer.from([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0]))).toBe(0)
    expect(parseId3(Buffer.alloc(20))).toEqual({})
  })

  it('reads text frames in utf8 and utf16', () => {
    const buf = tag23([
      textFrame('TIT2', 'WAIT FOR U'),
      textFrame('TPE1', 'Future', 1),
      textFrame('TALB', 'I Never Liked You'),
      textFrame('TBPM', '85'),
      textFrame('TKEY', 'C#m'),
    ])
    expect(id3TagSize(buf)).toBe(buf.length)
    const t = parseId3(buf)
    expect(t).toMatchObject({ title: 'WAIT FOR U', artist: 'Future', album: 'I Never Liked You', bpm: 85, key: 'C#m' })
  })

  it('extracts the attached picture', () => {
    const img = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const apic = Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0', 'latin1'), Buffer.from([3]), Buffer.from('cover\0', 'latin1'), img])
    const t = parseId3(tag23([frame23('APIC', apic)]))
    expect(t.cover?.mime).toBe('image/jpeg')
    expect(t.cover?.data.equals(img)).toBe(true)
  })

  it('stops cleanly on a truncated frame', () => {
    const buf = tag23([textFrame('TIT2', 'ok')])
    const bad = Buffer.concat([buf.subarray(0, buf.length - 32), Buffer.from('TPE1'), Buffer.from([0, 0, 9, 9])])
    expect(parseId3(bad).title).toBe('ok')
  })
})
