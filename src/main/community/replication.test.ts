import { describe, it, expect, vi } from 'vitest'
import { createReplication, ECHO_TTL_MS } from './replication'
import { emptyState } from '../../shared/communityMigrate'
import { BOT_MEMBER_ID } from '../../shared/communityBot'
import { messageToRow } from './sync'
import type { CommunityState, Message } from '../../shared/community'

const NOW = 1_700_000_000_000

/**
 * The id this device's member has in the harness.
 *
 * Replication refuses to queue writes row level security would reject, and
 * that judgement needs to know who this device is. A harness with no identity
 * models a device where nobody has joined yet — which is a real state, but not
 * the one most of these tests are about.
 */
const ME = 'me-1'

/**
 * A message this device wrote.
 *
 * Authored by ME rather than by a stranger, because "post as self" means a
 * device may only push its own messages — a fixture authored by someone else
 * is a message this machine received, and pushing one of those is the bug
 * these tests exist to prevent.
 */
const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1', channel: 'general', authorId: ME, authorHandle: 'ada',
  authorSeed: ME, kind: 'text', body: 'hello', createdAt: NOW, ...over,
})

interface Harness {
  state: CommunityState
  broadcast: ReturnType<typeof vi.fn>
  upserts: { table: string; rows: unknown[] }[]
  deletes: { table: string; id: unknown }[]
  replication: ReturnType<typeof createReplication>
  clock: { now: number }
  failNext: { value: boolean }
}

function harness(opts: { admin?: boolean; anonymous?: boolean } = {}): Harness {
  const state = emptyState()
  if (!opts.anonymous) {
    state.members[ME] = {
      id: ME, handle: 'me', handleKey: 'me', avatarSeed: ME, createdAt: NOW,
      ...(opts.admin === false ? {} : { isAdmin: true }),
    } as never
  }
  const broadcast = vi.fn()
  const upserts: { table: string; rows: unknown[] }[] = []
  const deletes: { table: string; id: unknown }[] = []
  const clock = { now: NOW }
  const failNext = { value: false }

  const client = {
    from(table: string) {
      return {
        upsert(rows: unknown[]) {
          if (failNext.value) return Promise.resolve({ error: { message: 'offline' } })
          upserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] })
          return Promise.resolve({ error: null })
        },
        delete() {
          return {
            eq(_column: string, id: unknown) {
              deletes.push({ table, id })
              return Promise.resolve({ error: null })
            },
          }
        },
        select() { return Promise.resolve({ data: [], error: null }) },
      }
    },
    channel() {
      const self = { on: () => self, subscribe: () => self, unsubscribe: () => {} }
      return self
    },
  }

  const replication = createReplication({
    client: client as never,
    readState: () => state,
    updateState: mutate => { mutate(state) },
    broadcast,
    localMemberId: () => (opts.anonymous ? null : ME),
    now: () => clock.now,
  })

  return { state, broadcast, upserts, deletes, replication, clock, failNext }
}

