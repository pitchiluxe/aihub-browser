import { describe, it, expect, beforeEach } from 'vitest'
import { createSignalingHub } from './signaling'

let sent: { peerId: string; channel: string; payload: any }[]
let hub: ReturnType<typeof createSignalingHub>

beforeEach(() => {
  sent = []
  hub = createSignalingHub((peerId, channel, payload) => sent.push({ peerId, channel, payload }))
})

const signalsTo = (peerId: string) =>
  sent.filter(s => s.peerId === peerId && s.channel === 'community:voice:signal')

describe('joining a voice room', () => {
  it('returns the peers already there, so the arriver offers to each', () => {
    hub.join('p1', 'grace', 'voice-lounge')
    const others = hub.join('p2', 'sam', 'voice-lounge')

    // The arriving peer offers. If both sides offered on sight every pair
    // would negotiate twice and glare.
    expect(others.map(p => p.peerId)).toEqual(['p1'])
  })

  it('returns nothing for the first peer in an empty room', () => {
    expect(hub.join('p1', 'grace', 'voice-lounge')).toEqual([])
  })

  it('tells everyone in the room who is in it', () => {
    hub.join('p1', 'grace', 'voice-lounge')
    sent.length = 0
    hub.join('p2', 'sam', 'voice-lounge')

    const roster = sent.filter(s => s.channel === 'community:voice:peers')
    expect(roster.map(s => s.peerId).sort()).toEqual(['p1', 'p2'])
    expect(roster[0].payload.peers).toHaveLength(2)
  })

  it('does not tell another room anything', () => {
    hub.join('p1', 'grace', 'voice-lounge')
    sent.length = 0
    hub.join('p2', 'sam', 'voice-workshop')

    expect(sent.some(s => s.peerId === 'p1')).toBe(false)
  })

  it('moves a peer that joins a second room', () => {
    hub.join('p1', 'grace', 'voice-lounge')
    hub.join('p1', 'grace', 'voice-workshop')

    expect(hub.participants('voice-lounge')).toEqual([])
    expect(hub.participants('voice-workshop').map(p => p.peerId)).toEqual(['p1'])
  })
})

describe('relaying signals', () => {
  beforeEach(() => {
    hub.join('p1', 'grace', 'voice-lounge')
    hub.join('p2', 'sam', 'voice-lounge')
    sent.length = 0
  })

  it('delivers an offer to the named peer', () => {
    expect(hub.signal('p1', 'p2', { type: 'offer', sdp: 'v=0' })).toBe(true)

    expect(signalsTo('p2')).toHaveLength(1)
    expect(signalsTo('p2')[0].payload.payload).toEqual({ type: 'offer', sdp: 'v=0' })
  })

  it('stamps the sender rather than trusting the message', () => {
    hub.signal('p1', 'p2', { type: 'offer', from: 'p2' })

    // Otherwise any peer can put another peer's id on an offer, and the
    // receiver answers a call it thinks came from someone it trusts.
    expect(signalsTo('p2')[0].payload.from).toBe('p1')
  })

  it('refuses to signal a peer in another room', () => {
    hub.join('p3', 'alex', 'voice-workshop')
    sent.length = 0

    // Signaling is how a call starts, so being able to signal anyone is being
    // able to ring anyone.
    expect(hub.signal('p1', 'p3', { type: 'offer' })).toBe(false)
    expect(signalsTo('p3')).toHaveLength(0)
  })

  it('refuses to signal a peer that is not in a call at all', () => {
    expect(hub.signal('p1', 'ghost', { type: 'offer' })).toBe(false)
  })

  it('refuses a signal from a peer that never joined', () => {
    expect(hub.signal('ghost', 'p2', { type: 'offer' })).toBe(false)
    expect(signalsTo('p2')).toHaveLength(0)
  })
})

describe('leaving', () => {
  beforeEach(() => {
    hub.join('p1', 'grace', 'voice-lounge')
    hub.join('p2', 'sam', 'voice-lounge')
    sent.length = 0
  })

  it('removes the peer from the room', () => {
    hub.leave('p1')
    expect(hub.participants('voice-lounge').map(p => p.peerId)).toEqual(['p2'])
  })

  it('tells the remaining peers to tear the connection down', () => {
    hub.leave('p1')

    // Without this the others keep a dead RTCPeerConnection and a frozen frame.
    expect(signalsTo('p2').some(s => s.payload.payload?.type === 'bye')).toBe(true)
  })

  it('handles a window vanishing without a goodbye', () => {
    hub.dropPeer('p1')
    expect(hub.participants('voice-lounge').map(p => p.peerId)).toEqual(['p2'])
  })

  it('ignores a leave from a peer that was never here', () => {
    expect(() => hub.leave('ghost')).not.toThrow()
  })
})

describe('mic, camera and screen state', () => {
  beforeEach(() => {
    hub.join('p1', 'grace', 'voice-lounge')
    hub.join('p2', 'sam', 'voice-lounge')
    sent.length = 0
  })

  it('mirrors a mute to the whole room', () => {
    hub.setState('p1', { muted: true })

    const roster = sent.filter(s => s.channel === 'community:voice:peers')
    expect(roster.map(s => s.peerId).sort()).toEqual(['p1', 'p2'])
    expect(roster[0].payload.peers.find((p: any) => p.peerId === 'p1').muted).toBe(true)
  })

  it('tracks camera and screen sharing separately', () => {
    hub.setState('p1', { camera: true })
    hub.setState('p1', { sharing: true })

    const peer = hub.participants('voice-lounge').find(p => p.peerId === 'p1')!
    expect(peer.camera).toBe(true)
    expect(peer.sharing).toBe(true)
  })

  it('carries mute state across a room change', () => {
    hub.setState('p1', { muted: true })
    hub.join('p1', 'grace', 'voice-workshop')

    // Someone who muted themselves stays muted when they walk into the next
    // room. Un-muting them silently is how people get overheard.
    expect(hub.participants('voice-workshop')[0].muted).toBe(true)
  })

  it('ignores state for a peer that is not in a call', () => {
    expect(() => hub.setState('ghost', { muted: true })).not.toThrow()
  })
})

describe('occupancy', () => {
  it('lists every room that has somebody in it', () => {
    hub.join('p1', 'grace', 'voice-lounge')
    hub.join('p2', 'sam', 'voice-workshop')

    const occupancy = hub.occupancy()
    expect(Object.keys(occupancy).sort()).toEqual(['voice-lounge', 'voice-workshop'])
  })

  it('drops a room once it empties', () => {
    hub.join('p1', 'grace', 'voice-lounge')
    hub.leave('p1')

    expect(hub.occupancy()['voice-lounge']).toBeUndefined()
  })
})
