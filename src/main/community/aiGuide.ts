import { seedChannels } from '../../shared/communityChannels'
import { WELCOME_MESSAGES } from '../../shared/communityWelcome'
import { BOT_HANDLE, BOT_MEMBER_ID } from '../../shared/communityBot'
import type { CommunityState, Message } from '../../shared/community'
import { activityFor, buildStarterPrompt, cleanStarter, mayPost, shouldHost, type HostContext } from './aiHost'
import { buildModerationPrompt, parseVerdict, reportReason, shouldFile } from './aiModerator'

/**
 * The guide, running.
 *
 * The decisions live in aiHost and aiModerator, which are pure and tested.
 * This is the part that talks to Ollama and writes into state — kept thin on
 * purpose, because it is the part that cannot be tested without a model.
 */

export interface GuideDeps {
  readState: () => CommunityState
  updateState: (mutate: (state: CommunityState) => void) => void
  /** Ask Ollama for one completion. Returns null if it could not answer. */
  ask: (prompt: string, opts?: { timeoutMs?: number }) => Promise<string | null>
  context: () => HostContext
  newId: () => string
  now?: () => number
  /** Push a message the same way a human one goes out, so it replicates. */
  publish: (message: Message) => void
  /** File a report through the existing store rules. */
  file: (messageId: string, reason: string) => void
  /** Get the most recent messages in a channel, up to limit. */
  recentMessages: (channel: string, limit?: number) => Message[]
}

const now = (d: GuideDeps) => (d.now ?? Date.now)()

/**
 * Make sure the community has a guide and every room has an opening message.
 *
 * Idempotent, and safe to call on every launch: the welcome for a channel is
 * written once and never again, keyed on the channel having no welcome rather
 * than on a flag somewhere that could drift out of step with the messages.
 */
export function ensureBotAndWelcome(deps: GuideDeps): number {
  const at = now(deps)
  let written = 0

  deps.updateState(state => {
    state.members[BOT_MEMBER_ID] ||= {
      id: BOT_MEMBER_ID,
      handle: BOT_HANDLE,
      handleKey: BOT_HANDLE.toLowerCase(),
      avatarSeed: BOT_MEMBER_ID,
      createdAt: at,
      isBot: true,
    }

    for (const welcome of WELCOME_MESSAGES) {
      const already = state.messages.some(
        m => m.channel === welcome.channel && m.authorId === BOT_MEMBER_ID && m.isWelcome,
      )
      if (already) continue

      const message: Message = {
        id: deps.newId(),
        channel: welcome.channel,
        authorId: BOT_MEMBER_ID,
        authorHandle: BOT_HANDLE,
        authorSeed: BOT_MEMBER_ID,
        kind: 'text',
        body: welcome.body,
        // Marked so this function recognises its own work on a later launch
        // and does not open the room a second time.
        isWelcome: true,
        createdAt: at,
      }
      state.messages.push(message)
      written++
    }
  })

  return written
}

/**
 * One pass over the rooms, posting where the room has gone quiet.
 *
 * Returns the channels it posted into, which is what the caller logs. A cycle
 * that posts nothing is the normal case and not worth reporting.
 */
export async function runGuideCycle(deps: GuideDeps): Promise<string[]> {
  const ctx = deps.context()
  if (!shouldHost(ctx)) return []

  const posted: string[] = []
  const at = now(deps)

  for (const channel of seedChannels()) {
    // Announcements is the owner's voice, not the guide's; voice rooms have
    // no transcript to prompt from.
    if (channel.slug === 'announcements' || channel.type === 'voice') continue

    const state = deps.readState()
    if (!mayPost(activityFor(state, channel.slug), at)) continue

    const recent = state.messages
      .filter(m => m.channel === channel.slug && !m.deletedAt)
      .slice(-8)
      .map(m => ({ authorHandle: m.authorHandle, body: m.body }))

    const raw = await deps.ask(buildStarterPrompt({
      channelName: channel.name,
      channelDescription: channel.description,
      recent,
    }), { timeoutMs: 120_000 })

    const body = raw ? cleanStarter(raw) : null
    // A room is better off quiet than filled with model noise, so a rejected
    // answer is simply skipped and tried again next cycle.
    if (!body) continue

    const message: Message = {
      id: deps.newId(),
      channel: channel.slug,
      authorId: BOT_MEMBER_ID,
      authorHandle: BOT_HANDLE,
      authorSeed: BOT_MEMBER_ID,
      kind: 'text',
      body,
      createdAt: now(deps),
    }

    deps.updateState(state => { state.messages.push(message) })
    deps.publish(message)
    posted.push(channel.slug)
  }

  return posted
}

