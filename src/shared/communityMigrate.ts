import type { CommunityState, Member, Message, Report } from './community'
import { seedChannels, DEFAULT_CATEGORIES } from './communityChannels'
import { DEFAULT_ROLES, MODERATOR_ROLE_ID } from './communityPermissions'

/**
 * Bringing a community-data.json written by v1.53.0 forward, without losing any
 * of it.
 *
 * The file on a user's disk is the community. There is no server to re-fetch
 * from and no backup, so a migration that drops a field drops it permanently.
 * Everything here is therefore additive: existing collections are carried
 * across by reference and new ones are filled in around them.
 *
 * The one constraint that shaped the whole design: `message.channel` holds a
 * channel *slug*, and channels used to be a hardcoded constant. Turning them
 * into state meant either rewriting every message or keeping every slug
 * identical. Keeping the slugs was free, so that is what happens — the seven
 * shipped rooms arrive as records with the same keys they always had, and the
 * new rooms are added next to them.
 */

export const SCHEMA_VERSION = 1

/**
 * Migrate in place and return the same object.
 *
 * In place because the caller is a jsonStore holding the live state, and
 * returning a copy would leave it writing the old one. Callers that want a copy
 * should clone before calling — the tests do.
 */
export function migrateState(raw: any): CommunityState {
  const state = (raw && typeof raw === 'object' ? raw : {}) as Partial<CommunityState>

  // Collections that already existed. Defaulted rather than assumed, because
  // a file truncated by a bad shutdown is a real thing that happens and it
  // should cost the user the tail of one conversation, not the whole app.
  state.members  ??= {} as Record<string, Member>
  state.messages ??= [] as Message[]
  state.blocks   ??= {} as Record<string, string[]>
  state.reports  ??= [] as Report[]

  const alreadyMigrated = state.schemaVersion === SCHEMA_VERSION

  state.categories  ??= {}
  state.channels    ??= {}
  state.roles       ??= {}
  state.memberRoles ??= {}
  state.reads       ??= {}
  state.notifPrefs  ??= {}
  state.auditLog    ??= []
  state.ownership   ??= null

  // Seed only on the way up from v0. Re-seeding on every load would resurrect
  // a channel the owner had deleted, once per restart, forever.
  if (!alreadyMigrated) {
    for (const category of DEFAULT_CATEGORIES) {
      state.categories[category.id] ??= { ...category }
    }
    for (const channel of seedChannels()) {
      state.channels[channel.slug] ??= { ...channel }
    }
    for (const role of DEFAULT_ROLES) {
      state.roles[role.id] ??= { ...role, permissions: [...role.permissions] }
    }

    // The legacy isAdmin flag meant "first member on this install", which is a
    // claim about who installed the app and not about who owns the community.
    // It becomes moderator — real authority over messages — while ownership
    // stays unclaimed until someone proves the owner's email to Google.
    for (const member of Object.values(state.members)) {
      if (!member.isAdmin) continue
      const roles = state.memberRoles[member.id] ??= []
      if (!roles.includes(MODERATOR_ROLE_ID)) roles.push(MODERATOR_ROLE_ID)
    }
  }

  state.schemaVersion = SCHEMA_VERSION
  return state as CommunityState
}

/** A brand-new community, fully seeded. Used for a first run and by tests. */
export function emptyState(): CommunityState {
  return migrateState({})
}
