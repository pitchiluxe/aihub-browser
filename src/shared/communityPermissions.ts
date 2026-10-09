import {
  ALL_PERMISSIONS,
  type CommunityState, type Permission, type Role,
} from './community'

/**
 * Who may do what — as one pure function, deliberately.
 *
 * The main process asks this before every mutation and the renderer asks it
 * before drawing a button. Both must get the same answer from the same code,
 * because the moment the two diverge the UI starts offering actions the backend
 * refuses, or worse, hiding actions it would have allowed.
 *
 * Nothing here reads a socket, a window or a disk. That is what lets the main
 * process treat it as an authorization decision rather than a suggestion.
 */

export const OWNER_ROLE_ID = 'owner'
export const MODERATOR_ROLE_ID = 'moderator'
export const MEMBER_ROLE_ID = 'member'

/**
 * Everyone holds `member` implicitly.
 *
 * Modelled after the role every community platform ends up needing: without a
 * baseline that cannot be removed, a member with zero roles has zero
 * permissions and the room is silently read-only for every new arrival.
 */
export const DEFAULT_ROLES: Role[] = [
  {
    id: OWNER_ROLE_ID,
    name: 'Community Owner',
    color: '#fbbf24',
    position: 100,
    // Spread from the vocabulary rather than retyped, so a new permission
    // cannot be introduced that the owner silently lacks.
    permissions: [...ALL_PERMISSIONS],
    system: true,
  },
  {
    id: MODERATOR_ROLE_ID,
    name: 'Moderator',
    color: '#38bdf8',
    position: 50,
    // Moderation is not administration. A moderator settles what has been
    // said; only the owner reshapes the place it was said in.
    permissions: [
      'send_messages', 'attach_files', 'add_reactions',
      'use_voice', 'use_video', 'screen_share',
      'manage_messages', 'manage_members', 'view_audit_log',
    ],
    system: true,
  },
  {
    id: MEMBER_ROLE_ID,
    name: 'Member',
    color: '#94a3b8',
    position: 0,
    permissions: [
      'send_messages', 'attach_files', 'add_reactions',
      'use_voice', 'use_video', 'screen_share',
    ],
    system: true,
  },
]

/** The roles one member actually holds, `member` always included. */
export function rolesFor(state: CommunityState, memberId: string): Role[] {
  const ids = [MEMBER_ROLE_ID, ...(state.memberRoles[memberId] ?? [])]
  const seen = new Set<string>()
  const out: Role[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const role = state.roles[id]
    if (role) out.push(role)
  }
  return out
}

export function isOwner(state: CommunityState, memberId: string): boolean {
  return !!state.ownership && state.ownership.memberId === memberId
}

/**
 * Everything this member may do, optionally within one channel.
 *
 * Three rules, in order:
 *
 *  1. A banned member may do nothing. They can still read — that is handled on
 *     the read path — but every action is refused at the source rather than at
 *     each of a dozen call sites.
 *  2. The owner may do everything, including things a channel override forbids.
 *     An owner who can lock themselves out of their own community with a
 *     mis-set override has no way back in, because the tool for fixing it is
 *     the tool they just lost.
 *  3. Everyone else gets the union of their roles' permissions, with the
 *     channel's overrides applied — and a denial anywhere beats a grant
 *     anywhere. If grants won, muting someone in a channel would be undone by
 *     handing them any second role, which makes channel restrictions
 *     unenforceable exactly when a community is big enough to need them.
 */
export function resolvePermissions(
  state: CommunityState, memberId: string, channelSlug?: string,
): Set<Permission> {
  const member = state.members[memberId]
  if (!member || member.bannedAt) return new Set()
  if (isOwner(state, memberId)) return new Set(ALL_PERMISSIONS)

  const roles = rolesFor(state, memberId)
  const granted = new Set<Permission>()
  for (const role of roles) for (const p of role.permissions) granted.add(p)

  const overrides = channelSlug ? state.channels[channelSlug]?.overrides : undefined
  if (overrides) {
    const denied = new Set<Permission>()
    for (const role of roles) {
      const override = overrides[role.id]
      if (!override) continue
      for (const p of override.allow ?? []) granted.add(p)
      for (const p of override.deny ?? []) denied.add(p)
    }
    for (const p of denied) granted.delete(p)
  }

  return granted
}

export function hasPermission(
  state: CommunityState, memberId: string, permission: Permission, channelSlug?: string,
): boolean {
  return resolvePermissions(state, memberId, channelSlug).has(permission)
}

/**
 * The highest-positioned role a member holds, for the colour and the label in
 * the member list. `member` is the floor, so this never returns undefined for
 * someone who exists.
 */
export function topRole(state: CommunityState, memberId: string): Role | undefined {
  if (isOwner(state, memberId)) return state.roles[OWNER_ROLE_ID]
  return rolesFor(state, memberId).sort((a, b) => b.position - a.position)[0]
}
