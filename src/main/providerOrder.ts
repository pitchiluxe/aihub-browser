// Which of the user's own API keys answer a request BEFORE the configured
// providers (Ollama, then OpenRouter). A key the user typed in is a deliberate
// choice: it takes priority over everything. If it fails (bad key, no credit,
// offline) the next one answers, then Ollama, then OpenRouter.
//
// Requests with pictures or agent tools stay on the router: the direct calls
// are text-only, and dropping the image or the tool protocol would answer a
// different question than the one asked.

export type DirectProvider = 'claude' | 'chatgpt'

export function directKeysFirst(
  keys: { claudeKey?: string; chatGptKey?: string },
  req: { needsTools?: boolean; carriesImages?: boolean },
): DirectProvider[] {
  if (req.needsTools || req.carriesImages) return []
  const out: DirectProvider[] = []
  if (keys.claudeKey?.trim()) out.push('claude')
  if (keys.chatGptKey?.trim()) out.push('chatgpt')
  return out
}
