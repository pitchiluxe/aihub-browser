const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434'

/** Normalize Settings and Ollama's host-style environment value to an API base URL. */
export function normalizeOllamaBase(value: string | undefined | null): string {
  const raw = String(value || '').trim()
  if (!raw) return DEFAULT_OLLAMA_BASE

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_OLLAMA_BASE
    if (url.hostname === 'localhost' || url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api$/i, '')
    return url.toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_OLLAMA_BASE
  }
}

/** Always probe the configured Ollama service and the standard local default. */
export function ollamaBaseCandidates(configuredBase: string): string[] {
  return [...new Set([normalizeOllamaBase(configuredBase), DEFAULT_OLLAMA_BASE])]
}
