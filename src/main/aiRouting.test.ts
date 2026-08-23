import { describe, it, expect, vi } from 'vitest'
import { routeGenerate, summarizeOpenRouterSkips, type RoutingSettings, type RouterDeps, type OllamaHealth } from './aiRouting'

const DEFAULTS: RoutingSettings = {
  primaryProvider: 'ollama',
  ollamaModel: 'mistral:7b',
  fallbackEnabled: true,
  fallbackProvider: 'openrouter',
  openRouterModel: 'openrouter/free',
}

function settings(over: Partial<RoutingSettings> = {}): RoutingSettings {
  return { ...DEFAULTS, ...over }
}

/** Spy-backed providers. Each test asserts on what was — and wasn't — called. */
function deps(over: {
  health?: OllamaHealth
  ollamaGenerate?: any
  orConfigured?: boolean
  orExists?: boolean
  orGenerate?: any
} = {}) {
  const health = vi.fn(async () => over.health ?? { available: true, models: ['mistral:7b'] })
  const generate = vi.fn(over.ollamaGenerate ?? (async () => ({ ok: true as const, value: 'local answer' })))
  const orGenerate = vi.fn(over.orGenerate ?? (async (model: string) => ({ ok: true as const, content: 'cloud answer', model })))
  const d: RouterDeps = {
    ollama: { health, generate },
    openRouter: {
      isConfigured: () => over.orConfigured !== false,
      modelExists: () => over.orExists !== false,
      generate: orGenerate,
    },
  }
  return { d, health, generate, orGenerate }
}

// ── Test 1 ─────────────────────────────────────────────────────────────────
describe('Ollama available', () => {
  it('answers from Ollama and never contacts OpenRouter', async () => {
    const { d, orGenerate } = deps()
    const r = await routeGenerate(settings(), d)

    expect(r.ok).toBe(true)
    expect(r).toMatchObject({ provider: 'ollama', model: 'mistral:7b', fallbackUsed: false })
    expect(orGenerate).not.toHaveBeenCalled()
  })

  it('uses the first installed model when none is configured', async () => {
    const { d } = deps({ health: { available: true, models: ['llama3.2:3b', 'mistral:7b'] } })
    const r = await routeGenerate(settings({ ollamaModel: '' }), d)
    expect(r).toMatchObject({ provider: 'ollama', model: 'llama3.2:3b' })
  })

  it('trusts the configured model when the model list could not be read', async () => {
    // /api/version answered but /api/tags timed out. An empty list means
    // "unknown", not "nothing installed" — inventing a model name here is how
    // "model not found" 404s used to happen.
    const { d, generate } = deps({ health: { available: true, models: [] } })
    const r = await routeGenerate(settings(), d)
    expect(generate).toHaveBeenCalledWith('mistral:7b')
    expect(r).toMatchObject({ provider: 'ollama', fallbackUsed: false })
  })
})

// ── Test 2 ─────────────────────────────────────────────────────────────────
describe('Ollama unavailable', () => {
  it('falls back to OpenRouter and says why', async () => {
    const { d, orGenerate, generate } = deps({
      health: { available: false, models: [], error: 'ECONNREFUSED' },
    })
    const r = await routeGenerate(settings(), d)

    expect(r.ok).toBe(true)
    expect(r).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/free',
      fallbackUsed: true,
      fallbackReason: 'ollama_unavailable',
    })
    // Never asked a dead Ollama to generate.
    expect(generate).not.toHaveBeenCalled()
    expect(orGenerate).toHaveBeenCalledOnce()
  })

  it('emits the acceptance-test log lines in order', async () => {
    const lines: string[] = []
    const { d } = deps({ health: { available: false, models: [] } })
    await routeGenerate(settings(), { ...d, log: l => lines.push(l) })

    expect(lines).toEqual([
      '[AI] Primary provider: ollama',
      '[OLLAMA] Checking local API...',
      '[OLLAMA] Health check failed',
      '[AI] Fallback enabled',
      '[AI] Fallback provider: openrouter',
      '[OPENROUTER] Model: openrouter/free',
      '[OPENROUTER] Request successful',
    ])
  })

  it('logs an Ollama-only success with no OpenRouter line at all', async () => {
    const lines: string[] = []
    const { d } = deps()
    await routeGenerate(settings(), { ...d, log: l => lines.push(l) })

    expect(lines).toContain('[AI] Fallback not required')
    expect(lines.some(l => l.startsWith('[OPENROUTER]'))).toBe(false)
  })
})

