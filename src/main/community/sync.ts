import type {
  AuditEntry, Category, Channel, CommunityState, Member, Message, Ownership, Report,
} from '../../shared/community'

/**
 * The translation between CommunityState and Postgres rows.
 *
 * Pure: no client, no await, no Electron. Everything crossing the wire crosses
 * here, so `sync.test.ts` is the one thing standing between a model change and
 * a field that silently stops replicating.
 *
 * Each entity travels whole, inside `doc`. Only the fields Postgres itself
 * needs — a primary key, an index, a row level security check — are lifted out
 * into real columns, and those are exactly the fields that cannot drift,
 * because the database rejects a row without them. See the long note at the
 * top of supabase/migrations/0001_community.sql for why a column-per-field
 * schema was rejected.
 */

/** The tables this app replicates, in the order a fresh device must fill them:
 *  members before messages (author foreign key), roles before member_roles. */
export const SYNC_TABLES = [
  'aihub_members', 'aihub_categories', 'aihub_channels', 'aihub_roles',
  'aihub_member_roles', 'aihub_messages', 'aihub_reports', 'aihub_audit_log',
  'aihub_ownership',
] as const

export type SyncTable = typeof SYNC_TABLES[number]

export interface Row {
  [column: string]: unknown
  doc?: unknown
}

/** Which column holds the primary key, per table. Needed for deletes and for
 *  matching a Realtime payload back to a local record. */
export const PRIMARY_KEY: Record<SyncTable, string> = {
  aihub_members: 'id',
  aihub_categories: 'id',
  aihub_channels: 'slug',
  aihub_roles: 'id',
  aihub_member_roles: 'member_id',
  aihub_messages: 'id',
  aihub_reports: 'id',
  aihub_audit_log: 'id',
  aihub_ownership: 'id',
}

// ── State → row ────────────────────────────────────────────────────────────

export function memberToRow(member: Member, now: number): Row {
  return { id: member.id, handle_key: member.handleKey, updated_at: now, doc: member }
}

export function categoryToRow(category: Category, now: number): Row {
  return { id: category.id, updated_at: now, doc: category }
}

export function channelToRow(channel: Channel, now: number): Row {
  return { slug: channel.slug, updated_at: now, doc: channel }
}

export function roleToRow(role: { id: string }, now: number): Row {
  return { id: role.id, updated_at: now, doc: role }
}

export function memberRolesToRow(memberId: string, roleIds: string[], now: number): Row {
  return { member_id: memberId, role_ids: roleIds, updated_at: now }
}

export function messageToRow(message: Message, now: number): Row {
  return {
    id: message.id,
    channel: message.channel,
    author_id: message.authorId,
    created_at: message.createdAt,
    updated_at: now,
    doc: message,
  }
}

export function reportToRow(report: Report, now: number): Row {
  return {
    id: report.id,
    message_id: report.messageId,
    reporter_id: report.reporterId,
    created_at: report.createdAt,
    updated_at: now,
    doc: report,
  }
}

export function auditToRow(entry: AuditEntry): Row {
  return { id: entry.id, created_at: entry.createdAt, doc: entry }
}

export function ownershipToRow(ownership: Ownership, now: number): Row {
  return { id: true, updated_at: now, doc: ownership }
}

// ── Row → state ────────────────────────────────────────────────────────────

/**
 * Unwrap a row's `doc`.
 *
 * Supabase returns jsonb as a parsed object, but a Realtime payload from an
 * older client, or a row written by hand in the SQL editor, can arrive as a
 * string. Both are accepted; anything that is neither returns null so one
 * malformed row cannot take down a whole backfill.
 */
export function docOf<T>(row: Row | null | undefined): T | null {
  if (!row) return null
  const doc = row.doc
  if (doc && typeof doc === 'object') return doc as T
  if (typeof doc === 'string') {
    try { return JSON.parse(doc) as T } catch { return null }
  }
  return null
}

export const rowToMember = (row: Row) => docOf<Member>(row)
export const rowToCategory = (row: Row) => docOf<Category>(row)
export const rowToChannel = (row: Row) => docOf<Channel>(row)
export const rowToMessage = (row: Row) => docOf<Message>(row)
export const rowToReport = (row: Row) => docOf<Report>(row)
export const rowToAudit = (row: Row) => docOf<AuditEntry>(row)
export const rowToOwnership = (row: Row) => docOf<Ownership>(row)

export function rowToMemberRoles(row: Row): { memberId: string; roleIds: string[] } | null {
  const memberId = row?.member_id
  if (typeof memberId !== 'string') return null
  const raw = row.role_ids
  const roleIds = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string' ? safeArray(raw) : []
  return { memberId, roleIds }
}

function safeArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch { return [] }
}

// ── Whole-state export ─────────────────────────────────────────────────────

/**
 * Every row this device would push if it were the first one online.
 *
 * Used exactly once per install: the machine that configures the backend first
 * seeds the room from whatever it already had locally, so five people who have
 * each been talking to themselves do not arrive at an empty community. Later
 * devices find those rows already there and their own upserts are no-ops on
 * anything older.
 */
export function stateToRows(state: CommunityState, now: number): { table: SyncTable; row: Row }[] {
  const out: { table: SyncTable; row: Row }[] = []

  for (const member of Object.values(state.members)) out.push({ table: 'aihub_members', row: memberToRow(member, now) })
  for (const category of Object.values(state.categories)) out.push({ table: 'aihub_categories', row: categoryToRow(category, now) })
  for (const channel of Object.values(state.channels)) out.push({ table: 'aihub_channels', row: channelToRow(channel, now) })
  for (const role of Object.values(state.roles)) out.push({ table: 'aihub_roles', row: roleToRow(role, now) })
  for (const [memberId, roleIds] of Object.entries(state.memberRoles)) {
    out.push({ table: 'aihub_member_roles', row: memberRolesToRow(memberId, roleIds, now) })
  }
  for (const message of state.messages) out.push({ table: 'aihub_messages', row: messageToRow(message, now) })
  for (const report of state.reports) out.push({ table: 'aihub_reports', row: reportToRow(report, now) })
  for (const entry of state.auditLog) out.push({ table: 'aihub_audit_log', row: auditToRow(entry) })
  if (state.ownership) out.push({ table: 'aihub_ownership', row: ownershipToRow(state.ownership, now) })

  return out
}
