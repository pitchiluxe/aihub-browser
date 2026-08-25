import {
  ALL_PERMISSIONS,
  type AuditAction, type AuditEntry, type Category, type Channel, type ChannelType,
  type CommunityState, type Permission, type Role,
} from '../../shared/community'
import { hasPermission, isOwner, OWNER_ROLE_ID } from '../../shared/communityPermissions'
import { isOwnerEmail, normalizeEmail } from '../../shared/communityOwner'

/**
 * Administration of the community: ownership, channels, categories, roles and
 * member sanctions.
 *
 * Pure functions over the state object, exactly like ./store — and for the same
 * reason. Every one of these is an authorization decision, and an authorization
 * decision that can only be tested through an IPC handler and a window is one
 * that will not be tested.
 *
 * Each function checks the caller's permission *itself* rather than trusting
 * its caller to have done it. The IPC layer checks too. That duplication is the
 * point: a new handler added later without a check is a bug, not a hole.
 */

export type AdminResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

const fail = (error: string): AdminResult<never> => ({ ok: false, error })
const done = (): AdminResult => ({ ok: true })

/** Append an audit entry. Called inside the same mutation as the change, so an
 *  action cannot succeed unlogged. */
function audit(
  state: CommunityState,
  actorId: string,
  action: AuditAction,
  targetType: AuditEntry['targetType'],
  targetId: string,
  now: number,
  newId: () => string,
  meta?: AuditEntry['meta'],
): void {
  state.auditLog.push({ id: newId(), actorId, action, targetType, targetId, createdAt: now, ...(meta ? { meta } : {}) })
  // The log is evidence, not storage. Ten thousand entries is far more history
  // than a community this size will ever need, and unbounded growth in a file
  // that is rewritten whole is a performance bug waiting for its first year.
  if (state.auditLog.length > 10_000) state.auditLog.splice(0, state.auditLog.length - 10_000)
}

/** Refuse unless the caller holds the permission. One helper so every guard
 *  reads the same and none of them can drift. */
function requirePermission(
  state: CommunityState, memberId: string, permission: Permission, channelSlug?: string,
): AdminResult<never> | null {
  if (!state.members[memberId]) return fail('Join the community first.')
  if (hasPermission(state, memberId, permission, channelSlug)) return null
  return fail('You do not have permission to do that.')
}

// ── Ownership ──────────────────────────────────────────────────────────────

/**
 * Bind community ownership to the identity that just proved the owner's email.
 *
 * `email` must come from an OAuth token exchange. Nothing here can tell the
 * difference between a verified address and a typed one, which is precisely why
 * the only caller is the handler that just finished talking to Google — and why
 * that handler has no code path that accepts an address from the renderer.
 */
export function claimOwnership(
  state: CommunityState, memberId: string, email: string, now: number, newId: () => string,
): AdminResult {
  if (!state.members[memberId]) return fail('Join the community first.')
  if (!isOwnerEmail(email)) {
    return fail('That Google account is not the community owner.')
  }

  if (state.ownership) {
    // Already held by this identity: succeed without moving the timestamp, so
    // signing in again is not mistaken for a fresh claim in the audit log.
    if (state.ownership.memberId === memberId) return done()
    return fail('Community ownership is already held by another device. Release it there first.')
  }

  state.ownership = { memberId, email: normalizeEmail(email), verifiedAt: now }
  const roles = state.memberRoles[memberId] ??= []
  if (!roles.includes(OWNER_ROLE_ID)) roles.push(OWNER_ROLE_ID)

  audit(state, memberId, 'ownership.claimed', 'community', 'community', now, newId,
    { email: state.ownership.email })
  return done()
}

/** Hand ownership back, so a new device can claim it. Owner only. */
export function releaseOwnership(
  state: CommunityState, memberId: string, now: number, newId: () => string,
): AdminResult {
  if (!isOwner(state, memberId)) return fail('Only the community owner can do that.')

  const roles = state.memberRoles[memberId] ?? []
  state.memberRoles[memberId] = roles.filter(r => r !== OWNER_ROLE_ID)
  state.ownership = null

  audit(state, memberId, 'ownership.claimed', 'community', 'community', now, newId, { released: true })
  return done()
}

// ── Channels ───────────────────────────────────────────────────────────────

/**
 * A channel name reduced to the key it will be stored and joined under.
 *
 * Lowercase, ASCII-ish, hyphen-separated — the shape every message on disk
 * already uses. Returns '' when nothing usable is left, which the caller treats
 * as a rejected name rather than inventing one.
 */