describe('push', () => {
  it('sends a posted message to the messages table', async () => {
    const h = harness()
    h.replication.push('aihub_messages', messageToRow(message(), NOW))
    await h.replication.flush()
    expect(h.upserts).toHaveLength(1)
    expect(h.upserts[0].table).toBe('aihub_messages')
    expect((h.upserts[0].rows[0] as { id: string }).id).toBe('m1')
  })

  it('coalesces repeated edits of one row into a single latest write', async () => {
    const h = harness()
    h.replication.push('aihub_messages', messageToRow(message({ body: 'one' }), NOW))
    h.replication.push('aihub_messages', messageToRow(message({ body: 'two' }), NOW))
    h.replication.push('aihub_messages', messageToRow(message({ body: 'three' }), NOW))
    expect(h.replication.pending()).toBe(1)
    await h.replication.flush()
    const doc = (h.upserts[0].rows[0] as { doc: Message }).doc
    expect(doc.body).toBe('three')
  })

  it('keeps rows for two different messages separate', async () => {
    const h = harness()
    h.replication.push('aihub_messages', messageToRow(message({ id: 'm1' }), NOW))
    h.replication.push('aihub_messages', messageToRow(message({ id: 'm2' }), NOW))
    expect(h.replication.pending()).toBe(2)
  })

  it('does not lose a message when the network refuses it', async () => {
    const h = harness()
    h.failNext.value = true
    h.replication.push('aihub_messages', messageToRow(message(), NOW))
    await h.replication.flush()

    expect(h.upserts).toHaveLength(0)
    expect(h.replication.pending()).toBe(1)
    expect(h.replication.status()).toBe('error')

    // ...and it goes out once the connection comes back.
    h.failNext.value = false
    await h.replication.flush()
    expect(h.upserts).toHaveLength(1)
    expect(h.replication.pending()).toBe(0)
  })

  it('sends a delete as a delete, not as an upsert', async () => {
    const h = harness()
    h.replication.remove('aihub_messages', 'm1')
    await h.replication.flush()
    expect(h.deletes).toEqual([{ table: 'aihub_messages', id: 'm1' }])
  })
})

describe('pull', () => {
  it('folds a remote message into local state and announces it once', () => {
    const h = harness()
    h.replication.applyRemote('aihub_messages', 'INSERT', messageToRow(message({ id: 'm9' }), NOW))

    expect(h.state.messages.find(m => m.id === 'm9')?.body).toBe('hello')
    expect(h.broadcast).toHaveBeenCalledWith(
      'community:message', { channel: 'general', message: expect.objectContaining({ id: 'm9' }) },
    )
    expect(h.broadcast).toHaveBeenCalledWith(
      'community:event', expect.objectContaining({ type: 'message.new' }),
    )
  })

  it('announces a second copy of the same id as an edit, not a new message', () => {
    const h = harness()
    h.replication.applyRemote('aihub_messages', 'INSERT', messageToRow(message({ id: 'm9' }), NOW))
    h.broadcast.mockClear()
    h.replication.applyRemote('aihub_messages', 'UPDATE', messageToRow(message({ id: 'm9', body: 'edited' }), NOW))

    expect(h.state.messages.filter(m => m.id === 'm9')).toHaveLength(1)
    expect(h.state.messages.find(m => m.id === 'm9')?.body).toBe('edited')
    expect(h.broadcast).toHaveBeenCalledWith(
      'community:event', expect.objectContaining({ type: 'message.edit' }),
    )
    expect(h.broadcast).not.toHaveBeenCalledWith('community:message', expect.anything())
  })

  it('ignores the echo of a row this device just pushed', () => {
    const h = harness()
    h.replication.push('aihub_messages', messageToRow(message(), NOW))
    h.broadcast.mockClear()
    h.replication.applyRemote('aihub_messages', 'INSERT', messageToRow(message(), NOW))
    expect(h.broadcast).not.toHaveBeenCalled()
  })

  it('stops ignoring that row once the echo window has passed', () => {
    const h = harness()
    h.replication.push('aihub_messages', messageToRow(message(), NOW))
    h.clock.now += ECHO_TTL_MS + 1
    h.replication.applyRemote('aihub_messages', 'INSERT', messageToRow(message(), NOW))
    expect(h.broadcast).toHaveBeenCalledWith('community:message', expect.anything())
  })

  it('applies a remote delete by removing the local row', () => {
    const h = harness()
    h.state.messages.push(message({ id: 'm2' }))
    h.replication.applyRemote('aihub_messages', 'DELETE', { id: 'm2' })
    expect(h.state.messages.find(m => m.id === 'm2')).toBeUndefined()
  })

  it('folds a remote member in, which is what makes the member list show five people', () => {
    const h = harness()
    h.replication.applyRemote('aihub_members', 'INSERT', {
      id: 'm-remote', handle_key: 'bo', updated_at: NOW,
      doc: { id: 'm-remote', handle: 'Bo', handleKey: 'bo', avatarSeed: 'm-remote', createdAt: NOW },
    })
    expect(h.state.members['m-remote']?.handle).toBe('Bo')
    expect(h.broadcast).toHaveBeenCalledWith('community:refresh', { reason: 'members' })
  })

  it('folds a remote channel in', () => {
    const h = harness()
    h.replication.applyRemote('aihub_channels', 'INSERT', {
      slug: 'lounge', updated_at: NOW,
      doc: { slug: 'lounge', name: 'Lounge', type: 'voice' },
    })
    expect(h.state.channels['lounge']?.name).toBe('Lounge')
  })

  it('folds a remote role assignment in', () => {
    const h = harness()
    h.replication.applyRemote('aihub_member_roles', 'INSERT', { member_id: 'm1', role_ids: ['r1'] })
    expect(h.state.memberRoles['m1']).toEqual(['r1'])
  })

  it('never appends the same audit entry twice', () => {
    const h = harness()
    const row = {
      id: 'a1', created_at: NOW,
      doc: { id: 'a1', actorId: 'm1', action: 'member.banned', targetType: 'member', targetId: 'm2', createdAt: NOW },
    }
    h.replication.applyRemote('aihub_audit_log', 'INSERT', row)
    h.clock.now += ECHO_TTL_MS + 1
    h.replication.applyRemote('aihub_audit_log', 'INSERT', row)
    expect(h.state.auditLog.filter(e => e.id === 'a1')).toHaveLength(1)
  })

  it('ignores a row with no primary key rather than throwing', () => {
    const h = harness()
    expect(() => h.replication.applyRemote('aihub_messages', 'INSERT', {})).not.toThrow()
    expect(h.broadcast).not.toHaveBeenCalled()
  })

  it('ignores a row whose doc is malformed, so one bad row cannot stop a backfill', () => {
    const h = harness()
    h.replication.applyRemote('aihub_messages', 'INSERT', { id: 'm3', doc: '{' })
    expect(h.state.messages).toHaveLength(0)
  })
})

