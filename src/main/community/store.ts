import {
  MAX_BODY_CHARS, MAX_ATTACHMENTS_PER_MESSAGE,
  MEMBER_COOLDOWN_MS, NEW_MEMBER_COOLDOWN_MS,
  type Attachment, type CommunityState, type Member, type Message, type MessageKind,
  type ModerationAction, type Report, type VerseRef,
} from '../../shared/community'
import { hasPermission, isOwner } from '../../shared/communityPermissions'
import { isTimedOut, inConversation } from './admin'
import { emptyState } from '../../shared/communityMigrate'

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

/**
 * The state shape moved to ../../shared/community when the renderer started
 * needing it — a channel editor cannot be written against a type it is not
 * allowed to import. Re-exported here so the dozens of existing call sites that
 * import it from the store keep working.
 */
export type { CommunityState, Report, ModerationAction }
export { emptyState }

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
  /** The message this one answers. Also decides which thread it lands in. */
  replyToId?: string
  attachments?: Attachment[]
}

/**
 * Who a message names.
 *
 * Handles are resolved to ids at post time rather than rendered from the text
 * later, so someone who changes their handle cannot retroactively become the
 * target of a mention that was aimed at whoever held the name before them.
 *
 * The pattern stops at the characters a handle cannot contain, which is what
 * lets "@Erick," and "@Erick's" resolve rather than silently missing.
 */
const MENTION_RE = /@([\p{L}\p{N}_-]{2,32})/gu

export function parseMentions(state: CommunityState, body: string): string[] {
  const out = new Set<string>()
  for (const match of String(body ?? '').matchAll(MENTION_RE)) {
    const wanted = match[1].toLowerCase()
    for (const member of Object.values(state.members)) {
      if (member.handle.toLowerCase() === wanted) { out.add(member.id); break }
    }
  }
  return [...out]
}

