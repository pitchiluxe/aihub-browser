// The OpenRouter model catalog, normalised.
//
// OpenRouter adds and retires models without notice — a slug hardcoded today
// 404s next month with "unavailable for free", and the cost is a full dead
// round-trip per stale entry before anything answers. So nothing here is a
// list of model names: this module takes whatever `GET /models` returned and
// turns it into something the router and the Settings UI can both reason
// about (is it free, how big is its context, can it call tools).
//
// Kept free of Electron and of `fetch` so it can be unit-tested against
// captured API payloads.

/** OpenRouter's own meta-router: it picks among the free models available at
 *  request time and can filter them by what the request needs. It is not
 *  listed in `/models` as a free variant, so every "does this model exist"
 *  check has to special-case it. */
export const OPENROUTER_FREE_AUTO = 'openrouter/free'

export interface ModelCapabilities {
  vision: boolean
  tools: boolean
  reasoning: boolean
  structuredOutput: boolean
  /** Trained for code — a naming signal, since the API exposes no such flag. */
  coding: boolean
}

export interface CatalogModel {
  id: string
  name: string
  description: string
  contextLength: number
  /** USD per token, as numbers. OpenRouter sends them as decimal strings. */
  pricing: { prompt: number; completion: number }
  free: boolean
  deprecated: boolean
  inputModalities: string[]
  outputModalities: string[]
  supportedParameters: string[]
  capabilities: ModelCapabilities
  /** Unix seconds, 0 when absent. */
  created: number
}

export type ModelFilter =
  | 'all' | 'free' | 'paid'
  | 'vision' | 'tools' | 'reasoning' | 'coding' | 'longContext'

/** Below this a "long context" claim isn't worth making. */
const LONG_CONTEXT_TOKENS = 100_000

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Free means the current pricing is zero — not that the name says "free".
 *
 * Both halves matter. A model can carry the `:free` suffix (OpenRouter's own
 * marker for a zero-cost variant) while its pricing block is missing from the
 * payload, and a model can be zero-priced without the suffix. Matching the
 * word "free" anywhere in the name would be the trap the spec warns about —
 * `some-vendor/freeform-7b` is not free.
 */
export function isFreeModel(m: { id?: string; pricing?: { prompt?: unknown; completion?: unknown } }): boolean {
  const id = String(m?.id || '')
  if (id === OPENROUTER_FREE_AUTO) return true
  if (/:free$/.test(id)) return true
  const p = m?.pricing
  if (!p || p.prompt == null || p.completion == null) return false
  return num(p.prompt) === 0 && num(p.completion) === 0
}

/** A model whose retirement is this close should not be picked fresh. */
const RETIREMENT_HORIZON_MS = 30 * 24 * 60 * 60_000

/**
 * Retirement signal.
 *
 * There is no `deprecated` boolean in the live payload — what OpenRouter
 * actually ships is `expiration_date`, and it uses a far-future sentinel
 * ("2098-12-31") for models with no end date, so the field's mere presence
 * means nothing. Only a date inside the next month is a real warning. The
 * description is read too, since a model can be announced as deprecated in
 * prose before a date is set.
 */
function isDeprecated(m: any, now = Date.now()): boolean {
  if (m?.deprecated === true) return true
  const exp = Date.parse(String(m?.expiration_date || ''))
  if (Number.isFinite(exp) && exp - now < RETIREMENT_HORIZON_MS) return true
  return /\bdeprecat/i.test(String(m?.description || ''))
}

function deriveCapabilities(m: any, id: string): ModelCapabilities {
  const params: string[] = Array.isArray(m?.supported_parameters) ? m.supported_parameters : []
  const inputs: string[] = Array.isArray(m?.architecture?.input_modalities) ? m.architecture.input_modalities : []
  const has = (p: string) => params.includes(p)
  return {
    vision: inputs.includes('image'),
    tools: has('tools') || has('tool_choice'),
    // Three markers, because the API gives three: a `reasoning` config object
    // on the model, the reasoning parameters it accepts, and — for families
    // that reason without advertising it — the name.
    reasoning: !!m?.reasoning || has('reasoning') || has('include_reasoning')
      || /(reasoning|thinking|-r1\b|\bqwq\b)/i.test(id),
    structuredOutput: has('response_format') || has('structured_outputs'),
    coding: /(coder?|code|codestral|devstral|laguna)/i.test(id),
  }
}

/** Turn a raw `GET /models` payload into typed entries. Junk rows are dropped
 *  rather than allowed through as half-populated models. */