// ── Test 3 ─────────────────────────────────────────────────────────────────
describe('Ollama model missing', () => {
  it('falls back and names the model that is not installed', async () => {
    const { d, generate, orGenerate } = deps({
      health: { available: true, models: ['llama3.2:3b'] },
    })
    const r = await routeGenerate(settings({ ollamaModel: 'mistral:7b' }), d)

    expect(r).toMatchObject({ fallbackUsed: true, fallbackReason: 'ollama_model_missing' })
    // No point generating with a model Ollama does not have.
    expect(generate).not.toHaveBeenCalled()
    expect(orGenerate).toHaveBeenCalledOnce()
    expect(r.ok && r.notice).toContain('mistral:7b')
    expect(r.ok && r.notice).toMatch(/not installed/i)
  })

  it('reports "no chat model installed" separately from "wrong model"', async () => {
    const { d } = deps({ health: { available: true, models: [] } })
    const r = await routeGenerate(settings({ ollamaModel: '' }), d)
    expect(r).toMatchObject({ fallbackReason: 'ollama_no_models', fallbackUsed: true })
  })
})

// ── Test 4 ─────────────────────────────────────────────────────────────────
describe('Ollama generation failure', () => {
  it('falls back to OpenRouter', async () => {
    const { d, orGenerate } = deps({
      ollamaGenerate: async () => ({ ok: false as const, error: 'timeout — Ollama took over 120s to start replying' }),
    })
    const r = await routeGenerate(settings(), d)

    expect(r).toMatchObject({
      provider: 'openrouter', fallbackUsed: true, fallbackReason: 'ollama_generation_failed',
    })
    expect(orGenerate).toHaveBeenCalledOnce()
  })

  it('treats an empty reply as a failure, not as an answer', async () => {
    const { d } = deps({ ollamaGenerate: async () => ({ ok: true as const, value: '' }) })
    const r = await routeGenerate(settings(), d)
    expect(r).toMatchObject({ provider: 'openrouter', fallbackReason: 'ollama_generation_failed' })
  })
})

// ── Test 5 ─────────────────────────────────────────────────────────────────
describe('fallback disabled', () => {
  it('returns the Ollama error and makes no OpenRouter request', async () => {
    const { d, orGenerate } = deps({ health: { available: false, models: [] } })
    const r = await routeGenerate(settings({ fallbackEnabled: false }), d)

    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ provider: 'none', fallbackUsed: false, fallbackReason: 'ollama_unavailable' })
    expect(orGenerate).not.toHaveBeenCalled()
    expect(r.content).toMatch(/Ollama is not reachable/i)
    // The user must not be shown an OpenRouter problem they didn't cause.
    expect(r.content).not.toMatch(/credits/i)
  })

  it('also honours fallbackProvider: none', async () => {
    const { d, orGenerate } = deps({ health: { available: false, models: [] } })
    const r = await routeGenerate(settings({ fallbackProvider: 'none' }), d)
    expect(r.ok).toBe(false)
    expect(orGenerate).not.toHaveBeenCalled()
  })
})