export function slugify(name: string): string {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** Channels the sidebar should show: everything not archived, in rail order. */
export function activeChannels(state: CommunityState): Channel[] {
  return Object.values(state.channels)
    .filter(c => !c.archivedAt)
    .sort((a, b) => {
      const ca = state.categories[a.categoryId]?.position ?? 999
      const cb = state.categories[b.categoryId]?.position ?? 999
      return ca - cb || a.position - b.position || a.name.localeCompare(b.name)
    })
}

export interface NewChannel {
  name: string
  description?: string
  topic?: string
  categoryId?: string
  type?: ChannelType
  icon?: string
  accent?: string
}

export function createChannel(
  state: CommunityState, actorId: string, input: NewChannel, now: number, newId: () => string,
): AdminResult<{ channel: Channel }> {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  const slug = slugify(input.name)
  if (!slug) return fail('Give the channel a name using letters or numbers.')
  if (state.channels[slug]) return fail('A channel with that name already exists.')

  const categoryId = input.categoryId ?? 'community'
  if (!state.categories[categoryId]) return fail('That category does not exist.')

  const position = Object.values(state.channels)
    .filter(c => c.categoryId === categoryId).length

  const channel: Channel = {
    slug,
    name: String(input.name).trim().slice(0, 60),
    description: String(input.description ?? '').trim().slice(0, 200),
    icon: input.icon || (input.type === 'voice' ? 'Volume2' : 'Hash'),
    accent: input.accent || '#94a3b8',
    extras: [],
    categoryId,
    position,
    type: input.type ?? 'text',
    ...(input.topic ? { topic: String(input.topic).trim().slice(0, 400) } : {}),
  }
  state.channels[slug] = channel

  audit(state, actorId, 'channel.created', 'channel', slug, now, newId, { name: channel.name })
  return { ok: true, channel }
}

export type ChannelEdit = Partial<Pick<Channel,
  'name' | 'description' | 'topic' | 'icon' | 'accent' | 'categoryId' | 'type' | 'overrides'>>

/**
 * Edit a channel — never its slug.
 *
 * The slug is the join key for every message already written. A rename that
 * moved it would leave real conversations pointing at a channel that no longer
 * exists, and there is no server to repair them from.
 */
export function updateChannel(
  state: CommunityState, actorId: string, slug: string, edit: ChannelEdit,
  now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  const channel = state.channels[slug]
  if (!channel) return fail('That channel does not exist.')
  if (edit.categoryId && !state.categories[edit.categoryId]) return fail('That category does not exist.')

  if (edit.name !== undefined) channel.name = String(edit.name).trim().slice(0, 60) || channel.name
  if (edit.description !== undefined) channel.description = String(edit.description).trim().slice(0, 200)
  if (edit.topic !== undefined) channel.topic = String(edit.topic).trim().slice(0, 400)
  if (edit.icon !== undefined) channel.icon = String(edit.icon).slice(0, 40)
  if (edit.accent !== undefined) channel.accent = String(edit.accent).slice(0, 20)
  if (edit.categoryId !== undefined) channel.categoryId = edit.categoryId
  if (edit.type !== undefined) channel.type = edit.type
  if (edit.overrides !== undefined) channel.overrides = edit.overrides

  audit(state, actorId, 'channel.updated', 'channel', slug, now, newId, { name: channel.name })
  return done()
}

/**
 * Delete a channel by archiving it.
 *
 * Deliberately not destructive. The messages in a channel belong to the people
 * who wrote them, and a mis-click in a channel list should not be able to end
 * a year of conversation. Archiving removes it from the sidebar and from
 * posting; purgeChannel is the separate, confirmed action that actually
 * destroys anything.
 */
export function deleteChannel(
  state: CommunityState, actorId: string, slug: string, now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  const channel = state.channels[slug]
  if (!channel) return fail('That channel does not exist.')
  channel.archivedAt = now

  audit(state, actorId, 'channel.deleted', 'channel', slug, now, newId, { name: channel.name })
  return done()
}

export function restoreChannel(
  state: CommunityState, actorId: string, slug: string, now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  const channel = state.channels[slug]
  if (!channel) return fail('That channel does not exist.')
  delete channel.archivedAt

  audit(state, actorId, 'channel.updated', 'channel', slug, now, newId, { restored: true })
  return done()
}

/**
 * Destroy a channel and everything written in it.
 *
 * Two gates, because this is the only action in the feature that loses
 * messages: the channel must already be archived, and the caller must repeat
 * the slug back. The confirmation is the slug rather than a yes/no because a
 * yes/no is answered by reflex.
 */
export function purgeChannel(
  state: CommunityState, actorId: string, slug: string, confirmSlug: string,
  now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  const channel = state.channels[slug]
  if (!channel) return fail('That channel does not exist.')
  if (!channel.archivedAt) return fail('Delete the channel first, then purge it.')
  if (confirmSlug !== slug) return fail(`Type "${slug}" to confirm.`)

  const removed = state.messages.filter(m => m.channel === slug).length
  state.messages = state.messages.filter(m => m.channel !== slug)
  const liveIds = new Set(state.messages.map(m => m.id))
  state.reports = state.reports.filter(r => liveIds.has(r.messageId))
  for (const perMember of Object.values(state.reads)) delete perMember[slug]
  for (const perMember of Object.values(state.notifPrefs)) delete perMember[slug]
  delete state.channels[slug]

  audit(state, actorId, 'channel.deleted', 'channel', slug, now, newId,
    { name: channel.name, purged: true, messages: removed })
  return done()
}

export interface ChannelOrder { slug: string; categoryId: string; position: number }

export function reorderChannels(
  state: CommunityState, actorId: string, order: ChannelOrder[], now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  for (const entry of order) {
    const channel = state.channels[entry.slug]
    // A stale slug means the sidebar was reordered against a channel someone
    // deleted a moment ago. Skipping it is right; failing the whole drag would
    // throw away the other nine moves for one that no longer matters.
    if (!channel) continue
    if (!state.categories[entry.categoryId]) continue
    channel.categoryId = entry.categoryId
    channel.position = Number(entry.position) || 0
  }

  audit(state, actorId, 'channel.reordered', 'community', 'community', now, newId,
    { channels: order.length })
  return done()
}

// ── Categories ─────────────────────────────────────────────────────────────

export function createCategory(
  state: CommunityState, actorId: string, name: string, now: number, newId: () => string,
): AdminResult<{ category: Category }> {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  const clean = String(name ?? '').trim().slice(0, 60)
  if (!clean) return fail('Give the category a name.')

  const id = newId()
  const position = Object.keys(state.categories).length
  const category: Category = { id, name: clean, position }
  state.categories[id] = category

  audit(state, actorId, 'category.created', 'category', id, now, newId, { name: clean })
  return { ok: true, category }
}

export function updateCategory(
  state: CommunityState, actorId: string, id: string, name: string, now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  const category = state.categories[id]
  if (!category) return fail('That category does not exist.')
  const clean = String(name ?? '').trim().slice(0, 60)
  if (!clean) return fail('Give the category a name.')
  category.name = clean

  audit(state, actorId, 'category.updated', 'category', id, now, newId, { name: clean })
  return done()
}

/**
 * Delete a category, rehoming its channels.
 *
 * Channels move to whichever category sorts first rather than being deleted or
 * left pointing at nothing. A channel with no category renders nowhere, which
 * is a data-loss bug wearing a layout bug's clothes.
 */
export function deleteCategory(
  state: CommunityState, actorId: string, id: string, now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_channels')
  if (denied) return denied

  const category = state.categories[id]
  if (!category) return fail('That category does not exist.')
  if (Object.keys(state.categories).length <= 1) {
    return fail('A community needs at least one category.')
  }

  const fallback = Object.values(state.categories)
    .filter(c => c.id !== id)
    .sort((a, b) => a.position - b.position)[0]
  for (const channel of Object.values(state.channels)) {
    if (channel.categoryId === id) channel.categoryId = fallback.id
  }
  delete state.categories[id]

  audit(state, actorId, 'category.deleted', 'category', id, now, newId, { name: category.name })
  return done()
}

// ── Roles ──────────────────────────────────────────────────────────────────

function validPermissions(input: unknown): Permission[] | null {
  if (!Array.isArray(input)) return null
  const allowed = new Set<string>(ALL_PERMISSIONS)
  const out: Permission[] = []
  for (const p of input) {
    if (typeof p !== 'string' || !allowed.has(p)) return null
    out.push(p as Permission)
  }
  return out
}

export function createRole(
  state: CommunityState, actorId: string,
  input: { name: string; color?: string; permissions: Permission[] },
  now: number, newId: () => string,
): AdminResult<{ role: Role }> {
  const denied = requirePermission(state, actorId, 'manage_roles')
  if (denied) return denied

  const name = String(input.name ?? '').trim().slice(0, 40)
  if (!name) return fail('Give the role a name.')

  const permissions = validPermissions(input.permissions)
  if (!permissions) return fail('That role asks for a permission that does not exist.')

  const id = newId()
  const position = Math.max(1, ...Object.values(state.roles).map(r => r.position)) - 0 + 1
  const role: Role = { id, name, color: input.color || '#94a3b8', position: Math.min(position, 99), permissions }
  state.roles[id] = role

  audit(state, actorId, 'role.created', 'role', id, now, newId, { name })
  return { ok: true, role }
}

export function updateRole(
  state: CommunityState, actorId: string, id: string,
  edit: { name?: string; color?: string; permissions?: Permission[] },
  now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_roles')
  if (denied) return denied

  const role = state.roles[id]
  if (!role) return fail('That role does not exist.')
  // The built-in roles are the floor the permission engine stands on. An owner
  // who could empty the owner role would lock themselves out permanently.
  if (role.system) return fail('Built-in roles cannot be edited.')

  if (edit.permissions !== undefined) {
    const permissions = validPermissions(edit.permissions)
    if (!permissions) return fail('That role asks for a permission that does not exist.')
    role.permissions = permissions
  }
  if (edit.name !== undefined) role.name = String(edit.name).trim().slice(0, 40) || role.name
  if (edit.color !== undefined) role.color = String(edit.color).slice(0, 20)

  audit(state, actorId, 'role.updated', 'role', id, now, newId, { name: role.name })
  return done()
}

export function deleteRole(
  state: CommunityState, actorId: string, id: string, now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_roles')
  if (denied) return denied

  const role = state.roles[id]
  if (!role) return fail('That role does not exist.')
  if (role.system) return fail('Built-in roles cannot be deleted.')

  delete state.roles[id]
  // Strip it from everyone, and from every channel override, so nothing is left
  // pointing at a role that no longer resolves.
  for (const [memberId, roles] of Object.entries(state.memberRoles)) {
    state.memberRoles[memberId] = roles.filter(r => r !== id)
  }
  for (const channel of Object.values(state.channels)) {
    if (channel.overrides) delete channel.overrides[id]
  }

  audit(state, actorId, 'role.deleted', 'role', id, now, newId, { name: role.name })
  return done()
}

export function assignRole(
  state: CommunityState, actorId: string, targetId: string, roleId: string,
  now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_roles')
  if (denied) return denied

  if (!state.members[targetId]) return fail('No such member.')
  if (!state.roles[roleId]) return fail('That role does not exist.')
  // Ownership is proved, never granted. Handing out the owner role would be a
  // second, unverified path to the permission set the whole design protects.
  if (roleId === OWNER_ROLE_ID) return fail('Ownership is claimed by verifying the owner email.')

  const roles = state.memberRoles[targetId] ??= []
  if (!roles.includes(roleId)) roles.push(roleId)

  audit(state, actorId, 'role.assigned', 'member', targetId, now, newId, { role: state.roles[roleId].name })
  return done()
}

export function revokeRole(
  state: CommunityState, actorId: string, targetId: string, roleId: string,
  now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_roles')
  if (denied) return denied

  if (!state.members[targetId]) return fail('No such member.')
  const roles = state.memberRoles[targetId] ?? []
  state.memberRoles[targetId] = roles.filter(r => r !== roleId)

  audit(state, actorId, 'role.revoked', 'member', targetId, now, newId,
    { role: state.roles[roleId]?.name ?? roleId })
  return done()
}

// ── Member sanctions ───────────────────────────────────────────────────────

export const MAX_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Silence a member for a while.
 *
 * The middle option between doing nothing and ending someone's membership. A
 * duration of zero lifts it, so the same call both applies and clears.
 */
export function timeoutMember(
  state: CommunityState, actorId: string, targetId: string, durationMs: number,
  reason: string, now: number, newId: () => string,
): AdminResult {
  const denied = requirePermission(state, actorId, 'manage_members')
  if (denied) return denied

  const target = state.members[targetId]
  if (!target) return fail('No such member.')
  if (actorId === targetId) return fail('You cannot time yourself out.')
  // The owner is the one account that must always be able to act — a moderator
  // able to silence them could take the community from them.
  if (isOwner(state, targetId)) return fail('The community owner cannot be timed out.')

  const duration = Math.min(Math.max(0, Number(durationMs) || 0), MAX_TIMEOUT_MS)
  if (duration === 0) {
    delete target.timeoutUntil
    delete target.timeoutReason
  } else {
    target.timeoutUntil = now + duration
    target.timeoutReason = String(reason ?? '').slice(0, 200)
  }

  audit(state, actorId, 'member.timeout', 'member', targetId, now, newId,
    { minutes: Math.round(duration / 60_000) })
  return done()
}

/** Is this member currently silenced? */
export function isTimedOut(state: CommunityState, memberId: string, now: number): boolean {
  const until = state.members[memberId]?.timeoutUntil
  return !!until && until > now
}
