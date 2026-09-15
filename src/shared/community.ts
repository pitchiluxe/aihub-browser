/**
 * AIHub Community — shared vocabulary between the main process and the UI.
 *
 * Kept free of Electron and of Node built-ins so both sides can import it and
 * so the pure parts (handle rules, avatar generation, verse formatting) stay
 * unit-testable without a window or a socket.
 */

// ── Channels ───────────────────────────────────────────────────────────────

export interface ChannelDef {
  slug: string
  name: string
  /** One line, shown under the channel name in the rail and at the top of an
   *  empty room so a newcomer knows what belongs here. */
  description: string
  /** Lucide icon name; the renderer maps it to a component. */
  icon: string
  accent: string
  /**
   * Message kinds this channel accepts beyond plain text. A channel that does
   * not list 'verse' has no verse button — the composer is built from this,
   * rather than every channel getting every affordance and hiding most.
   */
  extras: MessageKind[]
}

/**
 * The rooms, in rail order.
 *
 * All of them ship. The launch risk is empty rooms, not code: a channel costs
 * one entry here, so the decision about how many to *open* is a flag flip
 * (`is_active`, once there is a server) rather than a build.
 */
export const CHANNELS: ChannelDef[] = [
  {
    slug: 'bible-study',
    name: 'Bible Study',
    description: 'Share verses, prayer requests and testimony.',
    icon: 'BookMarked',
    accent: '#fbbf24',
    extras: ['verse', 'prayer', 'testimony'],
  },
  {
    slug: 'developers',
    name: 'Developers & AI',
    description: 'Prompts, models, and what is actually working.',
    icon: 'Code2',
    accent: '#a78bfa',
    extras: ['code'],
  },
  {
    slug: 'cybersecurity',
    name: 'Cybersecurity',
    description: 'Defence, privacy and staying safe online.',
    icon: 'Shield',
    accent: '#38bdf8',
    extras: ['code'],
  },
  {
    slug: 'traders',
    name: 'Traders',
    description: 'Forex, crypto and the stock market.',
    icon: 'CandlestickChart',
    accent: '#34d399',
    extras: [],
  },
  {
    slug: 'sports',
    name: 'Sports',
    description: 'Matches, results and the arguments in between.',
    icon: 'Trophy',
    accent: '#fb923c',
    extras: [],
  },
  {
    slug: 'entertainment',
    name: 'Entertainment',
    description: 'Music, film, and what is worth your evening.',
    icon: 'Clapperboard',
    accent: '#f472b6',
    extras: [],
  },
  {
    slug: 'jobs',
    name: 'Jobs',
    description: 'Openings, referrals and hiring.',
    icon: 'Briefcase',
    accent: '#5eead4',
    extras: [],
  },
]

export function channelBySlug(slug: string): ChannelDef | undefined {
  return CHANNELS.find(c => c.slug === slug)
}

// ── Members and messages ───────────────────────────────────────────────────

export interface Member {
  id: string
  handle: string
  /** Case- and width-folded handle. Unique across the community; see
   *  handleKey() for what "the same name" means and what it misses. */
  handleKey: string
  /** Stable input to the generated avatar. Never an uploaded image. */
  avatarSeed: string
  createdAt: number
  /** Set by a moderator; a banned member can read but not post. */
  bannedAt?: number
  banReason?: string
  /**
   * Silenced until this moment. A timeout is the proportionate answer to a bad
   * afternoon, where a ban is the answer to a bad person — without it a
   * moderator's only options are to do nothing or to end someone's membership.
   */
  timeoutUntil?: number
  timeoutReason?: string
  /** Shown on the profile card. The member writes it; it is not private. */
  bio?: string
  /** May review reports, hide messages and ban members. Server-issued once
   *  there is a server; locally it is the owner of this install's own data. */
  isAdmin?: boolean
  /**
   * The community's own voice, not a person.
   *
   * One fixed id shared by every install (see communityBot), because the
   * guide's messages replicate like anyone else's — if each device minted its
   * own bot id the room would fill with several identical guides talking at
   * once. Only the owner's machine ever writes as it.
   */
  isBot?: boolean
}

/**
 * What a message *is*, which decides how it renders and which channels accept
 * it. One discriminated union beats one table per feature: a prayer request
 * and a verse card differ in presentation and in nothing else.
 */
export type MessageKind = 'text' | 'verse' | 'prayer' | 'testimony' | 'code'

export interface VerseRef {
  book: string
  chapter: number
  verse: number
  endVerse?: number
  /** Translation id as used by the Bible reader, e.g. 'kjv' or 'lsg'. */
  translation: string
}

