import { AccessToken } from 'livekit-server-sdk'
import type { LiveKitConfig } from './backendConfig'

/**
 * Join tokens for the voice rooms.
 *
 * ── Why an SFU replaced the peer mesh ─────────────────────────────────────
 *
 * The first implementation was a full mesh: every participant held an
 * RTCPeerConnection to every other, and the main process relayed the SDP. It
 * works, and it does not scale or travel. Five people in a room is twenty
 * connections and five uplinks of everyone's video from each machine, and none
 * of it crosses a NAT without a TURN server somebody has to run and pay for.
 *
 * An SFU takes one uplink per person and fans it out. It also terminates the
 * media itself, so traversal is its problem rather than the app's — which is
 * why the ICE server fields become irrelevant the moment LiveKit is configured.
 *
 * The mesh is still there and still used when LiveKit is not configured, so a
 * community with no backend at all keeps working between windows.
 *
 * ── Why the token is minted here ──────────────────────────────────────────
 *
 * A LiveKit token is a JWT signed with the project's API secret, and it carries
 * the grants — which room, may publish, may subscribe. Signing it in the
 * renderer would mean shipping the secret to the renderer, and the renderer of
 * this app composes untrusted web content. So the secret stays on the same side
 * of the wall as the identity private key, and the renderer receives a token
 * that is good for one room and expires.
 */

/**
 * Room names are namespaced.
 *
 * A LiveKit project is shared infrastructure — the same one may already be
 * serving another app of the user's, whose rooms are named `breakroom:<name>`.
 * Without a prefix, an AIHub channel called "general" and some other app's
 * channel called "general" would be the same room, and the two sets of people
 * would find themselves unexpectedly in a call together.
 */
export function roomNameFor(channelSlug: string): string {
  return `aihub:${channelSlug}`
}

export interface VoiceToken {
  token: string
  url: string
  room: string
  identity: string
}

/**
 * Mint a join token for one member, one room.
 *
 * `identity` is the community member id rather than the handle: LiveKit treats
 * identity as unique within a room and will disconnect an earlier participant
 * that reconnects under the same one. The member id is stable and unique; a
 * handle is neither, since two people can rename around each other.
 */
export async function mintVoiceToken(
  livekit: LiveKitConfig,
  input: { memberId: string; handle: string; channelSlug: string },
  ttl: string = '8h',
): Promise<VoiceToken> {
  const room = roomNameFor(input.channelSlug)

  const at = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity: input.memberId,
    name: input.handle,
    ttl,
  })

  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    // Typing indicators ride the data channel rather than a table, the way the
    // QuickBooks breakroom does it — a keystroke is not worth a database write.
    canPublishData: true,
    hidden: false,
  })

  return { token: await at.toJwt(), url: livekit.url, room, identity: input.memberId }
}
