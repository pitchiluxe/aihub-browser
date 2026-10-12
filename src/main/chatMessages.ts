// Message hygiene at the one door every AI request walks through.
//
// Callers build histories from UI state, and UI state has gaps: a step bubble
// with no narration, a turn that failed. OpenRouter rejects a request outright
// when any message is empty ("must have at least 1 item in the message"), and
// some upstream providers reject two user turns in a row. Fixing that in each
// caller is how it got missed; fixing it here covers every feature at once.
//
// The budget fit exists for Ollama. Past its context window Ollama truncates
// from the FRONT, which silently deletes the system prompt — the agent then
// answers with no idea what it is for. Dropping the oldest middle turns keeps
// the instructions and the question; only stale history is lost.

type Msg = { role: string; content: any; images?: string[]; [k: string]: any }

function textOf(m: Msg): string {
  return typeof m.content === 'string' ? m.content : ''
}

function isEmpty(m: Msg): boolean {
  if (m.images?.length) return false
  if (Array.isArray(m.content)) return m.content.length === 0
  return !String(m.content ?? '').trim()
}

export function sanitizeChatMessages<T extends Msg>(messages: T[]): T[] {
  const out: T[] = []
  for (const m of messages) {
    if (!m || isEmpty(m)) continue
    const prev = out[out.length - 1]
    if (prev && prev.role === m.role && m.role !== 'system'
        && typeof prev.content === 'string' && typeof m.content === 'string') {
      const images = [...(prev.images || []), ...(m.images || [])]
      out[out.length - 1] = {
        ...prev,
        content: [prev.content.trim(), m.content.trim()].filter(Boolean).join('\n\n'),
        ...(images.length ? { images } : {}),
      }
      continue
    }
    out.push({ ...m })
  }
  return out
}

const size = (msgs: Msg[]) => msgs.reduce((n, m) => n + textOf(m).length, 0)

/** Fit text content under `maxChars`; returns the input itself when it fits. */
export function fitMessagesToBudget<T extends Msg>(messages: T[], maxChars: number): T[] {
  if (size(messages) <= maxChars) return messages

  const out = [...messages]
  const lastIndex = () => out.length - 1
  // Oldest non-system turn that isn't the latest one.
  const dropIndex = () => out.findIndex((m, i) => m.role !== 'system' && i < lastIndex())
  while (size(out) > maxChars) {
    const i = dropIndex()
    if (i < 0) break
    out.splice(i, 1)
  }

  // Still over: the latest turn or the system prompt is itself huge (a pasted
  // document). Trim the largest text, keeping its head — where the question
  // and the instructions usually are.
  while (size(out) > maxChars) {
    let biggest = 0
    out.forEach((m, i) => { if (textOf(m).length > textOf(out[biggest]).length) biggest = i })
    const text = textOf(out[biggest])
    const excess = size(out) - maxChars
    const note = '\n…[trimmed to fit the local model]'
    const keep = Math.max(0, text.length - excess - note.length)
    if (keep === 0 || keep >= text.length) break
    out[biggest] = { ...out[biggest], content: text.slice(0, keep) + note }
  }
  return out
}
