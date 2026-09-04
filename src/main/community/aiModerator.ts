/**
 * The guide reads the room, and files reports. It never removes anything.
 *
 * ── Why flag-only ─────────────────────────────────────────────────────────
 *
 * The model doing the judging is whatever the owner happens to have pulled
 * into Ollama — a 3B on one machine, a 70B on another, a different quantised
 * build next month. Its verdicts are not reproducible and cannot be appealed
 * to. Letting that hide messages means a false positive silences a real
 * person, in a room where somebody may have just posted a prayer request
 * about their marriage. A human sees the flag; a human decides.
 *
 * So this module's whole output is a report in the queue that already exists,
 * with the model's reasoning attached — which also finally makes that queue
 * worth opening.
 */

/** What the model is asked to look for. Kept explicit so the report can say
 *  which rule it believes was broken, rather than a bare "flagged". */
export type Concern =
  | 'harassment'
  | 'spam'
  | 'impersonation'
  | 'sexual-content'
  | 'violence'
  | 'self-harm'
  | 'illegal'

export const CONCERNS: Concern[] = [
  'harassment', 'spam', 'impersonation', 'sexual-content',
  'violence', 'self-harm', 'illegal',
]

export interface Verdict {
  flagged: boolean
  concern: Concern | null
  /** 0..1. Only used to decide whether to file, never to act automatically. */
  confidence: number
  /** One sentence, shown to the moderator beside the message. */
  reason: string
}

/**
 * Below this the guide keeps quiet.
 *
 * A queue full of low-confidence flags is a queue nobody reads, and an unread
 * queue is worse than no queue — it looks like moderation while being none.
 */
export const FLAG_THRESHOLD = 0.7

export interface ModerationInput {
  channelName: string
  authorHandle: string
  body: string
}

export function buildModerationPrompt(input: ModerationInput): string {
  return [
    'You review one message from a community chat and decide whether a human moderator should look at it.',
    '',
    `Channel: ${input.channelName}`,
    `Author: ${input.authorHandle}`,
    'Message:',
    '"""',
    String(input.body ?? '').slice(0, 2000),
    '"""',
    '',
    `Concerns worth flagging: ${CONCERNS.join(', ')}.`,
    '',
    'Most messages are perfectly fine. Disagreement, strong opinions, criticism,',
    'swearing, religious conviction and blunt language are NOT reasons to flag.',
    'Flag only content that would genuinely harm somebody or the room.',
    '',
    'Reply with JSON only, no prose, in exactly this shape:',
    '{"flagged": true|false, "concern": "<one of the concerns, or null>", "confidence": 0.0-1.0, "reason": "<one sentence>"}',
  ].join('\n')
}

/**
 * Read the model's answer.
 *
 * Anything unparseable is treated as "not flagged". That default is
 * deliberate: the cost of missing one bad message is that a person reports it
 * by hand, which they can already do; the cost of a parse error being read as
 * a flag is an innocent member in the moderation queue because a 3B model
 * emitted stray prose.
 */
export function parseVerdict(raw: string): Verdict {
  const safe: Verdict = { flagged: false, concern: null, confidence: 0, reason: '' }

  const text = String(raw ?? '').trim()
  if (!text) return safe

  // Models wrap JSON in fences and commentary; take the first balanced object.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return safe

  let parsed: unknown
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return safe }
  if (!parsed || typeof parsed !== 'object') return safe

  const row = parsed as Record<string, unknown>
  const flagged = row.flagged === true || row.flagged === 'true'
  if (!flagged) return safe

  const concern = CONCERNS.includes(row.concern as Concern) ? (row.concern as Concern) : null
  const confidence = clamp01(Number(row.confidence))
  const reason = String(row.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)

  // A flag the model cannot name or explain is not actionable by a human, and
  // an unactionable flag is queue noise.
  if (!concern || !reason) return safe

  return { flagged: true, concern, confidence, reason }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Does this verdict earn a place in the queue? */
export function shouldFile(verdict: Verdict): boolean {
  return verdict.flagged && verdict.confidence >= FLAG_THRESHOLD
}

/** The text stored on the report, so the moderator sees who decided and why. */
export function reportReason(verdict: Verdict): string {
  return `AI guide flagged this as ${verdict.concern} — ${verdict.reason}`
}
