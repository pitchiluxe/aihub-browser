import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommunityState, Message } from '../../shared/community'
import {
  PRIMARY_KEY, SYNC_TABLES, docOf, rowToMemberRoles, stateToRows,
  type Row, type SyncTable,
} from './sync'
import type { RemoteStatus } from './remote'

/**
 * Local state as a replica, not a rival.
 *
 * The alternative — reading every view straight from Postgres — means a round
 * trip before the first message renders, a spinner on every channel switch, and
 * a Community tab that is blank whenever the wifi is. Instead the JSON file
 * stays exactly what it was and this module keeps it honest: local writes go
 * up, remote writes come down, and both reach the renderer through the one
 * `broadcast()` it already listens to.
 *
 * That last part is the property worth protecting. The renderer does not know
 * whether a server exists. Local and remote are not two code paths through the
 * UI — they are the same path with a different filler, which is why this change
 * adds files instead of rewriting CommunityShell.
 *
 * ── Ordering rule, not negotiable ─────────────────────────────────────────
 * Callers must push only *after* the local rules in store.ts have accepted a
 * change and local state already holds it. Pushing first would put a message
 * on five other machines that this one had refused to keep.
 */

export interface ReplicationDeps {
  client: SupabaseClient
  readState: () => CommunityState
  updateState: (mutate: (state: CommunityState) => void) => void
  broadcast: (channel: string, payload: unknown) => void
  /** Called after a batch of remote rows lands, so the caller can persist. */
  persist?: () => void
  now?: () => number
}

/** How long a pushed row's id stays in the echo set. Comfortably longer than
 *  any round trip, far shorter than a plausible second edit of the same row. */
export const ECHO_TTL_MS = 15_000
/** Writes coalesce over this window. A burst of reactions becomes one request. */
export const PUSH_DEBOUNCE_MS = 250
const MAX_BACKOFF_MS = 30_000

interface Pending { table: SyncTable; row: Row }
interface Removal { table: SyncTable; id: string }

