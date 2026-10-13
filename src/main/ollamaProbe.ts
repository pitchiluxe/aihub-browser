// Is local Ollama available? Measured 2026-10-12 on the user's CPU-only PC:
// while a model is running, /api/tags takes 3.5–5 s+ and /api/version ~1.2 s.
// The old probe gave them 4 s / 1.5 s, decided "not running", and every AI
// feature fell back to OpenRouter with "Install Ollama" showing — with Ollama
// running. A busy Ollama is still Ollama: patient budgets, the last known model
// list, two misses before giving up, and callers never wait on a re-check.

export interface OllamaModelInfo { name: string; tools: boolean; params: number; cloud: boolean }
export interface OllamaProbe { running: boolean; models: string[]; info?: OllamaModelInfo[]; base?: string }

type Get = (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>

/** Model list: a CPU-bound Ollama answers slowly while it is generating. */
const TAGS_BUDGET_MS = 8000
/** Liveness only. */
const VERSION_BUDGET_MS = 4000
/** How long a result is fresh before it is re-checked (in the background). */
const FRESH_MS = 15_000
/** "Not running" is re-checked much sooner: Ollama may just be starting (or we were). */
const FRESH_MISS_MS = 3_000
/** Consecutive failed rounds before "running" turns into "not running". */
const MISSES_TO_DOWN = 2

export function parseTags(body: string): OllamaModelInfo[] {
  const json = JSON.parse(body)
  return (json.models || [])
    .map((m: any) => {
      const name = typeof m === 'string' ? m : m.name || ''
      const caps: string[] = Array.isArray(m?.capabilities) ? m.capabilities : []
      const sizeStr = String(m?.details?.parameter_size || '')
      const params = parseFloat(sizeStr) || 0   // "7.6B" → 7.6, "134.52M" → 134.52
      return { name, tools: caps.includes('tools'), params: /M$/i.test(sizeStr) ? params / 1000 : params, cloud: !!m?.remote_host }
    })
    .filter((e: OllamaModelInfo) => e.name && !/embed/i.test(e.name) && !e.cloud)
}

export function createOllamaProbe(deps: { get: Get; bases: () => string[]; now?: () => number }) {
  const now = deps.now ?? Date.now
  let last: { at: number; value: OllamaProbe } | null = null
  let lastModels: { models: string[]; info: OllamaModelInfo[] } | null = null
  let misses = 0
  let inflight: Promise<OllamaProbe> | null = null

  async function round(): Promise<OllamaProbe | null> {
    for (const base of deps.bases()) {
      // ANY HTTP answer means the Ollama server is up: while it generates on the
      // CPU it may answer "busy" (5xx) — that is a running Ollama, not a missing one.
      let answered = false
      try {
        const { status, body } = await deps.get(`${base}/api/tags`, TAGS_BUDGET_MS)
        answered = true
        if (status >= 200 && status < 400) {
          const info = parseTags(body)
          if (info.length) { lastModels = { models: info.map(e => e.name), info }; return { running: true, ...lastModels, base } }
        }
      } catch { /* busy or absent — ask for the version */ }
      if (!answered) {
        try { await deps.get(`${base}/api/version`, VERSION_BUDGET_MS); answered = true } catch { /* next base */ }
      }
      // Answering but too busy to list models: the list it gave last time is still right.
      if (answered) return { running: true, models: lastModels?.models ?? [], info: lastModels?.info, base }
    }
    return null
  }

  async function refresh(): Promise<OllamaProbe> {
    const r = await round()
    if (r) { misses = 0; last = { at: now(), value: r }; return r }
    misses++
    // One slow round after a good one is a busy Ollama, not a missing one.
    const value: OllamaProbe = last?.value.running && misses < MISSES_TO_DOWN ? last.value : { running: false, models: [] }
    last = { at: now(), value }
    return value
  }

  const run = () => (inflight ??= refresh().finally(() => { inflight = null }))

  return {
    /** force: wait for a fresh answer (Settings' "check again"). Otherwise the
     *  last answer is returned at once and re-checked in the background. */
    async check(force = false): Promise<OllamaProbe> {
      if (force || !last) return run()
      if (now() - last.at > (last.value.running ? FRESH_MS : FRESH_MISS_MS)) void run()
      return last.value
    },
  }
}
