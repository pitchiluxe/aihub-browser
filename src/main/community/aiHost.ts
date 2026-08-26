import {
  BOT_MAX_CHARS, BOT_MIN_INTERVAL_MS, BOT_QUIET_BEFORE_MS, BOT_MEMBER_ID,
} from '../../shared/communityBot'
import type { CommunityState, Message } from '../../shared/community'

/**
 * Whether this machine speaks for the community, and what it says.
 *
 * Everything here is a pure function over state so the decisions can be
 * tested without an Ollama, a socket, or a clock. The module that actually
 * calls the model and writes the message is the thin part; this is the part
 * that decides whether it should.
 *
 * ── The rule that matters ─────────────────────────────────────────────────
 *
 * A local model plus a shared room is a duplication bug waiting to happen.
 * Only the owner's machine may post as the guide, and `shouldHost` is the one
 * place that is decided. Everywhere else asks this.
 */

export interface HostContext {
  /** This device's member id, or null before anyone has joined. */
  memberId: string | null
  /** Is that member an admin/owner of the community? */
  isAdmin: boolean
  /** Is Ollama reachable right now, with at least one model installed? */
  ollamaReady: boolean
  /**
   * Has a model actually been chosen?
   *
   * Distinct from ollamaReady on purpose. Ollama can be running with six
   * models pulled while the guide has been pointed at none of them, and in
   * that state every request returns null — so the panel was reporting
   * "Listening" for something that could never write a word.
   */
  hasModel: boolean
  /** Has the owner switched the guide on? Off by default — an AI that starts
   *  posting to a community without being asked is not a feature. */
  enabled: boolean
}

export function shouldHost(ctx: HostContext): boolean {
  return !!ctx.memberId && ctx.isAdmin && ctx.ollamaReady && ctx.hasModel && ctx.enabled
}

/** Why the guide is not running, phrased for the settings screen. */
export function hostBlocker(ctx: HostContext): string | null {
  if (!ctx.enabled) return 'The guide is switched off.'
  if (!ctx.memberId) return 'Join the community first.'
  if (!ctx.isAdmin) return 'Only the community owner runs the guide.'
  if (!ctx.ollamaReady) return 'Ollama is not running, or has no models installed.'
  if (!ctx.hasModel) return 'Choose a model for the guide to write with.'
  return null
}

// ── When to speak ──────────────────────────────────────────────────────────

export interface ChannelActivity {
  /** Newest message in the channel, whoever wrote it. */
  lastMessageAt: number | null
  /** Newest message the guide itself wrote here. */
  lastBotAt: number | null
  /** How many messages the channel holds at all. */
  total: number
}

export function activityFor(state: CommunityState, channel: string): ChannelActivity {
  let lastMessageAt: number | null = null
  let lastBotAt: number | null = null
  let total = 0
  for (const m of state.messages) {
    if (m.channel !== channel || m.deletedAt) continue
    total++
    if (lastMessageAt === null || m.createdAt > lastMessageAt) lastMessageAt = m.createdAt
    if (m.authorId === BOT_MEMBER_ID && (lastBotAt === null || m.createdAt > lastBotAt)) {
      lastBotAt = m.createdAt
    }
  }
  return { lastMessageAt, lastBotAt, total }
}

/**
 * May the guide post into this channel right now?
 *
 * Two independent brakes. The guide will not post twice within its interval,
 * and it will not post at all while people are talking — it exists to break
 * silence, and a bot that speaks into a live conversation is a bot that talks
 * over the room.
 */
export function mayPost(activity: ChannelActivity, now: number): boolean {
  if (activity.lastBotAt !== null && now - activity.lastBotAt < BOT_MIN_INTERVAL_MS) return false
  if (activity.lastMessageAt !== null && now - activity.lastMessageAt < BOT_QUIET_BEFORE_MS) return false
  return true
}

// ── What to say ────────────────────────────────────────────────────────────

export interface PromptInput {
  channelName: string
  channelDescription: string
  /** The tail of the conversation, oldest first. May be empty. */
  recent: Pick<Message, 'authorHandle' | 'body'>[]
}

/**
 * Build the prompt for a discussion starter.
 *
 * No web fetching: the guide writes from the model's own knowledge and from
 * what the room has been saying. That keeps the promise the app was built on
 * — nothing enters the community from outside the browser — and it removes a
 * whole class of failure where the guide cheerfully posts a dead link or
 * somebody else's paywalled article into a room you are responsible for.
 */
export function buildStarterPrompt(input: PromptInput): string {
  const history = input.recent.length
    ? input.recent.map(m => `${m.authorHandle}: ${oneLine(m.body)}`).join('\n')
    : '(nobody has posted here yet)'

  return [
    `You write short discussion starters for a channel called "${input.channelName}".`,
    `The channel is for: ${input.channelDescription}`,
    '',
    'Recent messages, oldest first:',
    history,
    '',
    'Write ONE short post that gives the room something to talk about.',
    'Rules:',
    '- Under 120 words. Plain sentences. No headings, no bullet lists.',
    '- Do not greet the channel or introduce yourself. Say the thing.',
    '- Do not invent news, statistics, links, or quotes. You have no internet access.',
    '- End with one genuine question somebody could answer from experience.',
    '- Never claim to be a person. You are the community guide.',
    'Reply with the post only.',
  ].join('\n')
}

function oneLine(body: string): string {
  return String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
}

/**
 * Clean up what the model returned, or reject it.
 *
 * Small models wrap answers in preambles, quotation marks and markdown
 * fences, and a guide that posts `Sure! Here is a discussion starter:` reads
 * as broken rather than as helpful. Anything that survives this is postable;
 * anything that does not is dropped silently and tried again next cycle,
 * because a room is better off quiet than filled with model noise.
 */
export function cleanStarter(raw: string): string | null {
  let text = String(raw ?? '').trim()
  if (!text) return null

  // Strip a ```fence``` the model wrapped the whole answer in.
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i)
  if (fenced) text = fenced[1].trim()

  // Drop a leading "Sure, here's ...:" line, but only when a real post follows.
  const lines = text.split('\n')
  if (lines.length > 1 && /^(sure|certainly|of course|here'?s|here is)\b/i.test(lines[0].trim())) {
    text = lines.slice(1).join('\n').trim()
  }

  // Unwrap matching quotes around the entire answer.
  if (/^"[\s\S]+"$/.test(text) || /^'[\s\S]+'$/.test(text)) text = text.slice(1, -1).trim()

  // A model that starts talking about itself has lost the thread.
  if (/^(as an ai|i am an ai|i'?m an ai|i cannot|i can'?t)\b/i.test(text)) return null

  if (text.length < 40) return null
  if (text.length > BOT_MAX_CHARS) {
    // Cut at a sentence end rather than mid-word, and only keep it if the
    // trimmed version is still a real post.
    const cut = text.slice(0, BOT_MAX_CHARS)
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    text = stop > 200 ? cut.slice(0, stop + 1) : cut.trim()
  }
  return text
}