describe('reconcile', () => {
  it('pushes a message that appeared in local state with no explicit push call', async () => {
    const h = harness()
    h.state.members['a1'] = { id: 'a1', handle: 'ada', handleKey: 'ada', avatarSeed: 'a1', createdAt: NOW }
    h.replication.reconcile(true)          // baseline: nothing to send

    h.state.messages.push(message())        // a handler mutated state
    h.replication.reconcile()
    await h.replication.flush()

    const messages = h.upserts.filter(u => u.table === 'aihub_messages')
    expect(messages).toHaveLength(1)
    expect((messages[0].rows[0] as { id: string }).id).toBe('m1')
  })

  it('sends nothing when nothing changed', async () => {
    const h = harness()
    h.state.messages.push(message())
    h.replication.reconcile(true)
    h.replication.reconcile()
    await h.replication.flush()
    expect(h.upserts).toHaveLength(0)
  })

  it('re-pushes a message whose body was edited in place', async () => {
    const h = harness()
    const posted = message()
    h.state.messages.push(posted)
    h.replication.reconcile(true)

    posted.body = 'edited'
    posted.editedAt = NOW + 1
    h.replication.reconcile()
    await h.replication.flush()

    const doc = (h.upserts[0].rows[0] as { doc: Message }).doc
    expect(doc.body).toBe('edited')
  })

  it('turns a locally removed message into a remote delete', async () => {
    const h = harness()
    h.state.messages.push(message())
    h.replication.reconcile(true)

    h.state.messages.splice(0, 1)
    h.replication.reconcile()
    await h.replication.flush()

    expect(h.deletes).toEqual([{ table: 'aihub_messages', id: 'm1' }])
  })

  it('replicates a channel created by an admin handler it was never told about', async () => {
    const h = harness()
    h.replication.reconcile(true)
    // This is the point of diffing: no push() call exists anywhere for this.
    h.state.channels['lounge'] = {
      slug: 'lounge', name: 'Lounge', description: '', icon: 'Hash', accent: '#fff',
      extras: [], categoryId: 'c1', position: 0, type: 'voice',
    }
    h.replication.reconcile()
    await h.replication.flush()
    expect(h.upserts.find(u => u.table === 'aihub_channels')).toBeTruthy()
  })

  it('replicates a role assignment', async () => {
    const h = harness()
    h.replication.reconcile(true)
    h.state.memberRoles['a1'] = ['r1']
    h.replication.reconcile()
    await h.replication.flush()
    expect(h.upserts.find(u => u.table === 'aihub_member_roles')).toBeTruthy()
  })

  it('never issues a delete for a pruned audit entry', async () => {
    const h = harness()
    h.state.auditLog.push({
      id: 'a1', actorId: 'm1', action: 'member.banned',
      targetType: 'member', targetId: 'm2', createdAt: NOW,
    })
    h.replication.reconcile(true)
    h.state.auditLog.splice(0, 1)
    h.replication.reconcile()
    await h.replication.flush()
    expect(h.deletes).toEqual([])
  })

  it('does not re-send rows the server already gave it', async () => {
    const h = harness()
    h.state.members['a1'] = { id: 'a1', handle: 'ada', handleKey: 'ada', avatarSeed: 'a1', createdAt: NOW }
    for (let i = 0; i < 20; i++) h.state.messages.push(message({ id: `m${i}` }))
    h.replication.reconcile(true)
    h.replication.reconcile()
    await h.replication.flush()
    expect(h.upserts).toHaveLength(0)
  })

  it('still pushes a message that was queued when the app last closed', async () => {
    // The bug this guards: baselining from local state after a backfill would
    // mark an unsent message as already sent, and it would never replicate.
    const h = harness()
    h.state.messages.push(message({ id: 'stranded' }))
    // A backfill that returned nothing — the server has never seen this row.
    h.replication.reconcile()
    await h.replication.flush()

    const sent = h.upserts.flatMap(u => u.rows) as { id: string }[]
    expect(sent.map(r => r.id)).toContain('stranded')
  })
})