/**
 * Read one message and file a report if it needs a human.
 *
 * Never hides, never deletes, never bans. See aiModerator for why: the model
 * is whatever the owner happens to have pulled, its verdicts are not
 * reproducible, and a false positive would silence a real person in a room
 * where somebody may have just posted something painful.
 */
export async function reviewMessage(deps: GuideDeps, message: Message): Promise<boolean> {
  const ctx = deps.context()
  if (!shouldHost(ctx)) return false
  // The guide does not review itself, and there is no point reviewing a
  // message that is already gone.
  if (message.authorId === BOT_MEMBER_ID || message.deletedAt) return false

  const channel = seedChannels().find(c => c.slug === message.channel)
  const raw = await deps.ask(buildModerationPrompt({
    channelName: channel?.name ?? message.channel,
    authorHandle: message.authorHandle,
    body: message.body,
  }), { timeoutMs: 60_000 })
  if (!raw) return false

  const verdict = parseVerdict(raw)
  if (!shouldFile(verdict)) return false

  deps.file(message.id, reportReason(verdict))
  return true
}

/** Check if a message is @mentioning the guide and generate a response. */
export async function reviewMention(deps: GuideDeps, message: Message): Promise<boolean> {
  const ctx = deps.context()
  if (!shouldHost(ctx)) return false
  if (message.authorId === BOT_MEMBER_ID || message.deletedAt) return false

  // Only respond if the message mentions the guide.
  const body = message.body || ''
  const mentionPattern = /@AIHub\s*Guide/i
  if (!mentionPattern.test(body)) return false

  const channel = seedChannels().find(c => c.slug === message.channel)
  const channelName = channel?.name ?? message.channel
  const channelDesc = channel?.description ?? channelName

  // Build context: last few messages in this channel.
  const recent = deps.recentMessages(message.channel, 8)
    .filter(m => !m.deletedAt)
    .slice(0, 6)
    .map(m => ({ authorHandle: m.authorHandle, body: m.body }))

  const question = body.replace(mentionPattern, '').trim() || 'Hello! What can you tell me about this community?'

  const raw = await deps.ask(buildMentionPrompt({
    channelName,
    channelDescription: channelDesc,
    authorHandle: message.authorHandle,
    question,
    recent,
  }), { timeoutMs: 90_000 })

  const answer = raw ? cleanMention(raw) : null
  if (!answer) return false

  const reply: Message = {
    id: deps.newId(),
    channel: message.channel,
    authorId: BOT_MEMBER_ID,
    authorHandle: BOT_HANDLE,
    authorSeed: BOT_MEMBER_ID,
    kind: 'text',
    body: answer,
    createdAt: now(deps),
  }

  deps.updateState(state => { state.messages.push(reply) })
  deps.publish(reply)
  return true
}

interface MentionInput {
  channelName: string
  channelDescription: string
  authorHandle: string
  question: string
  recent: { authorHandle: string; body: string }[]
}

function buildMentionPrompt(input: MentionInput): string {
  const history = input.recent.length
    ? input.recent.map(m => `${m.authorHandle}: ${(m.body || '').replace(/\s+/g, ' ').trim().slice(0, 200)}`).join('\n')
    : '(this is the first message in the channel)'

  return [
    `You are the AIHub community guide — friendly, knowledgeable, and always happy to help.`,
    `Someone just mentioned you in the "${input.channelName}" channel (about: ${input.channelDescription}).`,
    '',
    'The person asking:',
    `@${input.authorHandle}: ${input.question}`,
    '',
    'Recent conversation:',
    history,
    '',
    'Write a warm, helpful reply (under 80 words) that:',
    '- Uses 1-2 relevant emojis naturally',
    '- Answers the question directly if you can',
    '- Asks a follow-up question to keep the conversation going',
    '- Feels like a helpful friend, not a helpdesk',
    '- Never says "as an AI" or "I\'m just a bot"',
    'Reply with the reply only, no quoting or labelling.',
  ].join('\n')
}

function cleanMention(raw: string): string | null {
  let text = String(raw ?? '').trim()
  if (!text) return null

  // Strip fences.
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i)
  if (fenced) text = fenced[1].trim()

  // Drop a leading "Sure!" line.
  const lines = text.split('\n')
  if (lines.length > 1 && /^(sure|certainly|of course|here'?s|here is|absolutely)\b/i.test(lines[0].trim())) {
    text = lines.slice(1).join('\n').trim()
  }

  if (/^(as an ai|i am an ai|i'?m an ai|i cannot|i can'?t)\b/i.test(text)) return null
  if (text.length < 20) return null
  if (text.length > 600) {
    const cut = text.slice(0, 600)
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    text = stop > 100 ? cut.slice(0, stop + 1) : cut.trim()
  }
  return text
}
