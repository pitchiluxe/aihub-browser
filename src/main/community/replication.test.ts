import { describe, it, expect, vi } from 'vitest'
import { createReplication, ECHO_TTL_MS } from './replication'
import { emptyState } from '../../shared/communityMigrate'
import { messageToRow } from './sync'
import type { CommunityState, Message } from '../../shared/community'

const NOW = 1_700_000_000_000

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1', channel: 'general', authorId: 'a1', authorHandle: 'ada',
  authorSeed: 'a1', kind: 'text', body: 'hello', createdAt: NOW, ...over,
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

function harness(): Harness {
  const state = emptyState()
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
