// A reply that came from the fallback provider says so.
//
// Silence here is a small lie with real consequences: a user who thinks the
// local model answered has no reason to notice that their prompt just left
// the machine, or that Ollama has stopped running. The main process already
// reports which provider actually served the turn — this turns that into one
// line the user can read.

export type ChatResult = {
  content?: string
  provider?: string
  model?: string
  fallbackUsed?: boolean
  fallbackReason?: string
}

const REASON_TEXT: Record<string, string> = {
  ollama_unavailable:        'local Ollama is not running',
  ollama_no_models:          'no local model is installed',
  ollama_model_missing:      'the selected local model is not installed',
  ollama_generation_failed:  'local Ollama could not answer',
  openrouter_not_configured: 'no OpenRouter API key is configured',
  openrouter_failed:         'OpenRouter could not answer',
}

/** One markdown line, or '' when the primary provider served the turn. */
export function fallbackLine(result: ChatResult | null | undefined): string {
  if (!result?.fallbackUsed || !result.provider || result.provider === 'none') return ''
  const where = result.provider === 'openrouter' ? 'OpenRouter' : 'local Ollama'
  const why = result.fallbackReason ? REASON_TEXT[result.fallbackReason] : ''
  return `_Answered by the ${where} fallback${result.model ? ` (${result.model})` : ''}${why ? ` — ${why}` : ''}._`
}

/** Prefix `text` with the fallback line when there is one. */
export function withFallbackNotice(text: string, result: ChatResult | null | undefined): string {
  const line = fallbackLine(result)
  return line ? `${line}\n\n${text}` : text
}
