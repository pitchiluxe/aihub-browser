import { describe, it, expect, beforeEach } from 'vitest'
import { searchCommunity } from './search'
import { migrateState } from '../../shared/communityMigrate'
import type { CommunityState, Member, Message } from '../../shared/community'

const NOW = 1_700_000_000_000
let state: CommunityState
let seq = 0

function member(id: string, handle: string): Member {
  return { id, handle, handleKey: handle.toLowerCase(), avatarSeed: id, createdAt: NOW }
}

function say(authorId: string, channel: string, body: string, at = NOW + (seq += 1000)): Message {
  const message: Message = {
    id: `m${seq}`, channel, authorId,
    authorHandle: state.members[authorId].handle, authorSeed: authorId,
    kind: 'text', body, createdAt: at,
  }
  state.messages.push(message)
  return message
}

beforeEach(() => {
  seq = 0
  state = migrateState({})
  state.members['grace'] = member('grace', 'Grace')
  state.members['sam'] = member('sam', 'Sam')
  say('grace', 'general', 'The router keeps dropping the VLAN tag')
  say('sam', 'networking', 'VLAN trunking on a Cisco switch is fiddly')
  say('grace', 'ai', 'I fine-tuned a model on the router logs')
  say('sam', 'general', 'nothing to do with any of this')
})

const messagesFor = (query: string, opts = {}) =>
  searchCommunity(state, 'grace', query, opts).messages

describe('searchCommunity — messages', () => {
  it('finds messages containing the term', () => {
    const hits = messagesFor('vlan')
    expect(hits.map(h => h.message.channel).sort()).toEqual(['general', 'networking'])
  })

  it('is case-insensitive', () => {
    expect(messagesFor('VLAN')).toHaveLength(2)
    expect(messagesFor('vLaN')).toHaveLength(2)
  })

  it('requires every word, not any of them', () => {
    // "vlan cisco" should mean both. Matching on any word turns a specific
    // search into the whole channel.
    expect(messagesFor('vlan cisco')).toHaveLength(1)
    expect(messagesFor('vlan cisco')[0].message.channel).toBe('networking')
  })

  it('returns the newest matches first', () => {
    const hits = messagesFor('router')
    expect(hits[0].message.body).toMatch(/fine-tuned/)
  })

  it('returns nothing for an empty or whitespace query', () => {
    expect(messagesFor('')).toEqual([])
    expect(messagesFor('   ')).toEqual([])
  })

  it('carries the channel and author needed to render a result', () => {
    const hit = messagesFor('cisco')[0]

    expect(hit.channelName).toBe('networking')
    expect(hit.authorHandle).toBe('Sam')
    expect(hit.message.createdAt).toBeTypeOf('number')
  })

  it('narrows to one channel when asked', () => {
    expect(messagesFor('vlan', { channel: 'networking' })).toHaveLength(1)
  })

  it('narrows to one author when asked', () => {
    const hits = messagesFor('router', { authorId: 'grace' })
    expect(hits.every(h => h.message.authorId === 'grace')).toBe(true)
    expect(hits).toHaveLength(2)
  })

  it('never returns a deleted or hidden message', () => {
    state.messages[0].deletedAt = NOW
    state.messages[1].hiddenAt = NOW

    expect(messagesFor('vlan')).toEqual([])
  })

  it('never returns a message from someone the searcher blocked', () => {
    state.blocks['grace'] = ['sam']

    const hits = messagesFor('vlan')
    expect(hits.every(h => h.message.authorId !== 'sam')).toBe(true)
  })

  it('never returns another member\'s anonymous prayer with their name on it', () => {
    state.messages.push({
      id: 'anon', channel: 'bible-study', authorId: 'sam', authorHandle: 'Sam',
      authorSeed: 'sam', kind: 'prayer', body: 'please pray about the vlan',
      anonymous: true, createdAt: NOW + 99_000,
    })

    const hit = messagesFor('vlan').find(h => h.message.id === 'anon')!
    expect(hit.authorHandle).toBe('Anonymous')
  })

  it('caps how many results one search returns', () => {
    for (let i = 0; i < 200; i++) say('grace', 'general', `vlan note ${i}`)
    expect(messagesFor('vlan').length).toBeLessThanOrEqual(50)
  })

  it('does not choke on regex characters typed into the box', () => {
    say('grace', 'general', 'the cost is 40% (roughly)')

    expect(() => messagesFor('40% (roughly)')).not.toThrow()
    expect(messagesFor('40%')).toHaveLength(1)
  })
})

describe('searchCommunity — members and channels', () => {
  it('finds members by handle', () => {
    const { members } = searchCommunity(state, 'grace', 'sam', {})
    expect(members.map(m => m.id)).toEqual(['sam'])
  })

  it('finds channels by name and by description', () => {
    const { channels } = searchCommunity(state, 'grace', 'networking', {})
    expect(channels.some(c => c.slug === 'networking')).toBe(true)

    const byTopic = searchCommunity(state, 'grace', 'cisco', {}).channels
    expect(byTopic.some(c => c.slug === 'networking')).toBe(true)
  })

  it('leaves archived channels out', () => {
    state.channels['networking'].archivedAt = NOW

    const { channels } = searchCommunity(state, 'grace', 'networking', {})
    expect(channels.some(c => c.slug === 'networking')).toBe(false)
  })
})