const EVERYONE_RE = /@everyone\b/i

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

  if (isTimedOut(state, input.memberId, now)) {
    const until = new Date(member.timeoutUntil!).toLocaleTimeString()
    return { ok: false, error: member.timeoutReason
      ? `You are timed out until ${until}: ${member.timeoutReason}`
      : `You are timed out until ${until}.` }
  }

  // Channels come from state now, not from a constant, because the owner can
  // create and archive them. An archived channel is read-only rather than gone,
  // so its history survives but nothing new lands in it.
  const channel = state.channels[input.channel]
  if (!channel) return { ok: false, error: 'That channel does not exist.' }
  if (channel.archivedAt) return { ok: false, error: `${channel.name} is archived.` }

  // A direct message is readable and writable by exactly two people, and the
  // check lives here rather than in the UI — a DM that depended on a component
  // not rendering it would not be private.
  if (!inConversation(state, input.channel, input.memberId)) {
    return { ok: false, error: 'That conversation is not yours.' }
  }

  if (!hasPermission(state, input.memberId, 'send_messages', input.channel)) {
    return { ok: false, error: `You do not have permission to post in ${channel.name}.` }
  }

  // A channel only accepts the kinds it advertises. Checked here rather than
  // trusted from the composer, which is renderer code.
  if (input.kind !== 'text' && !channel.extras.includes(input.kind)) {
    return { ok: false, error: `${channel.name} does not accept ${input.kind} posts.` }
  }

  const attachments = input.attachments ?? []
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.` }
  }
  if (attachments.length && !hasPermission(state, input.memberId, 'attach_files', input.channel)) {
    return { ok: false, error: `You cannot attach files in ${channel.name}.` }
  }

  const body = String(input.body ?? '').trim()
  // A picture with no caption is a message. Empty text plus nothing is not.
  if (!body && !attachments.length) return { ok: false, error: 'Write something first.' }
  if (body.length > MAX_BODY_CHARS) {
    return { ok: false, error: `Too long — ${MAX_BODY_CHARS} characters maximum.` }
  }

  // A reply must point at a live message in the same room, or the quoted stub
  // above it renders as a dangling reference to something the reader cannot open.
  let threadRootId: string | undefined
  if (input.replyToId) {
    const parent = state.messages.find(m => m.id === input.replyToId && !m.deletedAt)
    if (!parent) return { ok: false, error: 'That message is no longer here to reply to.' }
    if (parent.channel !== input.channel) {
      return { ok: false, error: 'That message is in another channel.' }
    }
    // Replying inside a thread stays in that thread. A thread is a room, not a
    // tree, and nesting produces conversations nobody can navigate back out of.
    threadRootId = parent.threadRootId ?? parent.id
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

  const mentions = parseMentions(state, body)
  const mentionsEveryone = EVERYONE_RE.test(body)
    && hasPermission(state, input.memberId, 'mention_everyone', input.channel)

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
    ...(input.replyToId ? { replyToId: input.replyToId } : {}),
    ...(threadRootId ? { threadRootId } : {}),
    ...(mentions.length ? { mentions } : {}),
    // Dropped rather than refused for someone who may not use it. Refusing
    // teaches people to probe the boundary; ignoring costs them nothing and
    // achieves nothing.
    ...(mentionsEveryone ? { mentionsEveryone: true } : {}),
    ...(attachments.length ? { attachments } : {}),
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
  limit = 50,
  beforeId?: string,
): Message[] {
  // Nothing, not a filtered list: a non-participant should not be able to learn
  // that a conversation has messages in it, let alone how many.
  if (!inConversation(state, channel, viewerId)) return []

  const blocked = new Set(state.blocks[viewerId] || [])
  let visible = state.messages.filter(m =>
    m.channel === channel && !m.deletedAt && !m.hiddenAt && !blocked.has(m.authorId)
    // Thread replies live in the thread panel. Leaving them inline as well
    // showed every answer twice and made the thread pointless.
    && !m.threadRootId)

  // Paging backwards from a cursor, because a chat log is read from its end.
  // The cursor is a message id rather than an offset: an offset shifts under
  // you the moment anyone posts while you are scrolling.
  if (beforeId) {
    const at = visible.findIndex(m => m.id === beforeId)
    if (at !== -1) visible = visible.slice(0, at)
  }
  return visible.slice(-limit)
}

/** One thread's replies, oldest first. The root is not included — the panel
 *  already renders it as the header. */
export function threadReplies(
  state: CommunityState, rootId: string, viewerId: string,
): Message[] {
  const blocked = new Set(state.blocks[viewerId] || [])
  return state.messages.filter(m =>
    m.threadRootId === rootId && !m.deletedAt && !m.hiddenAt && !blocked.has(m.authorId)
    && inConversation(state, m.channel, viewerId))
}

/** How many replies a thread has, for the "3 replies" affordance under a root. */
export function threadReplyCount(state: CommunityState, rootId: string): number {
  return state.messages.filter(m => m.threadRootId === rootId && !m.deletedAt && !m.hiddenAt).length
}

/**
 * Rewrite a message's body.
 *
 * The author, and nobody else — not a moderator, not the owner. Removing
 * someone's message is moderation; rewriting it leaves different words standing
 * under their name, which no permission in this design grants. A moderator who
 * disagrees with a message can delete it, and the audit log will say they did.
 *
 * The previous text is not kept. A chat message is not a document, and storing
 * every draft of every line would quietly build a permanent record of things
 * people chose to unsay.
 */
export function editMessage(
  state: CommunityState, messageId: string, actorId: string, body: string, now: number,
): ModerateResult {
  const message = state.messages.find(m => m.id === messageId)
  if (!message || message.deletedAt) return { ok: false, error: 'That message no longer exists.' }
  if (message.authorId !== actorId) return { ok: false, error: 'You can only edit your own messages.' }

  const clean = String(body ?? '').trim()
  if (!clean && !(message.attachments?.length)) return { ok: false, error: 'Write something first.' }
  if (clean.length > MAX_BODY_CHARS) {
    return { ok: false, error: `Too long — ${MAX_BODY_CHARS} characters maximum.` }
  }

  message.body = clean
  message.editedAt = now
  const mentions = parseMentions(state, clean)
  if (mentions.length) message.mentions = mentions
  else delete message.mentions
  return { ok: true }
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
 * One function so the answer is asked the same way everywhere — main
 * authorises every moderation call through it, and the renderer asks it before
 * drawing the Reports and AI-guide buttons.
 *
 * It used to read `member.isAdmin` and nothing else. Nothing ever sets that
 * flag: the community grew a real permission system (roles, `manage_messages`,
 * ownership) and this path was never moved onto it, so on an install where
 * nobody had claimed ownership the answer was permanently false and the owner
 * of the machine could not see their own report queue. Asking the permission
 * system is the fix; `isAdmin` is still honoured so anything that did set it
 * keeps working.
 *
 * The last clause is the one that matters for a fresh install. Claiming
 * ownership requires verifying an email, which a local-only community has no
 * reason to make anyone do — so when nobody has claimed it and there is
 * exactly one real person here, that person moderates their own room. The
 * count deliberately excludes bots and is deliberately strict: the moment a
 * second human appears (replication, an invite), moderation goes back to being
 * something that has to be granted rather than something everyone has.
 */
export function canModerate(state: CommunityState, memberId: string): boolean {
  const member = state.members[memberId]
  if (!member || member.bannedAt) return false
  if (member.isAdmin) return true
  if (isOwner(state, memberId)) return true
  if (hasPermission(state, memberId, 'manage_messages')) return true
  return isFounderOfUnclaimedCommunity(state, memberId)
}

/**
 * Nobody has claimed this community, and this is the person who started it.
 *
 * Claiming ownership means verifying an email through Google, which a
 * local-first community has no reason to make anyone do — so until somebody
 * does, the founder moderates. The founder is the earliest-joined human
 * member, which on a fresh install is simply "you".
 *
 * The first version of this rule asked whether the member was the ONLY person
 * here, and that was wrong in a way that only showed up once a community had
 * anybody in it: the owner of the room lost their own report queue the moment
 * a second person joined. Earliest-joined survives that, and it stays
 * deterministic across replicas because every copy of the state sees the same
 * join times — with the id as a tie-break so two members created in the same
 * millisecond cannot disagree between machines.
 *
 * Kept separate from canModerate so the rule can be read and tested on its
 * own: it is the one clause that grants a permission nobody handed out, and it
 * should be impossible to change by accident.
 */
export function isFounderOfUnclaimedCommunity(
  state: CommunityState, memberId: string,
): boolean {
  if (state.ownership) return false
  const people = Object.values(state.members || {}).filter(m => m && !m.isBot && !m.bannedAt)
  if (!people.length) return false
  const founder = people.reduce((earliest, m) =>
    (m.createdAt ?? 0) < (earliest.createdAt ?? 0) ||
    ((m.createdAt ?? 0) === (earliest.createdAt ?? 0) && m.id < earliest.id)
      ? m : earliest)
  return founder.id === memberId
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
