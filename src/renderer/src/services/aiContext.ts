import type { AIMessage } from '../store/browserStore'

/**
 * AIHub Browser — what the assistant is allowed to remember, and what it can
 * afford to send.
 *
 * Two problems solved here, both of which make the assistant measurably
 * smarter rather than just wordier:
 *
 *  1. A long conversation silently destroys a local model. Ollama truncates
 *     from the FRONT of the prompt when the context window fills, so the
 *     system prompt — every instruction about tools and formatting — is the
 *     first thing thrown away. The assistant then "forgets how to be itself"
 *     mid-chat. So history is budgeted here: recent turns in full, older ones
 *     condensed, and the system prompt never at risk.
 *
 *  2. The browser already stores the text of every page the user has read
 *     (Rewind) and can search it by meaning. A question about something they
 *     read last week should be answered from that, not guessed at.
 */

/**
 * Rough token count. Deliberately an estimate: a real tokenizer would mean
 * shipping vocabulary files per model, and every decision here only needs to
 * know "roughly how big". ~3.6 chars/token matches English prose through
 * Llama and Qwen tokenizers closely enough to budget with.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.6)
}

export function messageTokens(message: AIMessage): number {
  // +4 for the role/turn scaffolding every chat format adds around content.
  return estimateTokens(message.content || '') + 4
}

export interface ContextPlan {
  /** Messages to send verbatim, oldest first. */
  kept: AIMessage[]
  /** Older messages that must be condensed into a summary line, oldest first. */
  condensed: AIMessage[]
  /** Estimated tokens of `kept`. */
  tokens: number
}

/**
 * Choose which turns survive into the prompt.
 *
 * Walks BACKWARDS from the newest message so the most recent exchange is
 * always present — a plan that drops the message being answered is worse than
 * no plan. The last user message is kept unconditionally, even if it alone
 * blows the budget, because sending a prompt without the question is useless.
 */
export function planContext(messages: AIMessage[], budgetTokens: number): ContextPlan {
  const list = (messages || []).filter(m => m && m.role !== 'system')
  if (!list.length) return { kept: [], condensed: [], tokens: 0 }

  const kept: AIMessage[] = []
  let tokens = 0
  let index = list.length - 1

  for (; index >= 0; index--) {
    const cost = messageTokens(list[index])
    // Always keep the newest message, whatever it costs.
    if (kept.length && tokens + cost > budgetTokens) break
    kept.unshift(list[index])
    tokens += cost
  }

  return { kept, condensed: list.slice(0, index + 1), tokens }
}

/**
 * One-line-per-turn digest of the dropped history, so the model still knows
 * what was discussed without paying for the full text.
 */
export function summarizeCondensed(messages: AIMessage[], maxChars = 900): string {
  if (!messages.length) return ''
  const lines = messages.map(m => {
    const who = m.role === 'user' ? 'User' : 'You'
    const text = (m.content || '').replace(/\s+/g, ' ').trim()
    return `- ${who}: ${text.length > 120 ? text.slice(0, 119) + '…' : text}`
  })

  // Keep the most recent of the dropped turns — they are the ones still likely
  // to be referred to ("the second option you listed").
  let out = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = lines[i] + (out ? '\n' + out : '')
    if (next.length > maxChars) break
    out = next
  }
  return out ? `\n\n### Earlier in this conversation\n${out}` : ''
}

/**
 * Questions that point at something the user has already read. These are the
 * cases where searching their own archive beats searching the web: the answer
 * is a page they have seen, and the web does not know which one.
 */
const RECALL_PATTERNS = [
  /\b(that|the)\s+(article|page|site|post|doc|documentation|thread|paper|guide|tutorial)\b/i,
  /\bi\s+(read|saw|found|was reading|looked at|visited|opened)\b/i,
  /\b(what|which)\s+(was|were)\s+that\b/i,
  /\b(earlier|yesterday|last (week|night|month)|the other day)\b.*\b(read|saw|page|site|article)\b/i,
  /\bwhere did i\b/i,
  /\bremind me\b.*\b(read|page|site|article)\b/i,
]

export function looksLikeRecall(question: string): boolean {
  const q = String(question || '')
  return RECALL_PATTERNS.some(re => re.test(q))
}

export interface RecallHit {
  title: string
  url: string
  snippet?: string
  ts?: number
  via?: 'semantic' | 'keyword'
}

/**
 * Render archive hits as prompt context. Every line carries its URL so the
 * answer can cite the actual page — an answer about something the user read
 * is only useful if they can get back to it.
 */
export function buildRecallBlock(hits: RecallHit[], limit = 5): string {
  const usable = (hits || []).filter(h => h && h.url).slice(0, limit)
  if (!usable.length) return ''
  const lines = usable.map(h => {
    const when = h.ts ? ` (${new Date(h.ts).toLocaleDateString()})` : ''
    const snippet = (h.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 180)
    return `- **${h.title || h.url}**${when} — ${h.url}${snippet ? `\n  > ${snippet}` : ''}`
  })
  return `\n\n### Pages the user has actually read that match this question\n${lines.join('\n')}\n` +
    '(From their own reading history, searched by meaning on this machine. ' +
    'Answer from these when they fit, and link the page you used. ' +
    'If none of them actually answer the question, say so and search the web instead.)'
}
