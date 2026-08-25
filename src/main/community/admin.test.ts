import { describe, it, expect, beforeEach } from 'vitest'
import {
  claimOwnership, releaseOwnership,
  createChannel, updateChannel, deleteChannel, restoreChannel, purgeChannel, reorderChannels,
  createCategory, updateCategory, deleteCategory,
  createRole, updateRole, deleteRole, assignRole, revokeRole,
  timeoutMember, activeChannels,
} from './admin'
import { migrateState } from '../../shared/communityMigrate'
import { MODERATOR_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID } from '../../shared/communityPermissions'
import type { CommunityState, Member } from '../../shared/community'

const NOW = 1_700_000_000_000
let counter = 0
const newId = () => `gen-${++counter}`

function member(id: string): Member {
  return { id, handle: id, handleKey: id, avatarSeed: id, createdAt: NOW }
}

let state: CommunityState

beforeEach(() => {
  counter = 0
  state = migrateState({})
  state.members['erick'] = member('erick')
  state.members['mod'] = member('mod')
  state.members['plain'] = member('plain')
  state.memberRoles['mod'] = [MODERATOR_ROLE_ID]
})

function makeOwner() {
  claimOwnership(state, 'erick', 'erickomari243@gmail.com', NOW, newId)
}

describe('claimOwnership', () => {
  it('binds ownership when the verified address is the owner\'s', () => {
    const result = claimOwnership(state, 'erick', 'Erick.Omari243+x@googlemail.com', NOW, newId)

    expect(result.ok).toBe(true)
    expect(state.ownership).toEqual({
      memberId: 'erick', email: 'erickomari243@gmail.com', verifiedAt: NOW,
    })
  })

  it('grants the owner role', () => {
    makeOwner()
    expect(state.memberRoles['erick']).toContain(OWNER_ROLE_ID)
  })

  it('refuses any other address', () => {
    const result = claimOwnership(state, 'plain', 'someone@else.com', NOW, newId)

    expect(result.ok).toBe(false)
    expect(state.ownership).toBeNull()
  })

  it('refuses an address that merely resembles the owner\'s', () => {
    expect(claimOwnership(state, 'plain', 'erickomari243@gmail.com.evil.com', NOW, newId).ok).toBe(false)
    expect(claimOwnership(state, 'plain', 'x-erickomari243@gmail.com', NOW, newId).ok).toBe(false)
    expect(state.ownership).toBeNull()
  })

  it('refuses a claim from a second identity once ownership is held', () => {
    makeOwner()
    state.members['imposter'] = member('imposter')

    const result = claimOwnership(state, 'imposter', 'erickomari243@gmail.com', NOW + 1, newId)

    expect(result.ok).toBe(false)
    expect(state.ownership!.memberId).toBe('erick')
  })

  it('is idempotent for the identity that already holds it', () => {
    makeOwner()
    const result = claimOwnership(state, 'erick', 'erickomari243@gmail.com', NOW + 5, newId)

    expect(result.ok).toBe(true)
    expect(state.ownership!.verifiedAt).toBe(NOW)
  })

  it('records the claim in the audit log', () => {
    makeOwner()
    const entry = state.auditLog.find(e => e.action === 'ownership.claimed')

    expect(entry).toBeDefined()
    expect(entry!.actorId).toBe('erick')
  })

  it('lets the owner release ownership, and nobody else', () => {
    makeOwner()

    expect(releaseOwnership(state, 'plain', NOW, newId).ok).toBe(false)
    expect(state.ownership).not.toBeNull()

    expect(releaseOwnership(state, 'erick', NOW, newId).ok).toBe(true)
    expect(state.ownership).toBeNull()
    expect(state.memberRoles['erick'] ?? []).not.toContain(OWNER_ROLE_ID)
  })
})