export interface Message {
  id: string
  channel: string
  authorId: string
  authorHandle: string
  authorSeed: string
  kind: MessageKind
  body: string
  /** Present on kind 'verse' — lets the card deep-link into the Bible reader. */
  verse?: VerseRef
  /** Present on kind 'code' — drives syntax highlighting only. Never executed. */
  language?: string
  /** Posted without the author's handle attached. Prayer requests only. */
  anonymous?: boolean
  createdAt: number
  /** Set when the author rewrites the body. Rendered as an "(edited)" marker;
   *  the original is not kept, because a chat message is not a document. */
  editedAt?: number
  /** The message this one answers. Renders a quoted stub above the body. */
  replyToId?: string
  /**
   * The message that opened the thread this one belongs to.
   *
   * Separate from replyToId on purpose: a reply is a pointer at one message, a
   * thread is a room. Folding them together made every reply chain a thread and
   * every thread unrecoverable once its middle was deleted.
   */
  threadRootId?: string
  /** Member ids named with @. Resolved at post time, so a later handle change
   *  cannot silently re-target a mention at someone else. */
  mentions?: string[]
  /** Requires the mention_everyone permission; checked in the main process. */
  mentionsEveryone?: boolean
  /** Files stored under userData/community-files, never inline in this record. */
  attachments?: Attachment[]
  /** Member ids who reacted, by reaction. 'pray' is the only one so far. */
  reactions?: Record<string, string[]>
  /**
   * Withheld from the room pending moderator review, usually by the report
   * threshold. Distinct from deletedAt on purpose: hiding is provisional and
   * reversible, deletion is the moderator's verdict. Folding both into one
   * field left a moderator unable to tell an accusation from a decision, and
   * unable to put back something the room had merely piled onto.
   */
  hiddenAt?: number
  deletedAt?: number
  /** Who removed it, when a moderator did. Absent for an author's own delete. */
  deletedBy?: string
  /**
   * The room's opening message, written once when the channel is seeded.
   *
   * Marked so the seeder recognises its own work on a later launch and does
   * not post a second one. Keying off "written by the guide" alone would stop
   * the guide ever posting again; keying off a flag stored somewhere else
   * would drift out of step with the messages it claims to describe.
   */
  isWelcome?: boolean
}

// ── Limits ─────────────────────────────────────────────────────────────────

/**
 * Attachments, and the argument that was had about them.
 *
 * The original design banned uploads permanently, on the grounds that no file
 * ingress means no malware surface, no illegal-image surface, and no image
 * moderation to staff. That argument is entirely about *distribution* — a file
 * nobody else can fetch endangers nobody — and while this store is local there
 * is no distribution. So attachments are allowed, with the validation that
 * makes the ban re-imposable the moment a remote transport appears.
 *
 * The validation is not decoration. Type is decided by magic bytes, never the
 * extension; images are re-encoded rather than copied, which discards EXIF and
 * anything that failed to decode as an image; and files are served over a
 * dedicated protocol scoped to one directory rather than over file://.
 */
export const MAX_BODY_CHARS = 4000
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 10
export const MAX_HANDLE_CHARS = 24
export const MIN_HANDLE_CHARS = 3

/** New members post slowly until the account has some history behind it. */
export const NEW_MEMBER_COOLDOWN_MS = 30_000
export const MEMBER_COOLDOWN_MS = 3_000

// ── Attachments ────────────────────────────────────────────────────────────

export interface Attachment {
  id: string
  /** The name the user saw when they picked it. Display only — it never
   *  reaches the filesystem, so a name like "../../evil" is inert. */
  name: string
  /** Sniffed from the file's magic bytes, not from its extension. */
  mime: string
  bytes: number
  /** Content hash. Also the on-disk filename, which is why two people posting
   *  the same screenshot cost one file. */
  sha256: string
  width?: number
  height?: number
}

// ── Permissions ────────────────────────────────────────────────────────────

/**
 * Every distinct thing a member can be allowed to do.
 *
 * Declared here rather than in the permission module because channels and
 * roles both carry them, and a vocabulary that lives downstream of its own
 * consumers ends up duplicated.
 */
export type Permission =
  | 'send_messages'
  | 'attach_files'
  | 'add_reactions'
  | 'mention_everyone'
  | 'use_voice'
  | 'use_video'
  | 'screen_share'
  | 'manage_messages'
  | 'manage_members'
  | 'manage_channels'
  | 'manage_roles'
  | 'view_audit_log'

export const ALL_PERMISSIONS: Permission[] = [
  'send_messages', 'attach_files', 'add_reactions', 'mention_everyone',
  'use_voice', 'use_video', 'screen_share',
  'manage_messages', 'manage_members', 'manage_channels',
  'manage_roles', 'view_audit_log',
]

/** One role's exceptions in one channel. Denials win; see resolvePermissions. */
export interface PermissionOverride {
  allow?: Permission[]
  deny?: Permission[]
}

