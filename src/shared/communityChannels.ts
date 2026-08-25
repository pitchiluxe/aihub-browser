import { CHANNELS, type ChannelDef, type Channel, type Category } from './community'
import { MEMBER_ROLE_ID } from './communityPermissions'

/**
 * The seed data a fresh — or a not-yet-migrated — community starts from.
 *
 * Channels used to be this file's `CHANNELS` constant and nothing else, which
 * meant the owner could not add one without a release. They are state now. What
 * is left here is only the *seed*: the rooms a community begins with, applied
 * once by the migration and never re-applied, so deleting a seeded channel
 * deletes it for good rather than for one restart.
 */

/**
 * Exactly the seven channels v1.53.0 shipped, still keyed by the same slugs.
 *
 * Every message already on disk carries one of these slugs in `message.channel`.
 * Renaming any of them would orphan real messages, so they are carried across
 * untouched and the new rooms are added alongside — which is also what was
 * asked for.
 */
export const LEGACY_CHANNELS: ChannelDef[] = CHANNELS

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'announcements', name: 'Announcements', position: 0 },
  { id: 'community',     name: 'Community',     position: 1 },
  { id: 'technology',    name: 'Technology',    position: 2 },
  { id: 'interests',     name: 'Interests',     position: 3 },
  { id: 'voice',         name: 'Voice',         position: 4 },
]

/** Where each of the seven shipped rooms belongs once there are categories. */
const LEGACY_CATEGORY: Record<string, string> = {
  'bible-study':   'interests',
  'developers':    'technology',
  'cybersecurity': 'technology',
  'traders':       'interests',
  'sports':        'interests',
  'entertainment': 'interests',
  'jobs':          'interests',
}

/**
 * The rooms the Discord-style build adds.
 *
 * `developers` already covers a lot of what `ai` and `technology` would, and
 * that overlap is deliberate: the existing room keeps its history and its name,
 * and the new ones start empty next to it rather than swallowing it.
 */
export const NEW_CHANNELS: Array<Omit<Channel, 'position'>> = [
  {
    slug: 'announcements', name: 'announcements', type: 'announcement',
    description: 'Platform updates, new features and important notices.',
    topic: 'Read-only for members. Posted by the community owner.',
    icon: 'Megaphone', accent: '#f59e0b', extras: [], categoryId: 'announcements',
    // "Announcement channel" is not a special code path — it is an ordinary
    // channel that denies posting to the baseline role. The owner keeps the
    // permission because the owner is exempt from overrides entirely, and a
    // moderator can be handed it back per channel without touching any code.
    overrides: { [MEMBER_ROLE_ID]: { deny: ['send_messages', 'attach_files'] } },
  },
  {
    slug: 'general', name: 'general', type: 'text',
    description: 'Everything that does not have a room of its own yet.',
    icon: 'Hash', accent: '#94a3b8', extras: [], categoryId: 'community',
  },
  {
    slug: 'support', name: 'support', type: 'text',
    description: 'Ask a question, get an answer.',
    icon: 'LifeBuoy', accent: '#22d3ee', extras: ['code'], categoryId: 'community',
  },
  {
    slug: 'random', name: 'random', type: 'text',
    description: 'Off-topic. The room where nothing has to be useful.',
    icon: 'Shuffle', accent: '#c084fc', extras: [], categoryId: 'community',
  },
  {
    slug: 'ai', name: 'ai', type: 'text',
    description: 'Models, prompts, agents and automation.',
    icon: 'Sparkles', accent: '#a78bfa', extras: ['code'], categoryId: 'technology',
  },
  {
    slug: 'technology', name: 'technology', type: 'text',
    description: 'Software, hardware and what is coming next.',
    icon: 'Cpu', accent: '#60a5fa', extras: ['code'], categoryId: 'technology',
  },
  {
    slug: 'cloud', name: 'cloud', type: 'text',
    description: 'AWS, Azure, GCP, DevOps and infrastructure.',
    icon: 'Cloud', accent: '#38bdf8', extras: ['code'], categoryId: 'technology',
  },
  {
    slug: 'networking', name: 'networking', type: 'text',
    description: 'CCNA, routing, switching and troubleshooting.',
    icon: 'Network', accent: '#2dd4bf', extras: ['code'], categoryId: 'technology',
  },
  {
    slug: 'voice-lounge', name: 'Lounge', type: 'voice',
    description: 'Drop in and talk.',
    icon: 'Volume2', accent: '#34d399', extras: [], categoryId: 'voice',
  },
  {
    slug: 'voice-workshop', name: 'Workshop', type: 'voice',
    description: 'Screen share and work through something together.',
    icon: 'MonitorPlay', accent: '#818cf8', extras: [], categoryId: 'voice',
  },
]

/**
 * The full seed set, legacy first, each stamped with its position.
 *
 * Position is per category and starts at zero so the sidebar can order without
 * re-deriving anything.
 */
export function seedChannels(): Channel[] {
  const out: Channel[] = []
  const nextPosition: Record<string, number> = {}
  const place = (categoryId: string) => (nextPosition[categoryId] = (nextPosition[categoryId] ?? -1) + 1)

  for (const legacy of LEGACY_CHANNELS) {
    const categoryId = LEGACY_CATEGORY[legacy.slug] ?? 'community'
    out.push({ ...legacy, categoryId, position: place(categoryId), type: 'text' })
  }
  for (const channel of NEW_CHANNELS) {
    out.push({ ...channel, position: place(channel.categoryId) })
  }
  return out
}