// ── Test 8 ─────────────────────────────────────────────────────────────────
describe('openrouter/free as the automatic fallback', () => {
  it('is used without needing to appear in the catalog', async () => {
    // modelExists is false for everything — the meta-router is still valid.
    const { d, orGenerate } = deps({
      health: { available: false, models: [] },
      orExists: false,
    })
    const r = await routeGenerate(settings({ openRouterModel: 'openrouter/free' }), d)
    expect(orGenerate).toHaveBeenCalledWith('openrouter/free')
    expect(r).toMatchObject({ provider: 'openrouter', model: 'openrouter/free' })
  })
})

// ── Test 9 ─────────────────────────────────────────────────────────────────
describe('retired fallback model', () => {
  it('substitutes the free meta-router rather than spending a dead request', async () => {
    const { d, orGenerate } = deps({
      health: { available: false, models: [] },
      orExists: false,
    })
    const r = await routeGenerate(settings({ openRouterModel: 'vendor/retired-model:free' }), d)
    expect(orGenerate).toHaveBeenCalledWith('openrouter/free')
    expect(r).toMatchObject({ provider: 'openrouter', model: 'openrouter/free' })
  })
})

// ── Test 10 ────────────────────────────────────────────────────────────────
describe('OpenRouter HTTP 402', () => {
  it('is reported as a billing problem, never as an Ollama problem', async () => {
    const { d } = deps({
      health: { available: false, models: [], error: 'ECONNREFUSED' },
      orGenerate: async () => ({ ok: false as const, failure: { kind: 'credits' as const } }),
    })
    const r = await routeGenerate(settings(), d)

    expect(r.ok).toBe(false)
    expect(r.content).toMatch(/credits/i)
    // Both providers' own state is named, so the user knows there are two
    // separate things to fix.
    expect(r.content).toMatch(/Ollama:/)
    expect(r.content).toMatch(/OpenRouter:/)
    expect(!r.ok && r.ollamaError).toMatch(/not reachable/i)
    expect(!r.ok && r.openRouterError).toMatch(/credits/i)
  })

  it('does not retry after both providers have failed', async () => {
    const { d, orGenerate, generate } = deps({
      health: { available: false, models: [] },
      orGenerate: async () => ({ ok: false as const, failure: { kind: 'credits' as const } }),
    })
    await routeGenerate(settings(), d)
    expect(orGenerate).toHaveBeenCalledOnce()
    expect(generate).not.toHaveBeenCalled()
  })

  it('distinguishes a 429 from a 402', async () => {
    const { d } = deps({
      health: { available: false, models: [] },
      orGenerate: async () => ({ ok: false as const, failure: { kind: 'rate_limited' as const } }),
    })
    const r = await routeGenerate(settings(), d)
    expect(r.content).toMatch(/rate-limited/i)
    expect(r.content).not.toMatch(/no credits/i)
  })

  // Measured against the live account: OpenRouter explains exactly which quota
  // was hit and how to raise it. Paraphrasing that into "rate-limited, try
  // later" throws away the only actionable part.
  it("quotes OpenRouter's own explanation when it gave one", async () => {
    const { d } = deps({
      health: { available: false, models: [] },
      orGenerate: async () => ({
        ok: false as const,
        failure: {
          kind: 'rate_limited' as const,
          message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day',
        },
      }),
    })
    const r = await routeGenerate(settings(), d)
    expect(r.content).toMatch(/free-models-per-day/)
    expect(r.content).toMatch(/OpenRouter said/)
  })
})

// ── Test 11 ────────────────────────────────────────────────────────────────
describe('OpenRouter not configured', () => {
  it('says so instead of reporting a generic outage', async () => {
    const { d, orGenerate } = deps({
      health: { available: false, models: [] },
      orConfigured: false,
    })
    const r = await routeGenerate(settings(), d)
    expect(r.ok).toBe(false)
    expect(orGenerate).not.toHaveBeenCalled()
    expect(!r.ok && r.openRouterError).toMatch(/API key/i)
  })
})

