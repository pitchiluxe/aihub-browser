import { describe, it, expect, beforeEach } from 'vitest'
import { openDirectMessage, directMessagesFor, activeChannels } from './admin'
import { postMessage, visibleMessages } from './store'
import { searchCommunity } from './search'
import { migrateState } from '../../shared/communityMigrate'
import type { CommunityState, Member } from '../../shared/community'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000
let counter = 0
const newId = () => `gen-${++counter}`

function member(id: string): Member {
  return { id, handle: id, handleKey: id, avatarSeed: id, createdAt: NOW - 3 * DAY }
}

let state: CommunityState

beforeEach(() => {
  counter = 0
  state = migrateState({})
  for (const id of ['grace', 'sam', 'alex']) state.members[id] = member(id)
})

function openDm(a = 'grace', b = 'sam') {
  const result = openDirectMessage(state, a, b, NOW, newId)
  if (!result.ok) throw new Error(result.error)
  return result.channel
}

describe('opening a direct message', () => {
  it('creates a dm channel with both participants', () => {
    const channel = openDm()

    expect(channel.type).toBe('dm')
    expect([...(channel.participants ?? [])].sort()).toEqual(['grace', 'sam'])
  })

  it('returns the same conversation whichever side opens it', () => {
    const first = openDirectMessage(state, 'grace', 'sam', NOW, newId)
    const second = openDirectMessage(state, 'sam', 'grace', NOW + 1000, newId)

    expect(first.ok && second.ok).toBe(true)
    expect(first.ok && second.ok && first.channel.slug).toBe(second.ok ? second.channel.slug : '')
    expect(Object.values(state.channels).filter(c => c.type === 'dm')).toHaveLength(1)
  })

  it('refuses a conversation with yourself', () => {
    expect(openDirectMessage(state, 'grace', 'grace', NOW, newId).ok).toBe(false)
  })

  it('refuses a member who does not exist', () => {
    expect(openDirectMessage(state, 'grace', 'nobody', NOW, newId).ok).toBe(false)
  })

  it('refuses a banned member', () => {
    state.members['sam'].bannedAt = NOW
    expect(openDirectMessage(state, 'grace', 'sam', NOW, newId).ok).toBe(false)
  })

  it('needs no special permission — any member may start one', () => {
    // A DM is not an administrative act. Gating it behind a permission would
    // make the community's most ordinary interaction the most privileged one.
    expect(openDirectMessage(state, 'alex', 'sam', NOW, newId).ok).toBe(true)
  })
})

describe('direct messages stay between their participants', () => {
  let slug = ''
  beforeEach(() => {
    slug = openDm().slug
    postMessage(state, { memberId: 'grace', channel: slug, kind: 'text', body: 'just between us' }, NOW, newId)
  })

  it('lets a participant post', () => {
    const result = postMessage(state, {
      memberId: 'sam', channel: slug, kind: 'text', body: 'understood',
    }, NOW + 10_000, newId)

    expect(result.ok).toBe(true)
  })

  it('refuses a post from anyone else', () => {
    const result = postMessage(state, {
      memberId: 'alex', channel: slug, kind: 'text', body: 'let me in',
    }, NOW + 10_000, newId)

    expect(result.ok).toBe(false)
  })

  it('shows the conversation to a participant', () => {
    expect(visibleMessages(state, slug, 'sam')).toHaveLength(1)
  })

  it('shows nothing at all to anyone else', () => {
    // Not a filtered list — nothing. A non-participant should not be able to
    // learn that the conversation has messages in it, let alone how many.
    expect(visibleMessages(state, slug, 'alex')).toEqual([])
  })

  it('keeps direct messages out of search for everyone but the participants', () => {
    expect(searchCommunity(state, 'sam', 'between', {}).messages).toHaveLength(1)
    expect(searchCommunity(state, 'alex', 'between', {}).messages).toEqual([])
  })

  it('keeps direct messages out of the channel sidebar', () => {
    // They belong in their own list, not filed under a category with the
    // public rooms.
    expect(activeChannels(state).some(c => c.slug === slug)).toBe(false)
  })

  it('lists a member\'s own conversations', () => {
    const mine = directMessagesFor(state, 'grace')
    expect(mine.map(c => c.slug)).toEqual([slug])
    expect(directMessagesFor(state, 'alex')).toEqual([])
  })

  it('names the conversation after the other person', () => {
    const [forGrace] = directMessagesFor(state, 'grace')
    expect(forGrace.name).toBe('sam')
    const [forSam] = directMessagesFor(state, 'sam')
    expect(forSam.name).toBe('grace')
  })
})
