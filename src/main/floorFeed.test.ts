import { describe, it, expect } from 'vitest'
import { fromBrowserOrRebound, parseFloorReading } from './floorFeed'

describe('floor feed readings', () => {
  it('takes 0..1 or percent, rejects anything else', () => {
    expect(parseFloorReading('{"energy":0.7,"source":"crowd-mic"}')).toEqual({ energy: 0.7, source: 'crowd-mic' })
    expect(parseFloorReading('{"energy":85}')).toEqual({ energy: 0.85, source: 'external' })
    expect(parseFloorReading('{"energy":-1}')).toBeNull()
    expect(parseFloorReading('{"energy":"loud"}')).toBeNull()
    expect(parseFloorReading('not json')).toBeNull()
  })

  it('refuses requests a web page could make', () => {
    const ok = { host: '127.0.0.1:47800', 'content-type': 'application/json' }
    expect(fromBrowserOrRebound(ok)).toBe(false)
    expect(fromBrowserOrRebound({ ...ok, origin: 'https://evil.example' })).toBe(true)
    expect(fromBrowserOrRebound({ ...ok, 'content-type': 'text/plain' })).toBe(true)
    expect(fromBrowserOrRebound({ ...ok, host: 'evil.example:47800' })).toBe(true)
  })
})
