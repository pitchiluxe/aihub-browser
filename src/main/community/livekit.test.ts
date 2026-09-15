import { describe, it, expect } from 'vitest'
import { roomNameFor, mintVoiceToken } from './livekit'

const project = {
  url: 'wss://example.livekit.cloud',
  apiKey: 'APIabc123',
  apiSecret: 'a-secret-long-enough-to-sign-with-hs256',
}

function claimsOf(jwt: string): any {
  const [, payload] = jwt.split('.')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

describe('roomNameFor', () => {
  it('namespaces the channel so a shared LiveKit project cannot collide', () => {
    // The QuickBooks app on the same project uses `breakroom:general`.
    expect(roomNameFor('general')).toBe('aihub:general')
    expect(roomNameFor('general')).not.toBe('breakroom:general')
  })

  it('is stable for the same slug', () => {
    expect(roomNameFor('lounge')).toBe(roomNameFor('lounge'))
  })
})

describe('mintVoiceToken', () => {
  const input = { memberId: 'member-1', handle: 'alpha', channelSlug: 'lounge' }

  it('returns the project url and the namespaced room alongside the token', async () => {
    const out = await mintVoiceToken(project, input)
    expect(out.url).toBe('wss://example.livekit.cloud')
    expect(out.room).toBe('aihub:lounge')
    expect(out.identity).toBe('member-1')
  })

  it('signs a JWT that carries a join grant for exactly that room', async () => {
    const out = await mintVoiceToken(project, input)
    const claims = claimsOf(out.token)
    expect(claims.video.room).toBe('aihub:lounge')
    expect(claims.video.roomJoin).toBe(true)
    expect(claims.video.canPublish).toBe(true)
    expect(claims.video.canSubscribe).toBe(true)
    expect(claims.video.canPublishData).toBe(true)
  })

  it('identifies the participant by member id, not by handle', async () => {
    // Two people renaming around each other must not become the same
    // participant, and LiveKit evicts a duplicate identity from the room.
    const out = await mintVoiceToken(project, input)
    expect(claimsOf(out.token).sub).toBe('member-1')
    expect(claimsOf(out.token).name).toBe('alpha')
  })

  it('never puts the api secret in the token', async () => {
    const out = await mintVoiceToken(project, input)
    expect(out.token).not.toContain(project.apiSecret)
    expect(JSON.stringify(claimsOf(out.token))).not.toContain(project.apiSecret)
  })

  it('issues a token that expires', async () => {
    const out = await mintVoiceToken(project, input, '1h')
    const claims = claimsOf(out.token)
    expect(claims.exp).toBeGreaterThan(claims.iat ?? claims.nbf ?? 0)
  })

  it('scopes two channels to two different rooms', async () => {
    const a = await mintVoiceToken(project, { ...input, channelSlug: 'lounge' })
    const b = await mintVoiceToken(project, { ...input, channelSlug: 'workshop' })
    expect(claimsOf(a.token).video.room).not.toBe(claimsOf(b.token).video.room)
  })
})