describe('createChannel — the authorization that matters', () => {
  it('lets the owner create a channel', () => {
    makeOwner()
    const result = createChannel(state, 'erick', { name: 'Study Group' }, NOW, newId)

    expect(result.ok).toBe(true)
    expect(state.channels['study-group']).toBeDefined()
    expect(state.channels['study-group'].name).toBe('Study Group')
  })

  it('refuses a plain member', () => {
    makeOwner()
    const result = createChannel(state, 'plain', { name: 'Mine' }, NOW, newId)

    expect(result.ok).toBe(false)
    expect(state.channels['mine']).toBeUndefined()
  })

  it('refuses a moderator', () => {
    makeOwner()
    expect(createChannel(state, 'mod', { name: 'Mine' }, NOW, newId).ok).toBe(false)
  })

  it('refuses everyone while ownership is unclaimed', () => {
    // Nobody is owner until the email is proved, so nobody may reshape the
    // community. The alternative — falling back to "whoever installed it" —
    // is exactly the local flag this design replaced.
    expect(createChannel(state, 'erick', { name: 'Mine' }, NOW, newId).ok).toBe(false)
  })

  it('slugifies the name', () => {
    makeOwner()
    createChannel(state, 'erick', { name: '  AI & Machine Learning!  ' }, NOW, newId)

    expect(state.channels['ai-machine-learning']).toBeDefined()
  })

  it('refuses a name that collides with an existing channel', () => {
    makeOwner()
    const result = createChannel(state, 'erick', { name: 'General' }, NOW, newId)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/already/i)
  })

  it('refuses a name that slugifies to nothing', () => {
    makeOwner()
    expect(createChannel(state, 'erick', { name: '!!!' }, NOW, newId).ok).toBe(false)
    expect(createChannel(state, 'erick', { name: '' }, NOW, newId).ok).toBe(false)
  })

  it('refuses an unknown category', () => {
    makeOwner()
    const result = createChannel(state, 'erick', { name: 'Orphan', categoryId: 'nope' }, NOW, newId)
    expect(result.ok).toBe(false)
  })

  it('places a new channel last in its category', () => {
    makeOwner()
    const existing = Object.values(state.channels).filter(c => c.categoryId === 'community')
    createChannel(state, 'erick', { name: 'Newest', categoryId: 'community' }, NOW, newId)

    expect(state.channels['newest'].position).toBe(existing.length)
  })

  it('creates a voice channel when asked', () => {
    makeOwner()
    createChannel(state, 'erick', { name: 'Standup', type: 'voice', categoryId: 'voice' }, NOW, newId)

    expect(state.channels['standup'].type).toBe('voice')
  })

  it('records the creation in the audit log', () => {
    makeOwner()
    createChannel(state, 'erick', { name: 'Study Group' }, NOW, newId)

    const entry = state.auditLog.find(e => e.action === 'channel.created')
    expect(entry!.targetId).toBe('study-group')
    expect(entry!.actorId).toBe('erick')
  })
})

describe('updateChannel', () => {
  it('lets the owner rename a channel without moving its messages', () => {
    makeOwner()
    state.messages.push({
      id: 'm1', channel: 'general', authorId: 'plain', authorHandle: 'plain',
      authorSeed: 'plain', kind: 'text', body: 'hi', createdAt: NOW,
    })

    const result = updateChannel(state, 'erick', 'general', { name: 'Lobby' }, NOW, newId)

    expect(result.ok).toBe(true)
    expect(state.channels['general'].name).toBe('Lobby')
    // The slug is the join key for every stored message. Renaming must never
    // touch it, or the rename silently orphans history.
    expect(state.channels['general'].slug).toBe('general')
    expect(state.messages[0].channel).toBe('general')
  })

  it('updates description, topic and category', () => {
    makeOwner()
    updateChannel(state, 'erick', 'general', {
      description: 'The lobby.', topic: 'Say hello.', categoryId: 'interests',
    }, NOW, newId)

    expect(state.channels['general'].description).toBe('The lobby.')
    expect(state.channels['general'].topic).toBe('Say hello.')
    expect(state.channels['general'].categoryId).toBe('interests')
  })

  it('refuses a plain member', () => {
    makeOwner()
    expect(updateChannel(state, 'plain', 'general', { name: 'Mine' }, NOW, newId).ok).toBe(false)
    expect(state.channels['general'].name).toBe('general')
  })

  it('refuses an unknown channel', () => {
    makeOwner()
    expect(updateChannel(state, 'erick', 'nope', { name: 'x' }, NOW, newId).ok).toBe(false)
  })
})

