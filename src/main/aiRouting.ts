// Which provider serves a turn, and why.
//
// The rule is: local first. Ollama is private, free and already on the
// machine; OpenRouter is the safety net for when it isn't running. The bug
// this replaces was not the order — chat was already Ollama-first — but that
// a healthy-looking Ollama could spend seven minutes failing to produce a
// first token, after which OpenRouter was asked, returned 402, and the user
// was shown "your OpenRouter account has no credits" for a request that never
// needed OpenRouter at all.
//
// So two things are enforced here. A provider is only abandoned for a REAL
// failure (§14) — an unreachable API, a missing model, a generation that
// errored — never for taking a moment to warm up. And whatever happens is
// reported honestly: the result always says which provider actually answered
// and, when it wasn't the primary, why (§24).
//
// Providers are injected rather than imported so this file stays free of
// Electron, sockets and timers, and the whole decision table can be tested.

import { OPENROUTER_FREE_AUTO } from './openRouterCatalog'

export type ProviderId = 'ollama' | 'openrouter'

export interface RoutingSettings {
  primaryProvider: ProviderId
  /** The Ollama model the user picked; '' means "whatever is installed". */
  ollamaModel: string
  fallbackEnabled: boolean
  fallbackProvider: ProviderId | 'none'
  openRouterModel: string
}

export type FallbackReason =
  | 'ollama_unavailable'
  | 'ollama_no_models'
  | 'ollama_model_missing'
  | 'ollama_generation_failed'
  | 'openrouter_not_configured'
  | 'openrouter_failed'

/** Why OpenRouter refused — each one needs a different action from the user. */
export type OpenRouterFailureKind = 'credits' | 'rate_limited' | 'restricted' | 'unavailable' | 'error'

export interface OpenRouterFailure { kind: OpenRouterFailureKind; message?: string }

/** How many candidates each per-model refusal blocked, and what OpenRouter
 *  said the first time it gave that refusal. */
export interface OpenRouterSkipCounts {
  credits: number
  rateLimited: number
  restricted: number
  creditsDetail?: string
  rateDetail?: string
  restrictedDetail?: string
}

/**
 * Turn a chain's tally of per-model refusals into the one cause to report.
 *
 * Whichever refusal blocked the most candidates is the one the user has to act
 * on: a run of ten free models can come back as eight 429s, one 402 and one
 * 403, and reporting any of the singletons sends the user to fix something
 * that was never the obstacle.
 *
 * Ties resolve to rate limiting first — it is the transient cause and costs
 * the user nothing but time — then to restriction, then to credits. Credits
 * goes last on purpose: telling someone to buy credits they already have, or
 * do not need, is the most expensive way to be wrong.
 */
export function summarizeOpenRouterSkips(s: OpenRouterSkipCounts): OpenRouterFailure {
  const max = Math.max(s.credits, s.rateLimited, s.restricted)
  if (max === 0) return { kind: 'unavailable' }
  if (s.rateLimited === max) return { kind: 'rate_limited', message: s.rateDetail || undefined }
  if (s.restricted  === max) return { kind: 'restricted',   message: s.restrictedDetail || undefined }
  return { kind: 'credits', message: s.creditsDetail || undefined }
}

