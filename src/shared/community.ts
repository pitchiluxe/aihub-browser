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
  /** May review reports, hide messages and ban members. Server-issued once
   *  there is a server; locally it is the owner of this install's own data. */
  isAdmin?: boolean
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
}

// ── Limits ─────────────────────────────────────────────────────────────────

/**
 * Text only, permanently. No uploads, no images, no attachments.
 *
 * This is the single most valuable safety property in the design: with no file
 * ingress there is no malware surface, no illegal-image surface, and no image
 * moderation to staff. It also happens to be what the product asked for —
 * nothing enters the community from outside the browser.
 */
export const MAX_BODY_CHARS = 4000
export const MAX_HANDLE_CHARS = 24
export const MIN_HANDLE_CHARS = 3

/** New members post slowly until the account has some history behind it. */
export const NEW_MEMBER_COOLDOWN_MS = 30_000
export const MEMBER_COOLDOWN_MS = 3_000
