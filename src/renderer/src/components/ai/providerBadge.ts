// Who will answer the next message, in the order the main process uses
// (providerOrder.ts): the user's own key first, then Ollama, then OpenRouter.

export interface ProviderBadge { tone: 'key' | 'local' | 'cloud' | 'checking'; label: string; banner: string | null }

export function providerBadge(s: {
  ollama: { running: boolean; models: string[] } | null
  hasClaudeKey?: boolean
  hasChatGptKey?: boolean
}): ProviderBadge {
  if (s.hasClaudeKey) return { tone: 'key', label: 'Your key · Claude', banner: null }
  if (s.hasChatGptKey) return { tone: 'key', label: 'Your key · ChatGPT', banner: null }
  if (!s.ollama) return { tone: 'checking', label: 'Connecting…', banner: null }
  if (s.ollama.running) return { tone: 'local', label: 'Local · Ollama', banner: null }
  return { tone: 'cloud', label: 'Cloud · OpenRouter', banner: 'Using OpenRouter (cloud) — start Ollama (or install it) for private local AI, or add your own Claude / ChatGPT key in Settings.' }
}
