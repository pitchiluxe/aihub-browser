import type { SupabaseClient } from '@supabase/supabase-js'
import type { VoicePeer } from './signaling'

/**
 * The same relay, one hop further out.
 *
 * `signaling.ts` said it plainly: "Swapping this module's `send` for a
 * server-backed one is the entire change needed to make it reach further — the
 * peer connection code above it does not move." This is that swap, and the
 * claim held. `useVoiceSession.ts` is unchanged except for where it reads its
 * ICE servers from.
 *
 * ── Peer ids had to grow ──────────────────────────────────────────────────
 *
 * `e.sender.id` is a webContents id: unique inside one process, and emphatically
 * not across five machines. Two laptops would each call their first window "1",
 * each would answer the other's offers as if they were its own, and the
 * negotiation would collapse in a way that looks exactly like a firewall
 * problem. Hence `${deviceId}:${webContentsId}`.
 *
 * ── Presence for the roster, broadcast for the traffic ────────────────────
 *
 * The roster lives in Realtime Presence rather than in messages the devices
 * exchange, because a roster assembled from join and leave announcements is
 * only as correct as the last announcement that arrived — a laptop that loses
 * power sends no goodbye, and everyone keeps a tile for a person who is gone.
 * Presence is dropped by the server when the socket dies, so a crash and a
 * polite disconnect look the same to everybody else, which is the only way a
 * roster stays true.
 *
 * SDP and ICE go over broadcast: they are addressed to exactly one peer and are
 * meaningless a second later, which is the opposite of state.
 */

/** Globally unique across machines. `${deviceId}:${webContentsId}`. */
export type PeerId = string

export function compositePeerId(deviceId: string, webContentsId: number | string): PeerId {
  return `${deviceId}:${webContentsId}`
}

/** Split on the FIRST colon: a device id is a uuid and a webContents id is
 *  numeric, but splitting on the last one would break the moment either format
 *  changes, and this is not a thing worth re-debugging later. */
export function deviceOf(peerId: PeerId): string {
  const gap = peerId.indexOf(':')
  return gap === -1 ? peerId : peerId.slice(0, gap)
}

export function windowOf(peerId: PeerId): string {
  const gap = peerId.indexOf(':')
  return gap === -1 ? peerId : peerId.slice(gap + 1)
}

/**
 * Should this signal go through the in-process relay?
 *
 * A window on this machine is reachable directly, and sending its offer to
 * Frankfurt and back to reach the window beside it would add a round trip to
 * every negotiation for no gain.
 */
export function isLocalPeer(peerId: PeerId, deviceId: string): boolean {
  return deviceOf(peerId) === deviceId
}

export interface RemoteSignalingDeps {
  client: SupabaseClient
  deviceId: string
  /** Deliver to a window of THIS process. The existing sendToPeer. */
  deliver: (peerId: PeerId, channel: string, payload: unknown) => void
  /** Fired when the roster changes, so the caller can re-broadcast occupancy. */
  onRoster: () => void
}

