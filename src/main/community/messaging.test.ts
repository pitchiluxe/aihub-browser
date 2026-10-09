import { describe, it, expect, beforeEach } from 'vitest'
import { postMessage, editMessage, visibleMessages, threadReplies } from './store'
import { claimOwnership, timeoutMember } from './admin'
import { migrateState } from '../../shared/communityMigrate'
import { MAX_ATTACHMENTS_PER_MESSAGE, type CommunityState, type Member, type Attachment } from '../../shared/community'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000
let counter = 0
const newId = () => `gen-${++counter}`

function member(id: string, handle = id): Member {
  return {
    id, handle, handleKey: handle.toLowerCase(), avatarSeed: id,
    // Established: past the new-member cooldown and the link ban.
    createdAt: NOW - 3 * DAY,
  }
}

let state: CommunityState

beforeEach(() => {
  counter = 0
  state = migrateState({})
  state.members['erick'] = member('erick', 'Erick')
  state.members['grace'] = member('grace', 'Grace')
  state.members['sam'] = member('sam', 'Sam')
  claimOwnership(state, 'erick', 'erickomari243@gmail.com', NOW - DAY, newId)
  // Ten posts each, so nobody is a new member for the rules under test.
  for (let i = 0; i < 10; i++) {
    for (const id of ['erick', 'grace', 'sam']) {
      state.messages.push({
        id: `seed-${id}-${i}`, channel: 'general', authorId: id,
        authorHandle: state.members[id].handle, authorSeed: id,
        kind: 'text', body: `seed ${i}`, createdAt: NOW - 2 * DAY + i,
      })
    }
  }
})

function post(memberId: string, over: Partial<Parameters<typeof postMessage>[1]> = {}, at = NOW) {
  return postMessage(state, {
    memberId, channel: 'general', kind: 'text', body: 'hello', ...over,
  } as any, at, newId)
}

describe('postMessage — permissions', () => {
  it('refuses a member who may not post in that channel', () => {
    const result = post('grace', { channel: 'announcements', body: 'buy my thing' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/permission|cannot post/i)
  })

  it('lets the owner post in an announcement channel', () => {
    expect(post('erick', { channel: 'announcements', body: 'v2 is out' }).ok).toBe(true)
  })

  it('refuses a member who is timed out', () => {
    timeoutMember(state, 'erick', 'grace', 10 * 60_000, 'Cool off.', NOW, newId)

    const result = post('grace')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/timed out|cannot post|silenced/i)
  })

  it('lets them post once the timeout has passed', () => {
    timeoutMember(state, 'erick', 'grace', 10 * 60_000, '', NOW, newId)

    expect(post('grace', {}, NOW + 11 * 60_000).ok).toBe(true)
  })

  it('refuses posting to an archived channel', () => {
    state.channels['general'].archivedAt = NOW
    expect(post('grace').ok).toBe(false)
  })
})

describe('postMessage — replies and threads', () => {
  it('records the message a reply answers', () => {
    const root = post('grace', { body: 'question?' })
    const rootId = root.ok ? root.message.id : ''

    const reply = post('sam', { body: 'answer', replyToId: rootId }, NOW + 5_000)

    expect(reply.ok).toBe(true)
    expect(reply.ok && reply.message.replyToId).toBe(rootId)
  })

  it('starts a thread at the message being replied to', () => {
    const root = post('grace', { body: 'question?' })
    const rootId = root.ok ? root.message.id : ''

    const reply = post('sam', { body: 'answer', replyToId: rootId }, NOW + 5_000)

    expect(reply.ok && reply.message.threadRootId).toBe(rootId)
  })

  it('keeps a reply to a reply in the same thread rather than nesting a new one', () => {
    const root = post('grace', { body: 'question?' })
    const rootId = root.ok ? root.message.id : ''
    const first = post('sam', { body: 'answer', replyToId: rootId }, NOW + 5_000)
    const firstId = first.ok ? first.message.id : ''

    const second = post('grace', { body: 'thanks', replyToId: firstId }, NOW + 10_000)

    // A thread is a room, not a tree. Nesting threads inside threads produces
    // conversations nobody can find their way back to.
    expect(second.ok && second.message.threadRootId).toBe(rootId)
  })

  it('refuses a reply to a message that does not exist', () => {
    expect(post('grace', { body: 'x', replyToId: 'nope' }).ok).toBe(false)
  })

  it('refuses a reply to a message in another channel', () => {
    const other = post('grace', { channel: 'random', body: 'over here' })
    const otherId = other.ok ? other.message.id : ''

    expect(post('sam', { channel: 'general', body: 'x', replyToId: otherId }, NOW + 5_000).ok).toBe(false)
  })

  it('lists a thread\'s replies in order, without the root', () => {
    const root = post('grace', { body: 'question?' })
    const rootId = root.ok ? root.message.id : ''
    post('sam', { body: 'first', replyToId: rootId }, NOW + 5_000)
    post('grace', { body: 'second', replyToId: rootId }, NOW + 10_000)

    const replies = threadReplies(state, rootId, 'sam')

    expect(replies.map(m => m.body)).toEqual(['first', 'second'])
  })
})