describe('deleteChannel — archive, not destroy', () => {
  beforeEach(() => {
    makeOwner()
    state.messages.push({
      id: 'm1', channel: 'general', authorId: 'plain', authorHandle: 'plain',
      authorSeed: 'plain', kind: 'text', body: 'hi', createdAt: NOW,
    })
  })

  it('hides the channel but keeps its messages', () => {
    const result = deleteChannel(state, 'erick', 'general', NOW, newId)

    expect(result.ok).toBe(true)
    expect(state.channels['general'].archivedAt).toBe(NOW)
    expect(state.messages).toHaveLength(1)
  })

  it('drops the channel out of the sidebar list', () => {
    deleteChannel(state, 'erick', 'general', NOW, newId)
    expect(activeChannels(state).some(c => c.slug === 'general')).toBe(false)
  })

  it('can be undone', () => {
    deleteChannel(state, 'erick', 'general', NOW, newId)
    restoreChannel(state, 'erick', 'general', NOW, newId)

    expect(state.channels['general'].archivedAt).toBeUndefined()
    expect(state.messages).toHaveLength(1)
  })

  it('refuses a plain member', () => {
    expect(deleteChannel(state, 'plain', 'general', NOW, newId).ok).toBe(false)
    expect(state.channels['general'].archivedAt).toBeUndefined()
  })

  it('purges permanently only when the slug is typed back', () => {
    deleteChannel(state, 'erick', 'general', NOW, newId)

    expect(purgeChannel(state, 'erick', 'general', 'wrong', NOW, newId).ok).toBe(false)
    expect(state.channels['general']).toBeDefined()

    const result = purgeChannel(state, 'erick', 'general', 'general', NOW, newId)
    expect(result.ok).toBe(true)
    expect(state.channels['general']).toBeUndefined()
    expect(state.messages).toHaveLength(0)
  })

  it('refuses to purge a channel that has not been archived first', () => {
    // Two deliberate steps, because this is the one action in the whole
    // feature that destroys messages.
    expect(purgeChannel(state, 'erick', 'general', 'general', NOW, newId).ok).toBe(false)
    expect(state.messages).toHaveLength(1)
  })
})

describe('reorderChannels', () => {
  it('lets the owner set positions and move channels between categories', () => {
    makeOwner()
    const result = reorderChannels(state, 'erick', [
      { slug: 'random', categoryId: 'community', position: 0 },
      { slug: 'general', categoryId: 'community', position: 1 },
      { slug: 'support', categoryId: 'interests', position: 0 },
    ], NOW, newId)

    expect(result.ok).toBe(true)
    expect(state.channels['random'].position).toBe(0)
    expect(state.channels['general'].position).toBe(1)
    expect(state.channels['support'].categoryId).toBe('interests')
  })

  it('refuses a plain member', () => {
    makeOwner()
    const before = state.channels['general'].position
    reorderChannels(state, 'plain', [{ slug: 'general', categoryId: 'community', position: 9 }], NOW, newId)

    expect(state.channels['general'].position).toBe(before)
  })

  it('ignores unknown slugs rather than failing the whole reorder', () => {
    makeOwner()
    const result = reorderChannels(state, 'erick', [
      { slug: 'ghost', categoryId: 'community', position: 0 },
      { slug: 'general', categoryId: 'community', position: 3 },
    ], NOW, newId)

    expect(result.ok).toBe(true)
    expect(state.channels['general'].position).toBe(3)
  })
})