// ── Test 12 ────────────────────────────────────────────────────────────────
describe('OpenRouter unavailable while Ollama is healthy', () => {
  it('does not affect the Ollama request at all', async () => {
    const { d, orGenerate } = deps({
      orConfigured: false,
      orGenerate: async () => { throw new Error('OpenRouter should never be called here') },
    })
    const r = await routeGenerate(settings(), d)
    expect(r).toMatchObject({ provider: 'ollama', fallbackUsed: false })
    expect(orGenerate).not.toHaveBeenCalled()
  })
})

// ── OpenRouter as the primary ──────────────────────────────────────────────
describe('OpenRouter primary', () => {
  it('serves the request without touching Ollama', async () => {
    const { d, health, generate } = deps()
    const r = await routeGenerate(settings({ primaryProvider: 'openrouter', fallbackProvider: 'ollama' }), d)
    expect(r).toMatchObject({ provider: 'openrouter', fallbackUsed: false })
    expect(health).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it('falls back to the local model when the cloud refuses', async () => {
    const { d, generate } = deps({
      orGenerate: async () => ({ ok: false as const, failure: { kind: 'credits' as const } }),
    })
    const r = await routeGenerate(settings({ primaryProvider: 'openrouter', fallbackProvider: 'ollama' }), d)
    expect(r).toMatchObject({
      provider: 'ollama', fallbackUsed: true, fallbackReason: 'openrouter_failed',
    })
    expect(generate).toHaveBeenCalledWith('mistral:7b')
  })

  it('falls back when no API key is configured', async () => {
    const { d } = deps({ orConfigured: false })
    const r = await routeGenerate(settings({ primaryProvider: 'openrouter', fallbackProvider: 'ollama' }), d)
    expect(r).toMatchObject({ provider: 'ollama', fallbackReason: 'openrouter_not_configured' })
  })
})

// ── §24: fallbacks are never disguised ─────────────────────────────────────
describe('routing metadata', () => {
  it('always reports the provider that actually answered', async () => {
    const { d } = deps({ health: { available: false, models: [] } })
    const r = await routeGenerate(settings(), d)
    expect(r).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/free',
      fallbackUsed: true,
      fallbackReason: 'ollama_unavailable',
    })
    expect(r.ok && r.notice).toMatch(/fallback/i)
  })
})

describe('summarizeOpenRouterSkips', () => {
  const none = { credits: 0, rateLimited: 0, restricted: 0 }

  it('reports unavailable when nothing was actually refused', () => {
    expect(summarizeOpenRouterSkips(none)).toEqual({ kind: 'unavailable' })
  })

  // The real shape of a bad run, measured on a live account: a mix, where the
  // majority is the thing the user has to act on.
  it('reports whichever refusal blocked the most candidates', () => {
    expect(summarizeOpenRouterSkips({ ...none, rateLimited: 8, credits: 1, restricted: 1 }).kind)
      .toBe('rate_limited')
    expect(summarizeOpenRouterSkips({ ...none, restricted: 6, credits: 2 }).kind)
      .toBe('restricted')
    expect(summarizeOpenRouterSkips({ ...none, credits: 5, rateLimited: 1 }).kind)
      .toBe('credits')
  })

  it('breaks ties toward the cheapest thing to be wrong about', () => {
    expect(summarizeOpenRouterSkips({ ...none, rateLimited: 3, credits: 3 }).kind).toBe('rate_limited')
    expect(summarizeOpenRouterSkips({ ...none, restricted: 3, credits: 3 }).kind).toBe('restricted')
  })

  it('quotes the detail belonging to the reported kind, not another kind', () => {
    const out = summarizeOpenRouterSkips({
      credits: 1, rateLimited: 0, restricted: 4,
      creditsDetail: 'this account never purchased credits',
      restrictedDetail: 'only available on agentic harnesses',
    })
    expect(out).toEqual({ kind: 'restricted', message: 'only available on agentic harnesses' })
  })
})
