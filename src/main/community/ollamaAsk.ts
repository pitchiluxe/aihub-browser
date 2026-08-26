/**
 * One question to a local Ollama, one answer back.
 *
 * The app already has a streaming chat path for the assistant. The guide does
 * not want any of it: no tokens to render, no cancellation, no routing across
 * providers. It wants a whole answer or nothing, on a budget, without ever
 * reaching a cloud provider — a community bot that silently starts spending
 * somebody's OpenRouter credits is not a local bot.
 */

export interface AskOptions {
  timeoutMs?: number
  /** Lower than chat: a discussion starter should not free-associate, and a
   *  moderation verdict must be as close to reproducible as a model gets. */
  temperature?: number
}

const DEFAULT_TIMEOUT_MS = 120_000

export function createOllamaAsk(deps: {
  base: () => string
  model: () => string
}) {
  return async function ask(prompt: string, opts: AskOptions = {}): Promise<string | null> {
    const model = deps.model()
    if (!model) return null

    const controller = new AbortController()
    // A guide that hangs holds a timer open and quietly stops posting. Better
    // to give up on this cycle and try again at the next one.
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    try {
      const response = await fetch(`${deps.base().replace(/\/+$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: 'user', content: prompt }],
          options: { temperature: opts.temperature ?? 0.7 },
        }),
      })
      if (!response.ok) return null

      const data = await response.json() as { message?: { content?: string } }
      const content = data?.message?.content
      return typeof content === 'string' && content.trim() ? content : null
    } catch {
      // Ollama not running, model not pulled, request aborted, machine asleep.
      // Every one of these means "no post this cycle", and none of them is
      // worth interrupting the user over — the guide is a background courtesy,
      // not a feature somebody is waiting on.
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
