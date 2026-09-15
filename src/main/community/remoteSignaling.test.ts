import { describe, it, expect } from 'vitest'
import { compositePeerId, deviceOf, windowOf, isLocalPeer } from './remoteSignaling'

const DEVICE_A = '9f0c1e2a-0000-4000-8000-000000000000'
const DEVICE_B = '1b2c3d4e-0000-4000-8000-000000000000'

describe('compositePeerId', () => {
  it('is unique across machines that share a webContents id', () => {
    // The whole bug: every Electron process numbers its first window 1.
    expect(compositePeerId(DEVICE_A, 1)).not.toBe(compositePeerId(DEVICE_B, 1))
  })

  it('round-trips its device half', () => {
    expect(deviceOf(compositePeerId(DEVICE_A, 7))).toBe(DEVICE_A)
  })

  it('round-trips its window half', () => {
    expect(windowOf(compositePeerId(DEVICE_A, 7))).toBe('7')
  })

  it('survives a device id containing dashes', () => {
    expect(deviceOf(compositePeerId(DEVICE_A, 3))).toBe(DEVICE_A)
    expect(windowOf(compositePeerId(DEVICE_A, 3))).toBe('3')
  })

  it('accepts a numeric or string window id identically', () => {
    expect(compositePeerId(DEVICE_A, 5)).toBe(compositePeerId(DEVICE_A, '5'))
  })
})

describe('deviceOf and windowOf on a bare id', () => {
  it('treats an id with no colon as its own device, rather than throwing', () => {
    expect(deviceOf('legacy')).toBe('legacy')
    expect(windowOf('legacy')).toBe('legacy')
  })
})

describe('isLocalPeer', () => {
  it('routes a same-device peer through the in-process relay', () => {
    expect(isLocalPeer(compositePeerId(DEVICE_A, 2), DEVICE_A)).toBe(true)
  })

  it('routes another device through the realtime relay', () => {
    expect(isLocalPeer(compositePeerId(DEVICE_B, 2), DEVICE_A)).toBe(false)
  })

  it('is not fooled by a window id that matches the other device id', () => {
    expect(isLocalPeer(compositePeerId(DEVICE_B, 1), DEVICE_A)).toBe(false)
  })
})
