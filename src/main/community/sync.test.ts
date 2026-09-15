import { describe, it, expect } from 'vitest'
import {
  messageToRow, rowToMessage, memberToRow, rowToMember,
  channelToRow, rowToChannel, memberRolesToRow, rowToMemberRoles,
  auditToRow, docOf, stateToRows, PRIMARY_KEY, SYNC_TABLES,
} from './sync'
import { emptyState } from '../../shared/communityMigrate'
import type { Member, Message } from '../../shared/community'

const NOW = 1_700_000_000_000

const member: Member = {
  id: '22222222-2222-4222-8222-222222222222',
  handle: 'Grace',
  handleKey: 'grace',
  avatarSeed: '22222222-2222-4222-8222-222222222222',
  createdAt: NOW,
}

const message: Message = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'general',
  authorId: member.id,
  authorHandle: 'Grace',
  authorSeed: member.id,
  kind: 'text',
  body: 'hello',
  createdAt: NOW,
}

describe('message rows', () => {
  it('round-trips a message without losing a field', () => {
    expect(rowToMessage(messageToRow(message, NOW))).toEqual(message)
  })

  it('round-trips every optional field, which a column-per-field mapper drops', () => {
    const rich: Message = {
      ...message,
      editedAt: NOW + 1,
      replyToId: 'r1',
      threadRootId: 't1',
      mentions: ['m1', 'm2'],
      mentionsEveryone: true,
      attachments: [{ id: 'a', name: 'x.png', mime: 'image/png', bytes: 12, sha256: 'ff' }],
      reactions: { '🙏': [member.id] },
      hiddenAt: NOW + 2,
      language: 'ts',
      anonymous: true,
    }
    expect(rowToMessage(messageToRow(rich, NOW))).toEqual(rich)
  })

  it('promotes the columns Postgres indexes and secures', () => {
    const row = messageToRow(message, NOW + 5)
    expect(row.id).toBe(message.id)
    expect(row.channel).toBe('general')
    expect(row.author_id).toBe(member.id)
    expect(row.created_at).toBe(NOW)
    expect(row.updated_at).toBe(NOW + 5)
  })

  it('keeps created_at as the original post time when a later edit is pushed', () => {
    const edited = { ...message, editedAt: NOW + 9000 }
    const row = messageToRow(edited, NOW + 9000)
    expect(row.created_at).toBe(NOW)
    expect(row.updated_at).toBe(NOW + 9000)
  })
})

describe('member rows', () => {
  it('round-trips', () => {
    expect(rowToMember(memberToRow(member, NOW))).toEqual(member)
  })

  it('promotes handle_key so the database enforces name uniqueness', () => {
    expect(memberToRow(member, NOW).handle_key).toBe('grace')
  })
})

describe('channel rows', () => {
  it('keys on slug, because every stored message points at one', () => {
    const channel = {
      slug: 'general', name: 'general', description: '', icon: 'Hash',
      accent: '#34d399', extras: [], categoryId: 'c1', position: 0, type: 'text' as const,
    }
    const row = channelToRow(channel, NOW)
    expect(row.slug).toBe('general')
    expect(rowToChannel(row)).toEqual(channel)
  })
})

describe('member_roles rows', () => {
  it('round-trips a member to their role list', () => {
    const row = memberRolesToRow('m1', ['r1', 'r2'], NOW)
    expect(rowToMemberRoles(row)).toEqual({ memberId: 'm1', roleIds: ['r1', 'r2'] })
  })

  it('tolerates role_ids arriving as a json string', () => {
    expect(rowToMemberRoles({ member_id: 'm1', role_ids: '["r1"]' }))
      .toEqual({ memberId: 'm1', roleIds: ['r1'] })
  })

  it('returns an empty list rather than throwing on malformed role_ids', () => {
    expect(rowToMemberRoles({ member_id: 'm1', role_ids: 'not json' }))
      .toEqual({ memberId: 'm1', roleIds: [] })
  })

  it('rejects a row with no member id', () => {
    expect(rowToMemberRoles({ role_ids: [] })).toBe(null)
  })
})

describe('audit rows', () => {
  it('promotes createdAt into the indexed column', () => {
    const entry = {
      id: 'a1', actorId: 'm1', action: 'member.banned' as const,
      targetType: 'member' as const, targetId: 'm2', createdAt: NOW,
    }
    expect(auditToRow(entry).created_at).toBe(NOW)
  })
})

describe('docOf', () => {
  it('parses a doc that arrives as a string', () => {
    expect(docOf<{ a: number }>({ doc: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('returns null for a malformed doc so one bad row cannot kill a backfill', () => {
    expect(docOf({ doc: '{' })).toBe(null)
  })

  it('returns null for a missing doc', () => {
    expect(docOf({})).toBe(null)
    expect(docOf(null)).toBe(null)
  })
})

describe('table descriptors', () => {
  it('names a primary key for every replicated table', () => {
    for (const table of SYNC_TABLES) expect(PRIMARY_KEY[table]).toBeTruthy()
  })

  it('seeds members before messages, so the author foreign key resolves', () => {
    expect(SYNC_TABLES.indexOf('aihub_members')).toBeLessThan(SYNC_TABLES.indexOf('aihub_messages'))
  })

  it('seeds roles before member_roles', () => {
    expect(SYNC_TABLES.indexOf('aihub_roles')).toBeLessThan(SYNC_TABLES.indexOf('aihub_member_roles'))
  })
})

describe('stateToRows', () => {
  it('emits nothing for an empty community beyond its seeded channels', () => {
    const state = emptyState()
    const rows = stateToRows(state, NOW)
    expect(rows.filter(r => r.table === 'aihub_messages')).toEqual([])
    expect(rows.filter(r => r.table === 'aihub_members')).toEqual([])
  })

  it('carries a local message up when the first device seeds the room', () => {
    const state = emptyState()
    state.members[member.id] = member
    state.messages.push(message)
    const rows = stateToRows(state, NOW)
    expect(rows.find(r => r.table === 'aihub_messages')?.row.id).toBe(message.id)
    expect(rows.find(r => r.table === 'aihub_members')?.row.id).toBe(member.id)
  })

  it('orders members ahead of messages so the foreign key is satisfiable', () => {
    const state = emptyState()
    state.members[member.id] = member
    state.messages.push(message)
    const rows = stateToRows(state, NOW)
    const firstMember = rows.findIndex(r => r.table === 'aihub_members')
    const firstMessage = rows.findIndex(r => r.table === 'aihub_messages')
    expect(firstMember).toBeLessThan(firstMessage)
  })
})
