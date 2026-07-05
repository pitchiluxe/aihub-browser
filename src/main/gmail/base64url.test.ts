import { describe, it, expect } from 'vitest'
import { b64urlEncode, b64urlDecode } from './base64url'

describe('base64url', () => {
  it('encodes without padding and url-safe alphabet', () => {
    expect(b64urlEncode('subjects?>>')).toBe(Buffer.from('subjects?>>').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
  })
  it('round-trips a buffer', () => {
    const buf = Buffer.from([0, 255, 16, 128, 63, 40])
    expect(b64urlDecode(b64urlEncode(buf)).equals(buf)).toBe(true)
  })
  it('decodes a value missing padding', () => {
    expect(b64urlDecode('YQ').toString()).toBe('a')
  })
})
