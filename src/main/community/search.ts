import type { Channel, CommunityState, Member, Message } from '../../shared/community'
import { forViewer } from './store'
import { inConversation } from './admin'

/**
 * Search across messages, members and channels.
 *
 * Deliberately built on `indexOf` rather than a regex. Everything typed into a
 * search box is a search term, including `40%`, `(roughly)` and `c++` — the
 * moment the query becomes a pattern, a user asking a normal question gets
 * either a crash or silently wrong results. Escaping the input would work too,
 * but not needing to escape it is better.
 *
 * There is no index. A local community's whole history is a few thousand rows
 * in memory, and a linear scan over that is faster than maintaining an
 * inverted index would be — the debounce in the UI matters far more than the
 * scan does. If a server ever backs this, the query moves into the database
 * and this function becomes its fallback.
 */

export interface MessageHit {
  message: Message
  /** The channel's display name, so a result can be rendered without a lookup. */
  channelName: string
  /** Already folded for anonymity — never the real handle behind a prayer. */
  authorHandle: string
}

export interface SearchOptions {
  channel?: string
  authorId?: string
  limit?: number
}

export interface SearchResults {
  messages: MessageHit[]
  members: Member[]
  channels: Channel[]
}

export const SEARCH_LIMIT = 50

/** Every word must appear. Matching *any* word turns a specific search into
 *  the whole channel, which is the opposite of what was asked for. */
function matchesAll(haystack: string, terms: string[]): boolean {
  const lower = haystack.toLowerCase()
  return terms.every(term => lower.includes(term))
}

export function searchCommunity(
  state: CommunityState,
  viewerId: string,
  query: string,
  options: SearchOptions = {},
): SearchResults {
  const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return { messages: [], members: [], channels: [] }

  const limit = Math.min(Math.max(1, Number(options.limit) || SEARCH_LIMIT), SEARCH_LIMIT)
  const blocked = new Set(state.blocks[viewerId] || [])

  const messages: MessageHit[] = []
  // Backwards, because the answer is nearly always recent and stopping early
  // saves scanning years of history to throw it away at the sort.
  for (let i = state.messages.length - 1; i >= 0 && messages.length < limit; i--) {
    const message = state.messages[i]
    if (message.deletedAt || message.hiddenAt) continue
    if (blocked.has(message.authorId)) continue
    // Someone else's direct messages are not searchable, in the same way they
    // are not readable — the check is the same one the read path uses.
    if (!inConversation(state, message.channel, viewerId)) continue
    if (options.channel && message.channel !== options.channel) continue
    if (options.authorId && message.authorId !== options.authorId) continue
    if (!matchesAll(message.body, terms)) continue

    const visible = forViewer(message, viewerId)
    messages.push({
      message: visible,
      channelName: state.channels[message.channel]?.name ?? message.channel,
      authorHandle: visible.authorHandle,
    })
  }

  const members = Object.values(state.members)
    .filter(m => matchesAll(m.handle, terms))
    .slice(0, limit)

  const channels = Object.values(state.channels)
    .filter(c => !c.archivedAt && c.type !== 'dm')
    .filter(c => matchesAll(`${c.name} ${c.description} ${c.topic ?? ''}`, terms))
    .slice(0, limit)

  return { messages, members, channels }
}
