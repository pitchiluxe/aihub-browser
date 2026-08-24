import {
  MAX_BODY_CHARS, MEMBER_COOLDOWN_MS, NEW_MEMBER_COOLDOWN_MS,
  channelBySlug, type Member, type Message, type MessageKind, type VerseRef,
} from '../../shared/community'

/**
 * AIHub Community — the room's rules, as pure functions over a state object.
 *
 * Every decision that governs what may be posted lives here rather than in the
 * IPC handler or the UI, for two reasons. It is testable without a socket or a
 * window; and when the Supabase backend replaces the local one, these are the
 * rules that become row-level security policies and a Postgres trigger. A rule
 * enforced only in the renderer is not a rule — it is a suggestion to whoever
 * has DevTools open.
 */

export interface Report {
  id: string
  messageId: string
  reporterId: string
  reason: string
  createdAt: number
  resolvedAt?: number
  /** What the moderator decided. Kept after resolution so the queue has a
   *  history and a banned member can be shown why. */
  resolution?: ModerationAction
  resolvedBy?: string
}

/** A moderator's verdict on a reported message. */
export type ModerationAction = 'keep' | 'remove' | 'ban'

export interface CommunityState {
  members: Record<string, Member>
  messages: Message[]
  /** blockerId -> member ids they never want to see. */
  blocks: Record<string, string[]>
  reports: Report[]
}

export function emptyState(): CommunityState {
  return { members: {}, messages: [], blocks: {}, reports: [] }
}

/**
 * The member holding a handle, if anyone does.
 *
 * `exceptId` lets a member keep their own name when they change something else
 * about it — renaming "Grace" to "grace" must not collide with themselves.
 */
export function memberByHandle(
  state: CommunityState, key: string, exceptId?: string,
): Member | undefined {
  return Object.values(state.members)
    .find(m => m.handleKey === key && m.id !== exceptId)
}

export function isHandleTaken(state: CommunityState, key: string, exceptId?: string): boolean {
  return !!memberByHandle(state, key, exceptId)
}

/**
 * Names to offer when the one someone wants is gone.
 *
 * Numeric suffixes, because they are the suggestion people already understand
 * from every other signup form, and because anything cleverer produces names
 * the user did not ask for and will not recognise as theirs.
 */
export function suggestHandles(
  state: CommunityState, wanted: string, count = 3,
): string[] {
  const out: string[] = []
  for (let n = 2; out.length < count && n < 100; n++) {
    const candidate = `${wanted}${n}`
    if (!isHandleTaken(state, candidate.toLowerCase())) out.push(candidate)
  }
  return out
}

// ── Trust ──────────────────────────────────────────────────────────────────

/**
 * A member is "established" after a day and ten messages.
 *
 * The pair matters: time alone is beaten by registering early and waiting,
 * message count alone is beaten by posting ten times in ten seconds. Together
 * they cost an attacker a day per identity, which is the entire point — a ban
 * that costs nothing to evade is not a ban.
 */
export const ESTABLISHED_AFTER_MS = 24 * 60 * 60 * 1000
export const ESTABLISHED_AFTER_MESSAGES = 10

export function isEstablished(state: CommunityState, memberId: string, now: number): boolean {
  const member = state.members[memberId]
  if (!member) return false
  if (now - member.createdAt < ESTABLISHED_AFTER_MS) return false
  const posted = state.messages.filter(m => m.authorId === memberId).length
  return posted >= ESTABLISHED_AFTER_MESSAGES
}

/** New members wait 30s between posts, established members 3s. */
export function cooldownFor(state: CommunityState, memberId: string, now: number): number {
  return isEstablished(state, memberId, now) ? MEMBER_COOLDOWN_MS : NEW_MEMBER_COOLDOWN_MS
}

/** Links are the payload of nearly all drive-by spam, so new accounts cannot
 *  post them at all. Established members can. */
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+/i

// ── Posting ────────────────────────────────────────────────────────────────