describe('categories', () => {
  it('lets the owner create, rename and delete a category', () => {
    makeOwner()
    const created = createCategory(state, 'erick', 'Study', NOW, newId)
    expect(created.ok).toBe(true)
    const id = created.ok ? created.category.id : ''

    updateCategory(state, 'erick', id, 'Study Groups', NOW, newId)
    expect(state.categories[id].name).toBe('Study Groups')

    deleteCategory(state, 'erick', id, NOW, newId)
    expect(state.categories[id]).toBeUndefined()
  })

  it('refuses a plain member', () => {
    makeOwner()
    expect(createCategory(state, 'plain', 'Mine', NOW, newId).ok).toBe(false)
  })

  it('moves a deleted category\'s channels somewhere real instead of orphaning them', () => {
    makeOwner()
    deleteCategory(state, 'erick', 'technology', NOW, newId)

    for (const channel of Object.values(state.channels)) {
      expect(state.categories[channel.categoryId], channel.slug).toBeDefined()
    }
  })

  it('refuses to delete the last remaining category', () => {
    makeOwner()
    for (const id of Object.keys(state.categories).slice(1)) {
      deleteCategory(state, 'erick', id, NOW, newId)
    }
    const last = Object.keys(state.categories)[0]

    expect(deleteCategory(state, 'erick', last, NOW, newId).ok).toBe(false)
  })
})

describe('roles', () => {
  it('lets the owner create a role and assign it', () => {
    makeOwner()
    const created = createRole(state, 'erick', { name: 'Helper', permissions: ['manage_messages'] }, NOW, newId)
    expect(created.ok).toBe(true)
    const id = created.ok ? created.role.id : ''

    assignRole(state, 'erick', 'plain', id, NOW, newId)
    expect(state.memberRoles['plain']).toContain(id)

    revokeRole(state, 'erick', 'plain', id, NOW, newId)
    expect(state.memberRoles['plain'] ?? []).not.toContain(id)
  })

  it('refuses a plain member and a moderator', () => {
    makeOwner()
    expect(createRole(state, 'plain', { name: 'Mine', permissions: [] }, NOW, newId).ok).toBe(false)
    expect(createRole(state, 'mod', { name: 'Mine', permissions: [] }, NOW, newId).ok).toBe(false)
  })

  it('refuses to delete or edit a system role', () => {
    makeOwner()
    expect(deleteRole(state, 'erick', MEMBER_ROLE_ID, NOW, newId).ok).toBe(false)
    expect(deleteRole(state, 'erick', OWNER_ROLE_ID, NOW, newId).ok).toBe(false)
    expect(updateRole(state, 'erick', OWNER_ROLE_ID, { permissions: [] }, NOW, newId).ok).toBe(false)
  })

  it('strips a deleted role from everyone who held it', () => {
    makeOwner()
    const created = createRole(state, 'erick', { name: 'Helper', permissions: [] }, NOW, newId)
    const id = created.ok ? created.role.id : ''
    assignRole(state, 'erick', 'plain', id, NOW, newId)

    deleteRole(state, 'erick', id, NOW, newId)

    expect(state.memberRoles['plain'] ?? []).not.toContain(id)
    expect(state.roles[id]).toBeUndefined()
  })

  it('refuses an unknown permission name', () => {
    makeOwner()
    const result = createRole(state, 'erick', { name: 'Bad', permissions: ['rm_-rf' as any] }, NOW, newId)
    expect(result.ok).toBe(false)
  })
})

describe('timeoutMember', () => {
  it('lets a moderator silence someone for a while', () => {
    makeOwner()
    const result = timeoutMember(state, 'mod', 'plain', 10 * 60_000, 'Cool off.', NOW, newId)

    expect(result.ok).toBe(true)
    expect(state.members['plain'].timeoutUntil).toBe(NOW + 10 * 60_000)
  })

  it('refuses a plain member', () => {
    makeOwner()
    expect(timeoutMember(state, 'plain', 'mod', 60_000, '', NOW, newId).ok).toBe(false)
  })

  it('refuses to time out the owner', () => {
    makeOwner()
    expect(timeoutMember(state, 'mod', 'erick', 60_000, '', NOW, newId).ok).toBe(false)
    expect(state.members['erick'].timeoutUntil).toBeUndefined()
  })

  it('clears a timeout when the duration is zero', () => {
    makeOwner()
    timeoutMember(state, 'mod', 'plain', 60_000, '', NOW, newId)
    timeoutMember(state, 'mod', 'plain', 0, '', NOW, newId)

    expect(state.members['plain'].timeoutUntil).toBeUndefined()
  })
})
