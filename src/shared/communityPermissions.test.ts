import { describe, it, expect } from 'vitest'
import {
  resolvePermissions, hasPermission, DEFAULT_ROLES,
  OWNER_ROLE_ID, MODERATOR_ROLE_ID, MEMBER_ROLE_ID,
} from './communityPermissions'
import { migrateState } from './communityMigrate'
import { ALL_PERMISSIONS, type CommunityState, type Member } from './community'

const NOW = 1_700_000_000_000

function member(id: string): Member {
  return { id, handle: id, handleKey: id, avatarSeed: id, createdAt: NOW }
}

function state(): CommunityState {
  const s = migrateState({})
  s.members['owner'] = member('owner')
  s.members['mod'] = member('mod')
  s.members['plain'] = member('plain')
  s.members['banned'] = { ...member('banned'), bannedAt: NOW }
  s.memberRoles['mod'] = [MODERATOR_ROLE_ID]
  s.ownership = { memberId: 'owner', email: 'erickomari243@gmail.com', verifiedAt: NOW }
  return s
}

describe('resolvePermissions', () => {
  it('grants the owner every permission there is', () => {
    const perms = resolvePermissions(state(), 'owner')
    for (const p of ALL_PERMISSIONS) expect(perms.has(p), p).toBe(true)
  })

  it('grants the owner permissions even in a channel that denies them', () => {
    const s = state()
    s.channels['general'].overrides = { [OWNER_ROLE_ID]: { deny: ['send_messages'] } }

    expect(hasPermission(s, 'owner', 'send_messages', 'general')).toBe(true)
  })

  it('gives a member with no roles the default member permissions', () => {
    const perms = resolvePermissions(state(), 'plain')

    expect(perms.has('send_messages')).toBe(true)
    expect(perms.has('attach_files')).toBe(true)
    expect(perms.has('use_voice')).toBe(true)
  })

  it('never lets a plain member manage channels', () => {
    expect(hasPermission(state(), 'plain', 'manage_channels')).toBe(false)
  })

  it('never lets a moderator manage channels', () => {
    // Moderation and administration are different jobs. A moderator removes
    // messages; only the owner reshapes the community.
    expect(hasPermission(state(), 'mod', 'manage_messages')).toBe(true)
    expect(hasPermission(state(), 'mod', 'manage_channels')).toBe(false)
    expect(hasPermission(state(), 'mod', 'manage_roles')).toBe(false)
  })

  it('never lets a plain member mention everyone', () => {
    expect(hasPermission(state(), 'plain', 'mention_everyone')).toBe(false)
  })

  it('gives a banned member nothing at all', () => {
    const perms = resolvePermissions(state(), 'banned')
    expect(perms.size).toBe(0)
  })

  it('gives an unknown member nothing at all', () => {
    expect(resolvePermissions(state(), 'nobody').size).toBe(0)
  })

  it('applies a channel override that grants an extra permission', () => {
    const s = state()
    s.channels['general'].overrides = { [MEMBER_ROLE_ID]: { allow: ['mention_everyone'] } }

    expect(hasPermission(s, 'plain', 'mention_everyone', 'general')).toBe(true)
    expect(hasPermission(s, 'plain', 'mention_everyone', 'random')).toBe(false)
  })

  it('applies a channel override that removes a permission', () => {
    const s = state()
    s.channels['general'].overrides = { [MEMBER_ROLE_ID]: { deny: ['send_messages'] } }

    expect(hasPermission(s, 'plain', 'send_messages', 'general')).toBe(false)
    expect(hasPermission(s, 'plain', 'send_messages', 'random')).toBe(true)
  })

  it('lets a denial beat a grant from another of the same member\'s roles', () => {
    const s = state()
    s.roles['loud'] = {
      id: 'loud', name: 'Loud', color: '#fff', position: 5,
      permissions: ['send_messages'],
    }
    s.memberRoles['plain'] = [MEMBER_ROLE_ID, 'loud']
    s.channels['general'].overrides = { [MEMBER_ROLE_ID]: { deny: ['send_messages'] } }

    // Otherwise a mute is defeated by holding any second role, which makes
    // channel restrictions unenforceable the moment roles multiply.
    expect(hasPermission(s, 'plain', 'send_messages', 'general')).toBe(false)
  })

  it('stops members posting in an announcement channel', () => {
    const s = state()
    expect(hasPermission(s, 'plain', 'send_messages', 'announcements')).toBe(false)
    expect(hasPermission(s, 'plain', 'send_messages', 'general')).toBe(true)
  })

  it('still lets the owner post announcements', () => {
    expect(hasPermission(state(), 'owner', 'send_messages', 'announcements')).toBe(true)
  })

  it('ignores an override for a role the member does not hold', () => {
    const s = state()
    s.channels['general'].overrides = { [MODERATOR_ROLE_ID]: { deny: ['send_messages'] } }

    expect(hasPermission(s, 'plain', 'send_messages', 'general')).toBe(true)
  })

  it('treats an unknown channel as no channel rather than throwing', () => {
    expect(hasPermission(state(), 'plain', 'send_messages', 'no-such-channel')).toBe(true)
  })

  it('falls back to a member with no ownership recorded', () => {
    const s = state()
    s.ownership = null

    // Nobody is owner until ownership is claimed, so nobody manages channels.
    expect(hasPermission(s, 'owner', 'manage_channels')).toBe(false)
  })
})

describe('DEFAULT_ROLES', () => {
  it('ships owner, moderator and member, all marked as system roles', () => {
    const ids = DEFAULT_ROLES.map(r => r.id)
    expect(ids).toEqual([OWNER_ROLE_ID, MODERATOR_ROLE_ID, MEMBER_ROLE_ID])
    for (const role of DEFAULT_ROLES) expect(role.system, role.id).toBe(true)
  })

  it('gives the owner role every permission, so the two paths cannot drift', () => {
    const owner = DEFAULT_ROLES.find(r => r.id === OWNER_ROLE_ID)!
    expect([...owner.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort())
  })
})