export interface OllamaHealth {
  available: boolean
  /** Installed models. EMPTY MEANS UNKNOWN, not "none installed": Ollama can
   *  answer /api/version while /api/tags times out, and inventing a model name
   *  there is how "model 'llama3' not found" 404s used to happen. */
  models: string[]
  error?: string
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

export interface OllamaProvider {
  health(): Promise<OllamaHealth>
  /** Resolves with the reply text; `ok: false` for a real failure. */
  generate(model: string): Promise<Attempt<string>>
}

export interface OpenRouterProvider {
  isConfigured(): boolean
  /** True when the model is in the live catalog (or is `openrouter/free`). */
  modelExists(id: string): boolean
  generate(model: string): Promise<{ ok: true; content: string; model: string } | { ok: false; failure: OpenRouterFailure }>
}

export interface RouterDeps {
  ollama: OllamaProvider
  openRouter: OpenRouterProvider
  log?: (line: string) => void
}

export interface RouteSuccess {
  ok: true
  content: string
  provider: ProviderId
  model: string
  fallbackUsed: boolean
  fallbackReason?: FallbackReason
  /** Shown alongside the answer when the route wasn't the expected one. */
  notice?: string
}

export interface RouteFailure {
  ok: false
  content: string
  provider: 'none'
  model: 'none'
  fallbackUsed: boolean
  fallbackReason?: FallbackReason
  ollamaError?: string
  openRouterError?: string
}

export type RouteResult = RouteSuccess | RouteFailure

// ── Human-readable failure text ────────────────────────────────────────────

function openRouterMessage(f: OpenRouterFailure): string {
  // OpenRouter's own wording, when it sent any. It knows things this app
  // cannot infer from a status code — which quota was hit, and what raises it.
  const said = f.message ? `\n\nOpenRouter said: "${f.message}"` : ''
  switch (f.kind) {
    case 'credits':
      // §27: a 402 is a billing fact about OpenRouter. It says nothing about
      // Ollama, and must never be reported as though it did.
      return `OpenRouter could not process the request because the selected model requires available credits or the account has reached its applicable limits.${said}\n\nTry selecting an OpenRouter free model (Settings → AI → Model Filter → Free), or use "OpenRouter Free Auto".`
    case 'rate_limited':
      return `OpenRouter rate-limited the request (HTTP 429). Free models share a limited daily pool per account.${said}\n\nWait for the limit to reset, or pick a model that isn't rate-limited.`
    case 'restricted':
      // OpenRouter gates some free models to applications it has approved.
      // Nothing the user buys or waits for changes it — the only fix is a
      // different model, so say that instead of quoting a billing hint.
      return `Every OpenRouter model tried is restricted to approved applications and will not serve this app.${said}\n\nPick a different model in Settings → AI — "OpenRouter Free Auto" avoids the gated ones.`
    case 'unavailable':
      return `The selected OpenRouter model is unavailable${f.message ? ` (${f.message})` : ''}. Pick another model in Settings → AI.`
    default:
      return `OpenRouter request failed${f.message ? `: ${f.message}` : '.'}`
  }
}

function ollamaHint(reason: FallbackReason, detail: string, model: string): string {
  switch (reason) {
    case 'ollama_unavailable':
      return `Local Ollama is not reachable${detail ? ` (${detail})` : ''}. Start Ollama, or install it from ollama.com.`
    case 'ollama_no_models':
      return 'Local Ollama is running but has no chat model installed. Run: ollama pull llama3.2'
    case 'ollama_model_missing':
      return `Local Ollama is running, but the selected model "${model}" is not installed. Run: ollama pull ${model}`
    default:
      return `Local Ollama failed to answer${detail ? `: ${detail}` : '.'}`
  }
}

/** The line shown with a successful fallback answer — the user should never
 *  have to guess that a reply came from somewhere other than the primary. */
function fallbackNotice(reason: FallbackReason, detail: string, ollamaModel: string, from: ProviderId, to: ProviderId): string {
  const why = from === 'ollama'
    ? ollamaHint(reason, detail, ollamaModel)
    : `${detail || 'The primary provider failed.'}`
  return `${why}\n\nAnswered by the ${to === 'openrouter' ? 'OpenRouter' : 'local Ollama'} fallback.`
}

// ── Router ─────────────────────────────────────────────────────────────────

/**
 * Run one request through the configured providers.
 *
 * Never throws: a total failure comes back as `ok: false` with text explaining
 * both providers' state, because "AI providers are currently unavailable" on
 * its own tells the user nothing about what to fix.
 */
export async function routeGenerate(settings: RoutingSettings, deps: RouterDeps): Promise<RouteResult> {
  const log = deps.log ?? (() => {})
  log(`[AI] Primary provider: ${settings.primaryProvider}`)

  return settings.primaryProvider === 'openrouter'
    ? await openRouterPrimary(settings, deps, log)
    : await ollamaPrimary(settings, deps, log)
}

async function ollamaPrimary(settings: RoutingSettings, deps: RouterDeps, log: (s: string) => void): Promise<RouteResult> {
  let reason: FallbackReason = 'ollama_unavailable'
  let detail = ''

  log('[OLLAMA] Checking local API...')
  const health = await deps.ollama.health()

  if (!health.available) {
    log('[OLLAMA] Health check failed')
    detail = health.error || ''
    return fallbackFrom('ollama', reason, detail, settings, deps, log)
  }
  log('[OLLAMA] Connected')

  // Model resolution. An empty model list means /api/tags didn't answer, not
  // that nothing is installed — trust the user's choice and let Ollama judge.
  const known = health.models
  const configured = settings.ollamaModel
  let model = configured
  if (known.length) {
    if (!configured) {
      model = known[0]
    } else if (!known.includes(configured)) {
      // §16: a configured-but-uninstalled model is a real failure, and the
      // user is told which model is missing rather than just "fallback used".
      log(`[OLLAMA] Selected model: ${configured}`)
      log('[OLLAMA] Model NOT installed')
      return fallbackFrom('ollama', 'ollama_model_missing', '', settings, deps, log)
    }
  }
  if (!model) {
    log('[OLLAMA] No chat model installed')
    return fallbackFrom('ollama', 'ollama_no_models', '', settings, deps, log)
  }
  log(`[OLLAMA] Selected model: ${model}`)
  log('[OLLAMA] Model available')

  log('[AI] Sending request to Ollama')
  const gen = await deps.ollama.generate(model)
  if (gen.ok && gen.value) {
    log('[AI] Response received')
    log('[AI] Fallback not required')
    return { ok: true, content: gen.value, provider: 'ollama', model, fallbackUsed: false }
  }

  reason = 'ollama_generation_failed'
  detail = gen.ok ? `Ollama returned an empty response (model: ${model})` : gen.error
  log(`[OLLAMA] Generation failed: ${detail}`)
  return fallbackFrom('ollama', reason, detail, settings, deps, log)
}

async function openRouterPrimary(settings: RoutingSettings, deps: RouterDeps, log: (s: string) => void): Promise<RouteResult> {
  if (!deps.openRouter.isConfigured()) {
    log('[OPENROUTER] No API key configured')
    return fallbackFrom('openrouter', 'openrouter_not_configured', 'No OpenRouter API key is configured.', settings, deps, log)
  }
  const attempt = await callOpenRouter(settings, deps, log)
  if (attempt.ok) {
    log('[AI] Fallback not required')
    return { ok: true, content: attempt.content, provider: 'openrouter', model: attempt.model, fallbackUsed: false }
  }
  return fallbackFrom('openrouter', 'openrouter_failed', openRouterMessage(attempt.failure), settings, deps, log)
}

/**
 * Ask OpenRouter, resolving the model first.
 *
 * A saved model that has since been retired would otherwise cost a guaranteed
 * dead round-trip; `openrouter/free` is the safe substitute because it is a
 * router that picks whatever free model is live right now (§17, §32).
 */
async function callOpenRouter(
  settings: RoutingSettings, deps: RouterDeps, log: (s: string) => void,
): Promise<{ ok: true; content: string; model: string } | { ok: false; failure: OpenRouterFailure }> {
  let model = settings.openRouterModel || OPENROUTER_FREE_AUTO
  if (!deps.openRouter.modelExists(model)) {
    log(`[OPENROUTER] Model ${model} is not in the current catalog — using ${OPENROUTER_FREE_AUTO}`)
    model = OPENROUTER_FREE_AUTO
  }
  log(`[OPENROUTER] Model: ${model}`)
  const res = await deps.openRouter.generate(model)
  if (res.ok && res.content) {
    log('[OPENROUTER] Request successful')
    return res
  }
  if (res.ok) return { ok: false, failure: { kind: 'error', message: 'empty response' } }
  log(`[OPENROUTER] Request failed: ${res.failure.kind}`)
  return res
}

/** The primary is out. Honour the fallback settings, or report the failure. */
async function fallbackFrom(
  from: ProviderId,
  reason: FallbackReason,
  detail: string,
  settings: RoutingSettings,
  deps: RouterDeps,
  log: (s: string) => void,
): Promise<RouteResult> {
  const primaryText = from === 'ollama'
    ? ollamaHint(reason, detail, settings.ollamaModel)
    : detail

  // §5 of the test plan: fallback disabled means the primary's error is the
  // answer. No request is made to the other provider at all.
  if (!settings.fallbackEnabled || settings.fallbackProvider === 'none' || settings.fallbackProvider === from) {
    log('[AI] Fallback disabled — returning primary error')
    return {
      ok: false, content: primaryText, provider: 'none', model: 'none',
      fallbackUsed: false, fallbackReason: reason,
      ...(from === 'ollama' ? { ollamaError: primaryText } : { openRouterError: primaryText }),
    }
  }

  const to = settings.fallbackProvider
  log('[AI] Fallback enabled')
  log(`[AI] Fallback provider: ${to}`)

  if (to === 'openrouter') {
    if (!deps.openRouter.isConfigured()) {
      log('[OPENROUTER] No API key configured')
      return bothFailed(primaryText, 'No OpenRouter API key is configured (Settings → AI → OpenRouter).', reason, from)
    }
    const res = await callOpenRouter(settings, deps, log)
    if (res.ok) {
      return {
        ok: true, content: res.content, provider: 'openrouter', model: res.model,
        fallbackUsed: true, fallbackReason: reason,
        notice: fallbackNotice(reason, detail, settings.ollamaModel, from, 'openrouter'),
      }
    }
    return bothFailed(primaryText, openRouterMessage(res.failure), reason, from)
  }

  // Fallback to Ollama (used when OpenRouter is the primary).
  log('[OLLAMA] Checking local API...')
  const health = await deps.ollama.health()
  if (!health.available) {
    return bothFailed(primaryText, ollamaHint('ollama_unavailable', health.error || '', settings.ollamaModel), reason, from)
  }
  const model = settings.ollamaModel && (!health.models.length || health.models.includes(settings.ollamaModel))
    ? settings.ollamaModel
    : health.models[0] || ''
  if (!model) return bothFailed(primaryText, ollamaHint('ollama_no_models', '', ''), reason, from)

  const gen = await deps.ollama.generate(model)
  if (gen.ok && gen.value) {
    return {
      ok: true, content: gen.value, provider: 'ollama', model,
      fallbackUsed: true, fallbackReason: reason,
      notice: fallbackNotice(reason, detail, settings.ollamaModel, from, 'ollama'),
    }
  }
  const olText = gen.ok ? `Ollama returned an empty response (model: ${model})` : gen.error
  return bothFailed(primaryText, ollamaHint('ollama_generation_failed', olText, model), reason, from)
}

/**
 * Both providers are out.
 *
 * §26 wants each provider's own state named. "AI providers are currently
 * unavailable" alone leaves the user with nothing to act on; "Ollama: not
 * reachable / OpenRouter: out of credits" points at two different fixes.
 */
function bothFailed(primaryText: string, fallbackText: string, reason: FallbackReason, from: ProviderId): RouteFailure {
  const ollamaError      = from === 'ollama' ? primaryText : fallbackText
  const openRouterError  = from === 'ollama' ? fallbackText : primaryText
  return {
    ok: false,
    content: `AI providers are currently unavailable.\n\nOllama:\n${ollamaError}\n\nOpenRouter:\n${openRouterError}`,
    provider: 'none', model: 'none',
    fallbackUsed: true, fallbackReason: reason,
    ollamaError, openRouterError,
  }
}