describe('postMessage — mentions', () => {
  it('resolves an @handle to a member id', () => {
    const result = post('grace', { body: 'thanks @Erick for the help' })

    expect(result.ok && result.message.mentions).toEqual(['erick'])
  })

  it('matches a handle regardless of case', () => {
    const result = post('grace', { body: 'hey @erick' })
    expect(result.ok && result.message.mentions).toEqual(['erick'])
  })

  it('ignores an @handle that belongs to nobody', () => {
    const result = post('grace', { body: 'hey @nobody' })
    expect(result.ok && (result.message.mentions ?? [])).toEqual([])
  })

  it('records each mentioned member once', () => {
    const result = post('grace', { body: '@Erick @erick @Sam' })
    expect(result.ok).toBe(true)
    expect([...(result.ok ? result.message.mentions ?? [] : [])].sort()).toEqual(['erick', 'sam'])
  })

  it('lets the owner mention everyone', () => {
    const result = post('erick', { body: '@everyone please read this' })
    expect(result.ok && result.message.mentionsEveryone).toBe(true)
  })

  it('drops @everyone from a member who may not use it, without refusing the message', () => {
    // Refusing would teach people to test the boundary. Ignoring it costs them
    // nothing and achieves nothing.
    const result = post('grace', { body: '@everyone look at me' })

    expect(result.ok).toBe(true)
    expect(result.ok && result.message.mentionsEveryone).toBeFalsy()
  })
})

describe('postMessage — attachments', () => {
  const file = (id: string): Attachment => ({
    id, name: `${id}.png`, mime: 'image/png', bytes: 1000, sha256: id.repeat(8),
  })

  it('stores attachments on the message', () => {
    const result = post('grace', { body: 'look', attachments: [file('a')] })

    expect(result.ok && result.message.attachments).toHaveLength(1)
  })

  it('accepts an attachment with no body text', () => {
    const result = post('grace', { body: '', attachments: [file('a')] })
    expect(result.ok).toBe(true)
  })

  it('still refuses a message with neither text nor attachments', () => {
    expect(post('grace', { body: '   ' }).ok).toBe(false)
  })

  it('refuses more attachments than the cap allows', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, (_, i) => file(`f${i}`))
    expect(post('grace', { body: 'lots', attachments: many }).ok).toBe(false)
  })

  it('refuses attachments from a member without the permission', () => {
    state.channels['general'].overrides = { member: { deny: ['attach_files'] } }

    const result = post('grace', { body: 'look', attachments: [file('a')] })
    expect(result.ok).toBe(false)
  })
})

describe('editMessage', () => {
  it('lets an author rewrite their own message', () => {
    const posted = post('grace', { body: 'teh typo' })
    const id = posted.ok ? posted.message.id : ''

    const result = editMessage(state, id, 'grace', 'the typo', NOW + 60_000)

    expect(result.ok).toBe(true)
    expect(state.messages.find(m => m.id === id)!.body).toBe('the typo')
    expect(state.messages.find(m => m.id === id)!.editedAt).toBe(NOW + 60_000)
  })

  it('re-resolves mentions on edit', () => {
    const posted = post('grace', { body: 'hello' })
    const id = posted.ok ? posted.message.id : ''

    editMessage(state, id, 'grace', 'hello @Sam', NOW + 60_000)

    expect(state.messages.find(m => m.id === id)!.mentions).toEqual(['sam'])
  })

  it('refuses to let anyone edit someone else\'s words — including the owner', () => {
    const posted = post('grace', { body: 'mine' })
    const id = posted.ok ? posted.message.id : ''

    // Deleting someone's message is moderation. Rewriting it is putting words
    // in their mouth under their name, which no permission should grant.
    expect(editMessage(state, id, 'erick', 'not mine', NOW + 60_000).ok).toBe(false)
    expect(state.messages.find(m => m.id === id)!.body).toBe('mine')
  })

  it('refuses to edit a deleted message', () => {
    const posted = post('grace', { body: 'gone' })
    const id = posted.ok ? posted.message.id : ''
    state.messages.find(m => m.id === id)!.deletedAt = NOW + 1

    expect(editMessage(state, id, 'grace', 'back', NOW + 60_000).ok).toBe(false)
  })

  it('refuses an empty edit', () => {
    const posted = post('grace', { body: 'something' })
    const id = posted.ok ? posted.message.id : ''

    expect(editMessage(state, id, 'grace', '   ', NOW + 60_000).ok).toBe(false)
  })
})

describe('visibleMessages — paging', () => {
  it('returns the most recent page by default', () => {
    const page = visibleMessages(state, 'general', 'grace', 5)
    expect(page).toHaveLength(5)
    expect(page[4].body).toBe('seed 9')
  })

  it('pages backwards from a cursor', () => {
    const newest = visibleMessages(state, 'general', 'grace', 5)
    const older = visibleMessages(state, 'general', 'grace', 5, newest[0].id)

    expect(older).toHaveLength(5)
    expect(older.every(m => m.createdAt <= newest[0].createdAt)).toBe(true)
    expect(older.map(m => m.id)).not.toContain(newest[0].id)
  })

  it('keeps thread replies out of the main channel view', () => {
    const root = post('grace', { body: 'question?' })
    const rootId = root.ok ? root.message.id : ''
    post('sam', { body: 'answer', replyToId: rootId }, NOW + 5_000)

    const page = visibleMessages(state, 'general', 'grace', 50)

    expect(page.some(m => m.body === 'question?')).toBe(true)
    expect(page.some(m => m.body === 'answer')).toBe(false)
  })
})