export interface PostInput {
  memberId: string
  channel: string
  kind: MessageKind
  body: string
  verse?: VerseRef
  language?: string
  anonymous?: boolean
}

export type PostResult =
  | { ok: true; message: Message }
  | { ok: false; error: string; retryAfterMs?: number }

/**
 * Apply every posting rule and, if they all pass, append the message.
 *
 * Mutates `state` — it is the caller's persisted object, and copying the whole
 * message list on every post would be the expensive way to achieve nothing.
 */
export function postMessage(
  state: CommunityState,
  input: PostInput,
  now: number,
  newId: () => string,
): PostResult {
  const member = state.members[input.memberId]
  if (!member) return { ok: false, error: 'Join the community before posting.' }
  if (member.bannedAt) {
    return { ok: false, error: member.banReason
      ? `You cannot post: ${member.banReason}`
      : 'You cannot post in this community.' }
  }

  const channel = channelBySlug(input.channel)
  if (!channel) return { ok: false, error: 'That channel does not exist.' }

  // A channel only accepts the kinds it advertises. Checked here rather than
  // trusted from the composer, which is renderer code.
  if (input.kind !== 'text' && !channel.extras.includes(input.kind)) {
    return { ok: false, error: `${channel.name} does not accept ${input.kind} posts.` }
  }

  const body = String(input.body ?? '').trim()
  if (!body) return { ok: false, error: 'Write something first.' }
  if (body.length > MAX_BODY_CHARS) {
    return { ok: false, error: `Too long — ${MAX_BODY_CHARS} characters maximum.` }
  }

  const established = isEstablished(state, input.memberId, now)
  if (!established && LINK_RE.test(body)) {
    return { ok: false, error: 'New members cannot post links yet. Post a few times first.' }
  }

  const last = lastPostAt(state, input.memberId)
  const cooldown = cooldownFor(state, input.memberId, now)
  if (last !== null && now - last < cooldown) {
    const retryAfterMs = cooldown - (now - last)
    return {
      ok: false,
      error: established
        ? 'Slow down a moment.'
        : 'New members post once every 30 seconds. This lifts once you have been here a day.',
      retryAfterMs,
    }
  }

  const message: Message = {
    id: newId(),
    channel: input.channel,
    authorId: input.memberId,
    // Denormalized on purpose: a message must still render correctly after the
    // author changes their handle, and a room should not need a join per line.
    authorHandle: member.handle,
    authorSeed: member.avatarSeed,
    kind: input.kind,
    body,
    createdAt: now,
    ...(input.verse ? { verse: input.verse } : {}),
    ...(input.language ? { language: input.language } : {}),
    // Only prayer requests may be anonymous. Anonymity everywhere else removes
    // the accountability that makes a small room civil.
    ...(input.anonymous && input.kind === 'prayer' ? { anonymous: true } : {}),
  }
  state.messages.push(message)
  return { ok: true, message }
}

export function lastPostAt(state: CommunityState, memberId: string): number | null {
  let latest: number | null = null
  for (const m of state.messages) {
    if (m.authorId === memberId && (latest === null || m.createdAt > latest)) latest = m.createdAt
  }
  return latest
}

// ── Reading ────────────────────────────────────────────────────────────────

/**
 * What one viewer may see in one channel, oldest first.
 *
 * Blocking is applied on read rather than at post time: a block should hide
 * history too, and it must be reversible without having destroyed anything.
 */
export function visibleMessages(
  state: CommunityState,
  channel: string,
  viewerId: string,
  limit = 200,
): Message[] {
  const blocked = new Set(state.blocks[viewerId] || [])
  const visible = state.messages.filter(m =>
    m.channel === channel && !m.deletedAt && !m.hiddenAt && !blocked.has(m.authorId))
  // Trim from the front: a room shows its most recent conversation, and the
  // rest is fetched by scrolling up.
  return visible.slice(-limit)
}

/** A prayer request's author is hidden from everyone except the author. */
export function forViewer(message: Message, viewerId: string): Message {
  if (!message.anonymous || message.authorId === viewerId) return message
  return { ...message, authorHandle: 'Anonymous', authorSeed: `anon:${message.id}` }
}