export function normalizeModels(raw: unknown): CatalogModel[] {
  const rows: any[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : []
  const out: CatalogModel[] = []
  for (const m of rows) {
    const id = String(m?.id || '')
    if (!id) continue
    out.push({
      id,
      name: String(m?.name || id),
      description: String(m?.description || ''),
      contextLength: num(m?.context_length ?? m?.top_provider?.context_length),
      pricing: { prompt: num(m?.pricing?.prompt), completion: num(m?.pricing?.completion) },
      free: isFreeModel(m),
      deprecated: isDeprecated(m),
      inputModalities: Array.isArray(m?.architecture?.input_modalities) ? m.architecture.input_modalities : [],
      outputModalities: Array.isArray(m?.architecture?.output_modalities) ? m.architecture.output_modalities : [],
      supportedParameters: Array.isArray(m?.supported_parameters) ? m.supported_parameters : [],
      capabilities: deriveCapabilities(m, id),
      created: num(m?.created),
    })
  }
  return out
}

export function filterModels(models: CatalogModel[], filter: ModelFilter): CatalogModel[] {
  switch (filter) {
    case 'free':        return models.filter(m => m.free)
    case 'paid':        return models.filter(m => !m.free)
    case 'vision':      return models.filter(m => m.capabilities.vision)
    case 'tools':       return models.filter(m => m.capabilities.tools)
    case 'reasoning':   return models.filter(m => m.capabilities.reasoning)
    case 'coding':      return models.filter(m => m.capabilities.coding)
    case 'longContext': return models.filter(m => m.contextLength >= LONG_CONTEXT_TOKENS)
    default:            return models
  }
}

/**
 * Which models can serve a request that needs these capabilities.
 *
 * Agents differ: the XAUUSD agent wants long context and reasoning, a
 * form-filling agent needs tool calling, a screenshot agent needs vision.
 * Only requirements set to `true` constrain the result — `{ vision: false }`
 * means "doesn't need vision", not "must not have it".
 */
export function filterByCapability(
  models: CatalogModel[],
  required: Partial<ModelCapabilities> & { minContext?: number },
): CatalogModel[] {
  return models.filter(m => {
    if (required.vision && !m.capabilities.vision) return false
    if (required.tools && !m.capabilities.tools) return false
    if (required.reasoning && !m.capabilities.reasoning) return false
    if (required.structuredOutput && !m.capabilities.structuredOutput) return false
    if (required.coding && !m.capabilities.coding) return false
    if (required.minContext && m.contextLength < required.minContext) return false
    return true
  })
}

/**
 * Is this model still selectable?
 *
 * `openrouter/free` never appears in the catalog as an individual entry — it
 * is a router, not a model — so requiring it to be listed would permanently
 * mark the recommended default as unavailable. An empty catalog means the
 * fetch failed, and a failed fetch must not invalidate the user's saved
 * choice (§33), so everything is treated as present.
 */
export function modelExists(models: CatalogModel[], id: string): boolean {
  if (!id) return false
  if (id === OPENROUTER_FREE_AUTO) return true
  if (!models.length) return true
  return models.some(m => m.id === id)
}

export function findModel(models: CatalogModel[], id: string): CatalogModel | undefined {
  return models.find(m => m.id === id)
}

/** Per-token price → the per-million figure OpenRouter quotes in its own UI. */
export function formatPricePerMillion(perToken: number): string {
  if (!perToken) return '$0'
  const perM = perToken * 1_000_000
  // Sub-cent rates need more places or they all render as "$0.00".
  const digits = perM < 0.01 ? 4 : perM < 1 ? 3 : 2
  return `$${perM.toFixed(digits)}`
}

/** "131K" / "1M" — context lengths are read at a glance, not compared exactly. */
export function formatContext(tokens: number): string {
  if (!tokens) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

/** One-line label for a model row in Settings. */
export function describeModel(m: CatalogModel): string {
  const bits = [m.free ? 'FREE' : 'PAID', `Context: ${formatContext(m.contextLength)}`]
  if (m.capabilities.tools) bits.push('Tools')
  if (m.capabilities.vision) bits.push('Vision')
  if (m.capabilities.reasoning) bits.push('Reasoning')
  if (!m.free) {
    bits.push(`In ${formatPricePerMillion(m.pricing.prompt)}/1M`)
    bits.push(`Out ${formatPricePerMillion(m.pricing.completion)}/1M`)
  }
  if (m.deprecated) bits.push('DEPRECATED')
  return bits.join(' · ')
}
