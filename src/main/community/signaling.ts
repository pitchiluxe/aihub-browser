/**
 * The signaling channel for voice, video and screen share.
 *
 * WebRTC never specified what carries its signaling. A peer connection needs
 * exactly three things moved between two endpoints — an offer, an answer, and
 * ICE candidates — by any means at all, and it cannot tell what moved them.
 * Forwarding those messages between two BrowserWindows through the main process
 * satisfies that contract completely, which is why the media path here is real
 * rather than mocked: two windows of this app hold a genuine RTCPeerConnection
 * with genuine audio and video tracks flowing over it.
 *
 * The honest limit is reach, not fidelity. With no STUN or TURN server
 * configured this connects over loopback and usually over a LAN, and not across
 * NATs; and the relay only knows about windows of this process, so it joins the
 * people at this machine rather than the people in the community. Swapping this
 * module's `send` for a server-backed one is the entire change needed to make
 * it reach further — the peer connection code above it does not move.
 *
 * `send` is injected so every rule below can be tested without a window.
 */

export interface SignalMessage {
  /** Peer that sent it. Assigned by the hub; never taken from the payload. */
  from: string
  to: string
  /** Opaque to this module: SDP, an ICE candidate, or a control frame. */
  payload: unknown
}

export interface VoicePeer {
  peerId: string
  memberId: string
  channel: string
  muted: boolean
  deafened: boolean
  camera: boolean
  sharing: boolean
}

type Send = (peerId: string, channel: string, payload: unknown) => void

export function createSignalingHub(send: Send) {
  const peers = new Map<string, VoicePeer>()

  const inChannel = (channel: string): VoicePeer[] =>
    [...peers.values()].filter(p => p.channel === channel)

  /** Tell everyone in a room who is in it now. One shape for join, leave and
   *  state changes, so the renderer has a single reducer instead of three. */
  const announce = (channel: string): void => {
    const roster = inChannel(channel)
    for (const peer of roster) {
      send(peer.peerId, 'community:voice:peers', { channel, peers: roster })
    }
  }

  return {
    /**
     * Enter a voice room.
     *
     * Returns the peers already present so the joiner can offer to each of
     * them. The convention is that the *arriving* peer offers: if both sides
     * offered on sight, every pair would negotiate twice and glare.
     */
    join(peerId: string, memberId: string, channel: string): VoicePeer[] {
      const existing = peers.get(peerId)
      if (existing && existing.channel !== channel) {
        const previous = existing.channel
        peers.delete(peerId)
        announce(previous)
      }

      const others = inChannel(channel)
      peers.set(peerId, {
        peerId, memberId, channel,
        muted: existing?.muted ?? false,
        deafened: existing?.deafened ?? false,
        camera: false,
        sharing: false,
      })
      announce(channel)
      return others
    },

    leave(peerId: string): void {
      const peer = peers.get(peerId)
      if (!peer) return
      peers.delete(peerId)
      announce(peer.channel)
      // Tell the room to tear down its connection to them. Without this the
      // remaining peers keep a dead RTCPeerConnection and a frozen last frame.
      for (const other of inChannel(peer.channel)) {
        send(other.peerId, 'community:voice:signal', { from: peer.peerId, payload: { type: 'bye' } })
      }
    },

    /**
     * Relay one signaling message.
     *
     * `from` is stamped from the caller's own peer id rather than read out of
     * the message, so a peer cannot impersonate another peer's offer. Delivery
     * to someone outside the sender's room is refused for the same reason:
     * signaling is how a connection starts, so being able to signal anyone is
     * being able to call anyone.
     */
    signal(fromPeerId: string, toPeerId: string, payload: unknown): boolean {
      const from = peers.get(fromPeerId)
      const to = peers.get(toPeerId)
      if (!from || !to || from.channel !== to.channel) return false

      send(toPeerId, 'community:voice:signal', { from: fromPeerId, to: toPeerId, payload })
      return true
    },

    /** Mic, camera, deafen and screen-share flags, mirrored to the room. */
    setState(peerId: string, patch: Partial<Pick<VoicePeer, 'muted' | 'deafened' | 'camera' | 'sharing'>>): void {
      const peer = peers.get(peerId)
      if (!peer) return
      Object.assign(peer, patch)
      announce(peer.channel)
    },

    participants(channel: string): VoicePeer[] {
      return inChannel(channel)
    },

    /** Every occupied room, for the channel sidebar. */
    occupancy(): Record<string, VoicePeer[]> {
      const out: Record<string, VoicePeer[]> = {}
      for (const peer of peers.values()) (out[peer.channel] ??= []).push(peer)
      return out
    },

    /** A window closing is the common case — nobody clicks Disconnect first. */
    dropPeer(peerId: string): void {
      this.leave(peerId)
    },
  }
}

export type SignalingHub = ReturnType<typeof createSignalingHub>