// ── Reactions, blocks, reports ─────────────────────────────────────────────

export function toggleReaction(
  state: CommunityState, messageId: string, memberId: string, reaction: string,
): Message | null {
  const message = state.messages.find(m => m.id === messageId && !m.deletedAt)
  if (!message) return null
  const reactions = message.reactions || (message.reactions = {})
  const list = reactions[reaction] || (reactions[reaction] = [])
  const at = list.indexOf(memberId)
  if (at === -1) list.push(memberId)
  else list.splice(at, 1)
  return message
}

export function setBlocked(
  state: CommunityState, blockerId: string, blockedId: string, blocked: boolean,
): void {
  // Blocking yourself would silently empty your own room.
  if (blockerId === blockedId) return
  const list = state.blocks[blockerId] || (state.blocks[blockerId] = [])
  const at = list.indexOf(blockedId)
  if (blocked && at === -1) list.push(blockedId)
  if (!blocked && at !== -1) list.splice(at, 1)
}

/** After this many distinct reports a message hides itself pending review, so
 *  abuse does not sit in the room waiting on one moderator to wake up. */
export const AUTO_HIDE_REPORTS = 3

export function reportMessage(
  state: CommunityState, messageId: string, reporterId: string, reason: string,
  now: number, newId: () => string,
): { ok: boolean; hidden: boolean } {
  const message = state.messages.find(m => m.id === messageId)
  if (!message) return { ok: false, hidden: false }
  // One report per person per message: otherwise one determined reporter can
  // hide anything they like.
  const already = state.reports.some(r => r.messageId === messageId && r.reporterId === reporterId)
  if (!already) {
    state.reports.push({
      id: newId(), messageId, reporterId, reason: String(reason || '').slice(0, 500), createdAt: now,
    })
  }
  const count = state.reports.filter(r => r.messageId === messageId).length
  const hidden = count >= AUTO_HIDE_REPORTS
  // Hidden, not deleted. The room stops seeing it immediately; the moderator
  // still can, and can put it back. A pile-on must not be able to destroy
  // anything on its own.
  if (hidden && !message.hiddenAt) message.hiddenAt = now
  return { ok: true, hidden }
}

// -- Moderation -------------------------------------------------------------

/**
 * May this member act on other people's messages?
 *
 * One function so the answer is asked the same way everywhere. While the
 * community is local-only every install owns its own data, so this is true for
 * the local member; when the server exists the flag arrives from it and these
 * call sites do not change.
 */
export function canModerate(state: CommunityState, memberId: string): boolean {
  return !!state.members[memberId]?.isAdmin
}

export interface ReportedMessage {
  message: Message
  reports: Report[]
  count: number
  hidden: boolean
}

/**
 * The review queue: every message with unresolved reports, worst first.
 *
 * Sorted by report count rather than by age. A moderator with ten minutes
 * should spend them on the message twelve people flagged, not the oldest one.
 */
export function openReports(state: CommunityState): ReportedMessage[] {
  const byMessage = new Map<string, Report[]>()
  for (const r of state.reports) {
    if (r.resolvedAt) continue
    const list = byMessage.get(r.messageId) || []
    list.push(r)
    byMessage.set(r.messageId, list)
  }

  const out: ReportedMessage[] = []
  for (const [messageId, reports] of byMessage) {
    const message = state.messages.find(m => m.id === messageId)
    // A message erased with its author leaves reports behind; skip them rather
    // than drawing a queue row with nothing in it.
    if (!message) continue
    out.push({ message, reports, count: reports.length, hidden: !!message.hiddenAt })
  }
  return out.sort((a, b) => b.count - a.count || a.message.createdAt - b.message.createdAt)
}

export type ModerateResult = { ok: true } | { ok: false; error: string }

/**
 * Settle every open report on a message.
 *
 * 'keep' un-hides it and clears the queue - the room was wrong. 'remove'
 * deletes the message. 'ban' deletes it and stops the author posting. All
 * three resolve the reports, so a decision cannot be re-litigated by the same
 * reports surfacing again tomorrow.
 */