describe('seed', () => {
  it('queues everything this device already had, members before messages', async () => {
    const h = harness()
    h.state.members['a1'] = {
      id: 'a1', handle: 'ada', handleKey: 'ada', avatarSeed: 'a1', createdAt: NOW,
    }
    h.state.messages.push(message())
    h.replication.seed()
    await h.replication.flush()

    const tables = h.upserts.map(u => u.table)
    expect(tables).toContain('aihub_members')
    expect(tables).toContain('aihub_messages')
    expect(tables.indexOf('aihub_members')).toBeLessThan(tables.indexOf('aihub_messages'))
  })
})

describe('never queues a write the server would refuse', () => {
  /**
   * Each of these cost a real debugging session against a live database. The
   * push queue retries forever and drains in table order, so ONE impossible
   * row stalls every message behind it — and the app went on reporting itself
   * connected while two machines in the same room each saw only themselves.
   */

  it('does not push the room structure before anybody has joined', async () => {
    const h = harness({ anonymous: true })
    h.state.categories = { announcements: { id: 'announcements', name: 'Announcements', position: 0 } } as never
    h.replication.reconcile()
    await h.replication.flush?.()
    expect(h.upserts.flatMap(u => u.table)).not.toContain('aihub_categories')
  })

  it('does not push a member row belonging to somebody else', async () => {
    const h = harness({ admin: false })
    h.state.members['someone-else'] = {
      id: 'someone-else', handle: 'other', handleKey: 'other',
      avatarSeed: 'x', createdAt: NOW,
    } as never
    h.replication.reconcile()
    await h.replication.flush?.()
    const pushedMembers = h.upserts
      .filter(u => u.table === 'aihub_members')
      .flatMap(u => u.rows as { id: string }[])
      .map(r => r.id)
    expect(pushedMembers).not.toContain('someone-else')
  })

  it('still pushes this device\u2019s own member row', async () => {
    const h = harness({ admin: false })
    h.replication.reconcile()
    await h.replication.flush?.()
    const pushedMembers = h.upserts
      .filter(u => u.table === 'aihub_members')
      .flatMap(u => u.rows as { id: string }[])
      .map(r => r.id)
    expect(pushedMembers).toContain(ME)
  })

  // "open a dm" is the one carve-out in the channel policy, so it is the one
  // structural write an ordinary member is allowed to make.
  it('lets an ordinary member open a direct message', async () => {
    const h = harness({ admin: false })
    h.state.channels = { 'dm-1': { slug: 'dm-1', type: 'dm', name: 'dm' } } as never
    h.replication.reconcile()
    await h.replication.flush?.()
    expect(h.upserts.flatMap(u => u.table)).toContain('aihub_channels')
  })

  it('lets a moderator manage the structure', async () => {
    const h = harness({ admin: true })
    h.state.categories = { technology: { id: 'technology', name: 'Technology', position: 1 } } as never
    h.replication.reconcile()
    await h.replication.flush?.()
    expect(h.upserts.flatMap(u => u.table)).toContain('aihub_categories')
  })
})