export function createRemoteSignaling(deps: RemoteSignalingDeps) {
  const { client, deviceId, deliver, onRoster } = deps

  /** This device's own peers, mirrored into Presence. */
  const mine = new Map<PeerId, VoicePeer>()
  let others: VoicePeer[] = []

  const channel = client.channel('community:voice', {
    config: { presence: { key: deviceId }, broadcast: { self: false } },
  })

  const readRoster = (): void => {
    const raw = channel.presenceState() as Record<string, { peers?: VoicePeer[] }[]>
    const flat: VoicePeer[] = []
    for (const [key, entries] of Object.entries(raw)) {
      if (key === deviceId) continue
      for (const entry of entries) {
        for (const peer of entry?.peers ?? []) {
          if (peer?.peerId) flat.push(peer)
        }
      }
    }
    others = flat
    onRoster()
  }

  channel
    .on('presence', { event: 'sync' }, readRoster)
    .on('presence', { event: 'join' }, readRoster)
    .on('presence', { event: 'leave' }, readRoster)
    .on('broadcast', { event: 'signal' }, ({ payload }: { payload: unknown }) => {
      const note = payload as { from?: PeerId; to?: PeerId; payload?: unknown }
      if (!note?.from || !note.to) return
      // Addressed to one of my windows, or it is not my business. Every device
      // sees every signal on this channel; this is the filter that makes it a
      // point-to-point relay rather than a party line.
      if (!isLocalPeer(note.to, deviceId)) return
      deliver(note.to, 'community:voice:signal', { from: note.from, to: note.to, payload: note.payload })
    })
    .on('broadcast', { event: 'bye' }, ({ payload }: { payload: unknown }) => {
      const note = payload as { from?: PeerId; channel?: string }
      if (!note?.from) return
      // Tear down every local connection to the peer that left. Without this
      // the remaining peers keep a dead RTCPeerConnection and a frozen frame.
      for (const peer of mine.values()) {
        if (note.channel && peer.channel !== note.channel) continue
        deliver(peer.peerId, 'community:voice:signal', { from: note.from, payload: { type: 'bye' } })
      }
    })

  let subscribed: Promise<void> | null = null
  const ensure = (): Promise<void> => {
    subscribed ??= new Promise<void>(resolve => {
      channel.subscribe(status => { if (status === 'SUBSCRIBED') resolve() })
    })
    return subscribed
  }

  const publish = async (): Promise<void> => {
    await ensure()
    await channel.track({ peers: [...mine.values()] })
  }

  return {
    /**
     * Enter a voice room, and return the peers already in it on other devices.
     *
     * The convention from signaling.ts holds and must: the *arriving* peer
     * offers. If both sides offered on sight every pair would negotiate twice
     * and glare.
     */
    async join(peerId: PeerId, memberId: string, room: string): Promise<VoicePeer[]> {
      const existing = mine.get(peerId)
      mine.set(peerId, {
        peerId, memberId, channel: room,
        muted: existing?.muted ?? false,
        deafened: existing?.deafened ?? false,
        camera: false,
        sharing: false,
      })
      await publish()
      return others.filter(p => p.channel === room)
    },

    async leave(peerId: PeerId): Promise<void> {
      const peer = mine.get(peerId)
      if (!peer) return
      mine.delete(peerId)
      await publish()
      await ensure()
      await channel.send({
        type: 'broadcast', event: 'bye',
        payload: { from: peerId, channel: peer.channel },
      })
    },

    async setState(peerId: PeerId, patch: Partial<VoicePeer>): Promise<void> {
      const peer = mine.get(peerId)
      if (!peer) return
      Object.assign(peer, patch)
      await publish()
    },

    /** Relay one signaling message to a peer on another device. `from` is
     *  stamped by the caller from its own id, never read out of the payload. */
    async signal(from: PeerId, to: PeerId, payload: unknown): Promise<boolean> {
      const sender = mine.get(from)
      const target = others.find(p => p.peerId === to)
      // Same rule as the in-process hub: signalling someone outside your room
      // is being able to call anyone.
      if (!sender || !target || sender.channel !== target.channel) return false
      await ensure()
      await channel.send({ type: 'broadcast', event: 'signal', payload: { from, to, payload } })
      return true
    },

    /** Everyone in a room, this device's peers and everyone else's. */
    participants(room: string): VoicePeer[] {
      return [
        ...[...mine.values()].filter(p => p.channel === room),
        ...others.filter(p => p.channel === room),
      ]
    },

    occupancy(): Record<string, VoicePeer[]> {
      const out: Record<string, VoicePeer[]> = {}
      for (const peer of [...mine.values(), ...others]) (out[peer.channel] ??= []).push(peer)
      return out
    },

    remotePeers: () => others,

    async stop(): Promise<void> {
      mine.clear()
      try { await channel.untrack() } catch { /* socket already gone */ }
      try { await channel.unsubscribe() } catch { /* already gone */ }
      others = []
    },
  }
}

export type RemoteSignaling = ReturnType<typeof createRemoteSignaling>