export function resolveReports(
  state: CommunityState,
  messageId: string,
  action: ModerationAction,
  moderatorId: string,
  now: number,
  reason = '',
): ModerateResult {
  if (!canModerate(state, moderatorId)) return { ok: false, error: 'Not a moderator.' }
  const message = state.messages.find(m => m.id === messageId)
  if (!message) return { ok: false, error: 'That message no longer exists.' }

  if (action === 'keep') {
    delete message.hiddenAt
  } else {
    message.hiddenAt ??= now
    message.deletedAt ??= now
    message.deletedBy = moderatorId
    if (action === 'ban') {
      const author = state.members[message.authorId]
      // Banning yourself would lock the only moderator out of the room.
      if (author && author.id !== moderatorId) {
        author.bannedAt = now
        author.banReason = String(reason || '').slice(0, 200) || 'Repeated reports.'
      }
    }
  }

  for (const r of state.reports) {
    if (r.messageId === messageId && !r.resolvedAt) {
      r.resolvedAt = now
      r.resolution = action
      r.resolvedBy = moderatorId
    }
  }
  return { ok: true }
}

export function setBanned(
  state: CommunityState, moderatorId: string, targetId: string,
  banned: boolean, reason: string, now: number,
): ModerateResult {
  if (!canModerate(state, moderatorId)) return { ok: false, error: 'Not a moderator.' }
  if (moderatorId === targetId) return { ok: false, error: 'You cannot ban yourself.' }
  const target = state.members[targetId]
  if (!target) return { ok: false, error: 'No such member.' }

  if (banned) {
    target.bannedAt = now
    target.banReason = String(reason || '').slice(0, 200) || 'Community guidelines.'
  } else {
    delete target.bannedAt
    delete target.banReason
  }
  return { ok: true }
}

/**
 * Remove one message. The author may remove their own; a moderator may remove
 * anyone's. Soft, so a mistaken removal is still recoverable from the file.
 */
export function deleteMessage(
  state: CommunityState, messageId: string, actorId: string, now: number,
): ModerateResult {
  const message = state.messages.find(m => m.id === messageId)
  if (!message) return { ok: false, error: 'That message no longer exists.' }
  const own = message.authorId === actorId
  if (!own && !canModerate(state, actorId)) return { ok: false, error: 'Not yours to delete.' }
  message.deletedAt ??= now
  if (!own) message.deletedBy = actorId
  return { ok: true }
}

/**
 * Erase a member and everything they wrote.
 *
 * This is the delete-my-data path, so it is a real deletion rather than a
 * flag: the messages go, the reactions they left go, the reports they filed
 * go, and the member row goes.
 *
 * Returns what was removed, because a screen that says "deleted" without
 * saying how much is asking to be distrusted.
 */
export function eraseMember(
  state: CommunityState, memberId: string,
): { messages: number; reactions: number; reports: number } {
  const messages = state.messages.filter(m => m.authorId === memberId).length
  state.messages = state.messages.filter(m => m.authorId !== memberId)

  let reactions = 0
  for (const message of state.messages) {
    if (!message.reactions) continue
    for (const [kind, list] of Object.entries(message.reactions)) {
      const at = list.indexOf(memberId)
      if (at !== -1) { list.splice(at, 1); reactions++ }
      if (!list.length) delete message.reactions[kind]
    }
  }

  const liveMessageIds = new Set(state.messages.map(m => m.id))
  const reports = state.reports.filter(r =>
    r.reporterId === memberId || !liveMessageIds.has(r.messageId)).length
  state.reports = state.reports.filter(r =>
    r.reporterId !== memberId && liveMessageIds.has(r.messageId))

  delete state.members[memberId]
  delete state.blocks[memberId]
  for (const list of Object.values(state.blocks)) {
    const at = list.indexOf(memberId)
    if (at !== -1) list.splice(at, 1)
  }

  return { messages, reactions, reports }
}
