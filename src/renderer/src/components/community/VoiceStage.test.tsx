import { describe, it, expect } from 'vitest'
import { stageIsLive, pickFocus } from './VoiceStage'
import type { VoicePeer } from './useVoiceSession'

const peer = (over: Partial<VoicePeer>): VoicePeer => ({
  peerId: 'p1', memberId: 'm1', channel: 'voice',
  muted: false, deafened: false, camera: false, sharing: false, ...over,
})

describe('stageIsLive', () => {
  it('is false when nobody has a camera or a share on', () => {
    expect(stageIsLive([peer({}), peer({ peerId: 'p2' })])).toBe(false)
  })

  it('is false for an empty room', () => {
    expect(stageIsLive([])).toBe(false)
  })

  it('is true when someone has a camera on', () => {
    expect(stageIsLive([peer({}), peer({ peerId: 'p2', camera: true })])).toBe(true)
  })

  it('is true when someone is sharing a screen', () => {
    expect(stageIsLive([peer({ sharing: true })])).toBe(true)
  })
})

describe('pickFocus', () => {
  it('prefers a screen share over a camera', () => {
    const peers = [peer({ peerId: 'cam', camera: true }), peer({ peerId: 'screen', sharing: true })]
    expect(pickFocus(peers, null)).toBe('screen')
  })

  it('prefers the earliest sharer when two people share at once', () => {
    const peers = [peer({ peerId: 'a', sharing: true }), peer({ peerId: 'b', sharing: true })]
    expect(pickFocus(peers, null)).toBe('a')
  })

  it('honours an explicit choice over the sharer', () => {
    const peers = [peer({ peerId: 'a', sharing: true }), peer({ peerId: 'b', camera: true })]
    expect(pickFocus(peers, 'b')).toBe('b')
  })

  it('falls back to the sharer when the chosen peer has left', () => {
    const peers = [peer({ peerId: 'a', sharing: true })]
    expect(pickFocus(peers, 'gone')).toBe('a')
  })

  it('falls back to the first camera when nobody is sharing', () => {
    const peers = [peer({ peerId: 'a' }), peer({ peerId: 'b', camera: true })]
    expect(pickFocus(peers, null)).toBe('b')
  })

  it('falls back to the first peer when nobody has any video at all', () => {
    const peers = [peer({ peerId: 'a' }), peer({ peerId: 'b' })]
    expect(pickFocus(peers, null)).toBe('a')
  })

  it('is null for an empty room rather than throwing', () => {
    expect(pickFocus([], null)).toBe(null)
  })
})