export function createReplication(deps: ReplicationDeps) {
  const { client, readState, updateState, broadcast, persist } = deps
  const now = deps.now ?? Date.now

  const queue: Pending[] = []
  const removals: Removal[] = []
  /** Row primary keys this device wrote, and when. */
  const echoes = new Map<string, number>()
  /** `${table}:${pk}` -> a JSON fingerprint of that entity as last replicated.
   *  What `reconcile()` diffs against. */
  const fingerprints = new Map<string, string>()
  const channels: { unsubscribe: () => void }[] = []

  let timer: ReturnType<typeof setTimeout> | null = null
  let backoff = 0
  let state: RemoteStatus = 'off'
  let error: string | null = null
  let draining = false

  /**
   * Every broadcast in this module goes through here.
   *
   * The backfill applies several hundred rows in a loop; one refresh at the end
   * beats four hundred, and the renderer re-reads everything on any of them
   * anyway. `applyQuiet` closes this gate for the duration.
   */
  let broadcastEnabled = true
  const emit = (channel: string, payload: unknown) => {
    if (broadcastEnabled) broadcast(channel, payload)
  }

  const echoKey = (table: SyncTable, id: unknown) => `${table}:${String(id)}`

  const rememberEcho = (table: SyncTable, row: Row) => {
    const id = row[PRIMARY_KEY[table]]
    if (id === undefined) return
    echoes.set(echoKey(table, id), now())
  }

  const isEcho = (table: SyncTable, id: unknown): boolean => {
    const key = echoKey(table, id)
    const at = echoes.get(key)
    if (at === undefined) return false
    if (now() - at > ECHO_TTL_MS) { echoes.delete(key); return false }
    return true
  }

  // ── Push ─────────────────────────────────────────────────────────────────

  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => { timer = null; void drain() }, PUSH_DEBOUNCE_MS + backoff)
  }

  async function drain(): Promise<void> {
    if (draining) return
    if (!queue.length && !removals.length) return
    draining = true

    // Taken, not spliced-as-we-go: a failure has to put the whole batch back,
    // and a half-drained queue would reorder an edit ahead of its own insert.
    const batch = queue.splice(0, queue.length)
    const gone = removals.splice(0, removals.length)

    try {
      for (const table of SYNC_TABLES) {
        const rows = batch.filter(p => p.table === table).map(p => p.row)
        if (!rows.length) continue
        const { error: pushError } = await client
          .from(table)
          .upsert(rows as never, { onConflict: PRIMARY_KEY[table] })
        if (pushError) throw new Error(`${table}: ${pushError.message}`)
      }

      for (const removal of gone) {
        const { error: deleteError } = await client
          .from(removal.table).delete().eq(PRIMARY_KEY[removal.table], removal.id)
        if (deleteError) throw new Error(`${removal.table}: ${deleteError.message}`)
      }

      backoff = 0
      if (state === 'error') { state = 'online'; error = null }
    } catch (failure) {
      // Put it back. A message typed on a flaky connection must not evaporate —
      // it goes out when the connection returns, which is the whole reason
      // there is a queue rather than a bare await at each call site.
      queue.unshift(...batch)
      removals.unshift(...gone)
      backoff = backoff ? Math.min(backoff * 2, MAX_BACKOFF_MS) : 1000
      state = 'error'
      error = failure instanceof Error ? failure.message : String(failure)
      schedule()
    } finally {
      draining = false
      if (queue.length || removals.length) schedule()
    }
  }

  // ── Pull ─────────────────────────────────────────────────────────────────

  /**
   * Fold one remote row into local state and tell the renderer.
   *
   * The broadcasts fired here are deliberately the *same* ones the local
   * mutating handlers fire. A message arriving from Frankfurt and a message
   * typed in the next window reach MessageList by the identical route.
   */
  function applyRemote(table: SyncTable, event: 'INSERT' | 'UPDATE' | 'DELETE', row: Row): void {
    const id = row?.[PRIMARY_KEY[table]]
    if (id === undefined) return
    // Your own write, arriving back. Applying it is harmless but broadcasting
    // it is not: the renderer would render every message you send twice.
    if (isEcho(table, id)) return

    if (event === 'DELETE') { applyDelete(table, String(id)); return }

    switch (table) {
      case 'aihub_messages': {
        const message = docOf<Message>(row)
        if (!message) return
        let inserted = false
        updateState(s => {
          const at = s.messages.findIndex(m => m.id === message.id)
          if (at === -1) { s.messages.push(message); inserted = true }
          else s.messages[at] = message
        })
        if (inserted) {
          emit('community:message', { channel: message.channel, message })
          emit('community:event', { type: 'message.new', channel: message.channel, message })
        } else {
          emit('community:event', { type: 'message.edit', channel: message.channel, message })
        }
        break
      }
      case 'aihub_members': {
        const member = docOf<{ id: string }>(row)
        if (!member) return
        updateState(s => { (s.members as Record<string, unknown>)[member.id] = member })
        emit('community:refresh', { reason: 'members' })
        break
      }
      case 'aihub_channels': {
        const channel = docOf<{ slug: string }>(row)
        if (!channel) return
        updateState(s => { (s.channels as Record<string, unknown>)[channel.slug] = channel })
        emit('community:refresh', { reason: 'channels' })
        break
      }
      case 'aihub_categories': {
        const category = docOf<{ id: string }>(row)
        if (!category) return
        updateState(s => { (s.categories as Record<string, unknown>)[category.id] = category })
        emit('community:refresh', { reason: 'channels' })
        break
      }
      case 'aihub_roles': {
        const role = docOf<{ id: string }>(row)
        if (!role) return
        updateState(s => { (s.roles as Record<string, unknown>)[role.id] = role })
        emit('community:refresh', { reason: 'roles' })
        break
      }
      case 'aihub_member_roles': {
        const mapping = rowToMemberRoles(row)
        if (!mapping) return
        updateState(s => { s.memberRoles[mapping.memberId] = mapping.roleIds })
        emit('community:refresh', { reason: 'roles' })
        break
      }
      case 'aihub_reports': {
        const report = docOf<{ id: string }>(row)
        if (!report) return
        updateState(s => {
          const at = s.reports.findIndex(r => r.id === report.id)
          if (at === -1) s.reports.push(report as never)
          else s.reports[at] = report as never
        })
        emit('community:refresh', { reason: 'moderation' })
        break
      }
      case 'aihub_audit_log': {
        const entry = docOf<{ id: string }>(row)
        if (!entry) return
        updateState(s => {
          if (!s.auditLog.some(e => e.id === entry.id)) s.auditLog.push(entry as never)
        })
        break
      }
      case 'aihub_ownership': {
        const ownership = docOf<never>(row)
        if (!ownership) return
        updateState(s => { s.ownership = ownership })
        emit('community:refresh', { reason: 'admin' })
        break
      }
    }
    persist?.()
  }

  function applyDelete(table: SyncTable, id: string): void {
    switch (table) {
      case 'aihub_messages':
        updateState(s => {
          const at = s.messages.findIndex(m => m.id === id)
          if (at !== -1) s.messages.splice(at, 1)
        })
        emit('community:refresh', { reason: 'moderation' })
        break
      case 'aihub_members':
        updateState(s => { delete s.members[id] })
        emit('community:refresh', { reason: 'members' })
        break
      case 'aihub_channels':
        updateState(s => { delete s.channels[id] })
        emit('community:refresh', { reason: 'channels' })
        break
      case 'aihub_categories':
        updateState(s => { delete s.categories[id] })
        emit('community:refresh', { reason: 'channels' })
        break
      case 'aihub_roles':
        updateState(s => { delete s.roles[id] })
        emit('community:refresh', { reason: 'roles' })
        break
      case 'aihub_member_roles':
        updateState(s => { delete s.memberRoles[id] })
        emit('community:refresh', { reason: 'roles' })
        break
      case 'aihub_reports':
        updateState(s => {
          const at = s.reports.findIndex(r => r.id === id)
          if (at !== -1) s.reports.splice(at, 1)
        })
        emit('community:refresh', { reason: 'moderation' })
        break
      default:
        break
    }
    persist?.()
  }

  // ── Backfill and subscribe ───────────────────────────────────────────────

  /**
   * Read the room, then start listening.
   *
   * The order is the point. Subscribing first and backfilling after loses every
   * event that arrives during the read; backfilling first and subscribing after
   * can only *duplicate* one, and an upsert-by-id makes a duplicate free.
   */
  async function backfill(): Promise<void> {
    for (const table of SYNC_TABLES) {
      const { data, error: readError } = await client.from(table).select('*')
      if (readError) {
        // Reports and the audit log are moderator-only by policy, so a
        // permission error on those is the system working. Anything else is a
        // real failure and worth surfacing.
        if (table === 'aihub_reports' || table === 'aihub_audit_log') continue
        throw new Error(`Could not read ${table}: ${readError.message}`)
      }
      for (const row of data ?? []) applyQuiet(table, row as Row)
    }
    persist?.()
    emit('community:refresh', { reason: 'backfill' })
  }

  /**
   * Apply a backfilled row without a broadcast, and record it as already known.
   *
   * The fingerprint is taken from what the *server* returned, not from local
   * state afterwards. That distinction is the whole correctness of the first
   * reconcile: anything this device holds that the backfill did not carry is,
   * by definition, something the server has never seen — a message typed while
   * offline, or the entire history of a machine that is first to configure the
   * backend — and the diff pushes it. Baselining from local state instead would
   * mark those rows as sent and lose them silently, forever.
   */
  function applyQuiet(table: SyncTable, row: Row): void {
    const noise = broadcastEnabled
    broadcastEnabled = false
    try { applyRemote(table, 'INSERT', row) } finally { broadcastEnabled = noise }

    const id = row[PRIMARY_KEY[table]]
    if (id === undefined) return
    fingerprints.set(`${table}:${String(id)}`, JSON.stringify(row.doc ?? row.role_ids ?? null))
  }

  function subscribe(): void {
    for (const table of SYNC_TABLES) {
      const channel = client
        .channel(`community:${table}`)
        .on(
          'postgres_changes' as never,
          { event: '*', schema: 'public', table } as never,
          (payload: { eventType: string; new: Row; old: Row }) => {
            const event = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
            applyRemote(table, event, event === 'DELETE' ? payload.old : payload.new)
          },
        )
        .subscribe()
      channels.push(channel as unknown as { unsubscribe: () => void })
    }
  }

  return {
    push(table: SyncTable, row: Row): void {
      rememberEcho(table, row)
      // One row per primary key in the queue: a message edited three times
      // before the debounce fires should cost one request carrying the latest
      // version, not three carrying a stale one first.
      const key = row[PRIMARY_KEY[table]]
      const at = queue.findIndex(p => p.table === table && p.row[PRIMARY_KEY[table]] === key)
      if (at === -1) queue.push({ table, row })
      else queue[at] = { table, row }
      schedule()
    },

    remove(table: SyncTable, id: string): void {
      echoes.set(echoKey(table, id), now())
      removals.push({ table, id })
      schedule()
    },

    /**
     * Push whatever changed since the last look.
     *
     * Called once after every local mutation, from a single hook around the
     * data store, rather than from a `push()` bolted onto each of the twenty-odd
     * mutating IPC handlers. That was the first design and it was wrong: it
     * needs a line in every handler that exists today and, worse, in every
     * handler written later. A `deleteChannel` added next year with no push
     * beside it does not fail — it just quietly stops replicating, on one
     * table, for everybody.
     *
     * Diffing costs a JSON.stringify per entity per mutation. At community
     * scale that is single-digit milliseconds, and it buys the guarantee that
     * nothing can be forgotten.
     *
     * `baselineOnly` records the current shape without sending anything, which
     * is what the backfill needs: those rows just came *from* the server.
     */
    reconcile(baselineOnly = false): void {
      const rows = stateToRows(readState(), now())
      const seen = new Set<string>()

      for (const { table, row } of rows) {
        const key = `${table}:${String(row[PRIMARY_KEY[table]])}`
        seen.add(key)
        // Fingerprint the payload only. `updated_at` is minted fresh on every
        // call, so including it would make every entity look changed forever.
        const fingerprint = JSON.stringify(row.doc ?? row.role_ids ?? null)
        if (fingerprints.get(key) === fingerprint) continue
        fingerprints.set(key, fingerprint)
        if (!baselineOnly) this.push(table, row)
      }

      for (const key of [...fingerprints.keys()]) {
        if (seen.has(key)) continue
        fingerprints.delete(key)
        const gap = key.indexOf(':')
        const table = key.slice(0, gap) as SyncTable
        // The audit log is append-only upstream and never shrinks locally;
        // a missing entry means pruning, not a deletion anybody should see.
        if (table === 'aihub_audit_log') continue
        if (!baselineOnly) this.remove(table, key.slice(gap + 1))
      }
    },

    /** Push everything this device already had, ignoring the baseline. Used
     *  once, by whichever machine configures the backend first, so five private
     *  histories become one shared one instead of an empty room. */
    seed(): void {
      for (const { table, row } of stateToRows(readState(), now())) this.push(table, row)
    },

    async start(): Promise<void> {
      state = 'connecting'
      try {
        // The backfill records a fingerprint per row it received, so the
        // caller's first reconcile() pushes exactly the difference: nothing on
        // a device that is merely rejoining, and its whole local history on the
        // device that configures the backend first.
        await backfill()
        subscribe()
        state = 'online'
        error = null
      } catch (failure) {
        state = 'error'
        error = failure instanceof Error ? failure.message : String(failure)
        throw failure
      }
    },

    async stop(): Promise<void> {
      if (timer) { clearTimeout(timer); timer = null }
      await drain().catch(() => {})
      for (const channel of channels) {
        try { channel.unsubscribe() } catch { /* already gone */ }
      }
      channels.length = 0
      state = 'off'
    },

    /** Flush now rather than on the debounce. Used before quit. */
    flush: drain,
    pending: () => queue.length + removals.length,
    status: () => state,
    lastError: () => error,
    /** Exposed for tests: drives the pull path without a socket. */
    applyRemote,
  }
}

export type Replication = ReturnType<typeof createReplication>