export interface Role {
  id: string
  name: string
  color: string
  /** Higher sorts higher in the member list and wins colour ties. */
  position: number
  permissions: Permission[]
  /** Built-in roles cannot be deleted; owner cannot be edited at all. */
  system?: boolean
}

// ── Channels and categories ────────────────────────────────────────────────

/**
 * A direct message is a channel too.
 *
 * The alternative was a parallel table with its own posting rules, its own
 * read state and its own moderation story. Making it a channel with a
 * participant list means edits, replies, threads, reactions, attachments,
 * search, unread counts and rate limits all work in a DM on the first day,
 * because they are the same code.
 */
export type ChannelType = 'text' | 'voice' | 'announcement' | 'dm'

export interface Category {
  id: string
  name: string
  position: number
}

/**
 * A channel, as stored.
 *
 * This is the same shape as the old ChannelDef plus the fields that only mean
 * something once the owner can manage channels. It keeps `slug` as its key so
 * every message already on disk still points at a channel that exists — the
 * single constraint that decided the whole migration.
 */
export interface Channel {
  slug: string
  name: string
  description: string
  icon: string
  accent: string
  extras: MessageKind[]
  categoryId: string
  position: number
  type: ChannelType
  /** The longer line shown in the channel header. Falls back to description. */
  topic?: string
  archivedAt?: number
  /** roleId -> exceptions in this channel. */
  overrides?: Record<string, PermissionOverride>
  /**
   * Present only on `dm` channels: exactly the members who may read or post.
   * Checked in the main process on every read and every write — a DM that
   * relied on the UI not to show it would not be private.
   */
  participants?: string[]
}

// ── Ownership, moderation, audit ───────────────────────────────────────────

/**
 * The Community Owner binding.
 *
 * `email` is whatever Google returned for the signed-in account, already
 * normalised. It is stored so the owner tools can show whose ownership this is,
 * and so a re-claim from a different address can be refused with a reason.
 */
export interface Ownership {
  memberId: string
  email: string
  verifiedAt: number
}

/** A moderator's verdict on a reported message. */
export type ModerationAction = 'keep' | 'remove' | 'ban'

export interface Report {
  id: string
  messageId: string
  reporterId: string
  reason: string
  createdAt: number
  /** What the moderator decided. Kept after resolution so the queue has a
   *  history and a banned member can be shown why. */
  resolvedAt?: number
  resolution?: ModerationAction
  resolvedBy?: string
}

export type AuditAction =
  | 'ownership.claimed'
  | 'channel.created' | 'channel.updated' | 'channel.deleted' | 'channel.reordered'
  | 'category.created' | 'category.updated' | 'category.deleted'
  | 'role.created' | 'role.updated' | 'role.deleted' | 'role.assigned' | 'role.revoked'
  | 'message.removed'
  | 'member.banned' | 'member.unbanned' | 'member.timeout'
  | 'report.resolved'

export interface AuditEntry {
  id: string
  actorId: string
  action: AuditAction
  targetType: 'channel' | 'category' | 'role' | 'member' | 'message' | 'community'
  targetId: string
  /** Small, human-readable, and safe to render: names and reasons, never keys. */
  meta?: Record<string, string | number | boolean>
  createdAt: number
}

// ── Notifications and read state ───────────────────────────────────────────

export type NotifLevel = 'all' | 'mentions' | 'none'

// ── Presence ───────────────────────────────────────────────────────────────

/**
 * Deliberately not part of CommunityState: presence is never persisted.
 *
 * A status that survives a restart is a lie — the app would report someone
 * online because of what was true when it last quit.
 */
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline'

export interface Presence {
  memberId: string
  status: PresenceStatus
  /** Channel slug, when they are in a voice room. */
  voiceChannel?: string
  updatedAt: number
}

// ── The persisted state ────────────────────────────────────────────────────

/**
 * Everything the community keeps on disk.
 *
 * Lives in shared rather than in the main process's store because the renderer
 * now needs the same vocabulary — a channel editor cannot be written against a
 * type it is not allowed to import.
 */
export interface CommunityState {
  schemaVersion: number
  members: Record<string, Member>
  messages: Message[]
  /** blockerId -> member ids they never want to see. */
  blocks: Record<string, string[]>
  reports: Report[]
  categories: Record<string, Category>
  channels: Record<string, Channel>
  roles: Record<string, Role>
  memberRoles: Record<string, string[]>
  /** memberId -> channel slug -> the createdAt of the last message they saw. */
  reads: Record<string, Record<string, number>>
  notifPrefs: Record<string, Record<string, NotifLevel>>
  auditLog: AuditEntry[]
  ownership: Ownership | null
}
