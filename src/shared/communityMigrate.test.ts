import { describe, it, expect } from 'vitest'
import { migrateState, SCHEMA_VERSION } from './communityMigrate'
import { LEGACY_CHANNELS } from './communityChannels'
import type { CommunityState } from './community'

/**
 * A capture of the shape v1.53.0 actually wrote to community-data.json.
 *
 * Hand-written rather than generated: the point of these tests is that a file
 * written by the *shipped* build survives, so the fixture must be what that
 * build produced and not what the current types happen to say.
 */
function v0Fixture(): any {
  return {
    members: {
      'm-owner': {
        id: 'm-owner', handle: 'Erick', handleKey: 'erick',
        avatarSeed: 'm-owner', createdAt: 1_700_000_000_000, isAdmin: true,
      },
      'm-two': {
        id: 'm-two', handle: 'Grace', handleKey: 'grace',
        avatarSeed: 'm-two', createdAt: 1_700_000_100_000,
      },
      'm-banned': {
        id: 'm-banned', handle: 'Spammer', handleKey: 'spammer',
        avatarSeed: 'm-banned', createdAt: 1_700_000_200_000,
        bannedAt: 1_700_000_300_000, banReason: 'Repeated reports.',
      },
    },
    messages: [
      {
        id: 'msg-1', channel: 'bible-study', authorId: 'm-owner',
        authorHandle: 'Erick', authorSeed: 'm-owner', kind: 'text',
        body: 'Welcome to the room.', createdAt: 1_700_000_400_000,
      },
      {
        id: 'msg-2', channel: 'developers', authorId: 'm-two',
        authorHandle: 'Grace', authorSeed: 'm-two', kind: 'code',
        body: 'const x = 1', language: 'ts', createdAt: 1_700_000_500_000,
        reactions: { pray: ['m-owner'] },
      },
      {
        id: 'msg-3', channel: 'jobs', authorId: 'm-banned',
        authorHandle: 'Spammer', authorSeed: 'm-banned', kind: 'text',
        body: 'buy now', createdAt: 1_700_000_600_000,
        hiddenAt: 1_700_000_700_000,
      },
    ],
    blocks: { 'm-two': ['m-banned'] },
    reports: [
      {
        id: 'r-1', messageId: 'msg-3', reporterId: 'm-two',
        reason: 'spam', createdAt: 1_700_000_650_000,
      },
    ],
  }
}

describe('migrateState — preserving what v1.53.0 wrote', () => {
  it('keeps every message, byte for byte, including its channel slug', () => {
    const before = v0Fixture()
    const after = migrateState(v0Fixture())

    expect(after.messages).toHaveLength(3)
    expect(after.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3'])
    expect(after.messages.map(m => m.channel)).toEqual(before.messages.map((m: any) => m.channel))
    expect(after.messages[1].reactions).toEqual({ pray: ['m-owner'] })
    expect(after.messages[2].hiddenAt).toBe(1_700_000_700_000)
  })

  it('keeps every member, including bans and handles', () => {
    const after = migrateState(v0Fixture())

    expect(Object.keys(after.members).sort()).toEqual(['m-banned', 'm-owner', 'm-two'])
    expect(after.members['m-banned'].bannedAt).toBe(1_700_000_300_000)
    expect(after.members['m-two'].handleKey).toBe('grace')
  })

  it('keeps blocks and reports', () => {
    const after = migrateState(v0Fixture())

    expect(after.blocks['m-two']).toEqual(['m-banned'])
    expect(after.reports).toHaveLength(1)
    expect(after.reports[0].messageId).toBe('msg-3')
  })

  it('every stored message still resolves to a channel that exists', () => {
    const after = migrateState(v0Fixture())

    for (const message of after.messages) {
      expect(after.channels[message.channel], message.channel).toBeDefined()
    }
  })

  it('carries all seven shipped channels across with their slugs unchanged', () => {
    const after = migrateState(v0Fixture())

    for (const legacy of LEGACY_CHANNELS) {
      const channel = after.channels[legacy.slug]
      expect(channel, legacy.slug).toBeDefined()
      expect(channel.name).toBe(legacy.name)
      expect(channel.description).toBe(legacy.description)
      expect(channel.extras).toEqual(legacy.extras)
    }
  })

  it('adds the new channels alongside rather than in place of the old ones', () => {
    const after = migrateState(v0Fixture())

    for (const slug of ['general', 'announcements', 'ai', 'technology',
                        'cloud', 'networking', 'support', 'random']) {
      expect(after.channels[slug], slug).toBeDefined()
    }
    expect(after.channels['bible-study']).toBeDefined()
  })

  it('files every channel under a category that exists', () => {
    const after = migrateState(v0Fixture())

    for (const channel of Object.values(after.channels)) {
      expect(after.categories[channel.categoryId], channel.slug).toBeDefined()
    }
  })

  it('marks announcements as an announcement channel', () => {
    const after = migrateState(v0Fixture())
    expect(after.channels['announcements'].type).toBe('announcement')
  })

  it('creates the default roles', () => {
    const after = migrateState(v0Fixture())

    expect(after.roles['owner']).toBeDefined()
    expect(after.roles['moderator']).toBeDefined()
    expect(after.roles['member']).toBeDefined()
  })

  it('promotes the legacy isAdmin member to moderator, not to owner', () => {
    const after = migrateState(v0Fixture())

    // Ownership is proved by a verified email, never inherited from a local
    // flag that only meant "installed this copy first".
    expect(after.memberRoles['m-owner']).toContain('moderator')
    expect(after.memberRoles['m-owner'] ?? []).not.toContain('owner')
    expect(after.ownership).toBeNull()
  })

  it('leaves ordinary members on the default role only', () => {
    const after = migrateState(v0Fixture())
    expect(after.memberRoles['m-two'] ?? []).not.toContain('moderator')
  })

  it('stamps the schema version', () => {
    expect(migrateState(v0Fixture()).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('is idempotent — migrating an already-migrated state changes nothing', () => {
    const once = migrateState(v0Fixture())
    const twice = migrateState(JSON.parse(JSON.stringify(once)))

    expect(twice).toEqual(once)
  })

  it('does not resurrect channels the owner has since deleted', () => {
    const once = migrateState(v0Fixture())
    delete once.channels['sports']

    const twice = migrateState(JSON.parse(JSON.stringify(once)))

    expect(twice.channels['sports']).toBeUndefined()
  })

  it('builds a usable state from nothing', () => {
    const fresh: CommunityState = migrateState({})

    expect(fresh.messages).toEqual([])
    expect(Object.keys(fresh.channels).length).toBeGreaterThan(0)
    expect(fresh.roles['member']).toBeDefined()
  })
})