describe('messages: only what this device is entitled to push', () => {
  const msgRow = (over: Record<string, unknown> = {}) => ({
    id: 'x1', channel: 'general', author_id: ME, updated_at: NOW,
    doc: { id: 'x1', channel: 'general', authorId: ME, body: 'hi' },
    ...over,
  })

  const pushedMessageIds = (h: Harness) => h.upserts
    .filter(u => u.table === 'aihub_messages')
    .flatMap(u => u.rows as { id: string }[])
    .map(r => r.id)

  it('pushes a message this device wrote', async () => {
    const h = harness({ admin: false })
    h.replication.push('aihub_messages', msgRow())
    await h.replication.flush?.()
    expect(pushedMessageIds(h)).toContain('x1')
  })

  /**
   * The one-way replication bug, in a test.
   *
   * Machine A received machine B's message, then offered it back to the
   * server. The insert policy is "post as self", so Postgres refused it — and
   * because the queue retries forever and drains in table order, A never
   * delivered anything of its own again. Messages went B to A and never back.
   */
  it('does not offer back a message it merely received', async () => {
    const h = harness({ admin: false })
    h.replication.push('aihub_messages', msgRow({
      id: 'theirs', author_id: 'someone-else',
      doc: { id: 'theirs', authorId: 'someone-else', body: 'from the other machine' },
    }))
    await h.replication.flush?.()
    expect(pushedMessageIds(h)).not.toContain('theirs')
  })

  // Seeded identically on every install from a written list, so replicating
  // them means every machine pushing its own copy of the same rows — all of
  // which are authored by the guide and refused by "post as self".
  it('never replicates a welcome message', async () => {
    const h = harness({ admin: true })
    h.replication.push('aihub_messages', msgRow({
      id: 'welcome-1', author_id: BOT_MEMBER_ID,
      doc: { id: 'welcome-1', authorId: BOT_MEMBER_ID, body: 'welcome', isWelcome: true },
    }))
    await h.replication.flush?.()
    expect(pushedMessageIds(h)).not.toContain('welcome-1')
  })

  it('lets the owner publish what the guide wrote', async () => {
    const h = harness({ admin: true })
    h.replication.push('aihub_messages', msgRow({
      id: 'guide-1', author_id: BOT_MEMBER_ID,
      doc: { id: 'guide-1', authorId: BOT_MEMBER_ID, body: 'a discussion starter' },
    }))
    await h.replication.flush?.()
    expect(pushedMessageIds(h)).toContain('guide-1')
  })

  // Only the owner's machine runs the guide; everyone else would be posting a
  // second voice under the same name.
  it('refuses to publish as the guide from a member machine', async () => {
    const h = harness({ admin: false })
    h.replication.push('aihub_messages', msgRow({
      id: 'guide-2', author_id: BOT_MEMBER_ID,
      doc: { id: 'guide-2', authorId: BOT_MEMBER_ID, body: 'not mine to send' },
    }))
    await h.replication.flush?.()
    expect(pushedMessageIds(h)).not.toContain('guide-2')
  })
})
