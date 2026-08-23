import { describe, it, expect } from 'vitest'
import {
  normalizeModels, filterModels, filterByCapability, isFreeModel,
  modelExists, formatPricePerMillion, formatContext, describeModel,
  OPENROUTER_FREE_AUTO, classifyOpenRouterStatus,
} from './openRouterCatalog'

// Shaped like a real `GET /models` payload: prices are decimal STRINGS, and
// capabilities have to be inferred from supported_parameters/architecture
// rather than read off a flag.
const PAYLOAD = {
  data: [
    {
      id: 'openai/gpt-oss-120b:free',
      name: 'OpenAI — GPT-OSS 120B',
      description: 'An open-weight model.',
      context_length: 131072,
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'response_format', 'reasoning'],
      created: 1750000000,
    },
    {
      id: 'anthropic/claude-sonnet-4',
      name: 'Anthropic — Claude Sonnet 4',
      description: 'A paid frontier model.',
      context_length: 200000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'tool_choice', 'response_format'],
      created: 1760000000,
    },
    {
      id: 'vendor/zero-priced-no-suffix',
      name: 'Zero priced, no suffix',
      context_length: 8192,
      pricing: { prompt: '0.0', completion: '0' },
      architecture: { input_modalities: ['text'] },
      supported_parameters: [],
    },
    {
      id: 'vendor/freeform-writer-7b',
      name: 'Freeform Writer 7B',
      description: 'Long-form prose.',
      context_length: 32768,
      pricing: { prompt: '0.0000002', completion: '0.0000006' },
      architecture: { input_modalities: ['text'] },
      supported_parameters: [],
    },
    {
      id: 'vendor/old-model',
      name: 'Old Model',
      description: 'This model is deprecated and will be removed.',
      context_length: 4096,
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: [],
    },
    {
      // OpenRouter's "no end date" sentinel — present, but meaningless.
      id: 'vendor/evergreen',
      name: 'Evergreen',
      context_length: 65536,
      expiration_date: '2098-12-31',
      pricing: { prompt: '0.000001', completion: '0.000002' },
      supported_parameters: [],
    },
    { name: 'no id at all', pricing: { prompt: '0', completion: '0' } },
  ],
}

describe('normalizeModels', () => {
  const models = normalizeModels(PAYLOAD)

  it('drops rows without an id rather than passing through half a model', () => {
    expect(models).toHaveLength(6)
    expect(models.every(m => !!m.id)).toBe(true)
  })

  it('parses the decimal-string prices into numbers', () => {
    const claude = models.find(m => m.id === 'anthropic/claude-sonnet-4')!
    expect(claude.pricing).toEqual({ prompt: 0.000003, completion: 0.000015 })
  })

  it('derives capabilities from the payload, not from guesswork', () => {
    const claude = models.find(m => m.id === 'anthropic/claude-sonnet-4')!
    expect(claude.capabilities).toMatchObject({ vision: true, tools: true, structuredOutput: true })

    const oss = models.find(m => m.id === 'openai/gpt-oss-120b:free')!
    expect(oss.capabilities).toMatchObject({ vision: false, tools: true, reasoning: true })
  })

  it('reads deprecation out of the description when there is no flag', () => {
    expect(models.find(m => m.id === 'vendor/old-model')!.deprecated).toBe(true)
    expect(models.find(m => m.id === 'anthropic/claude-sonnet-4')!.deprecated).toBe(false)
  })

  it('ignores the far-future expiration sentinel', () => {
    // The live catalog stamps "2098-12-31" on models with no end date. Treating
    // the field's presence as deprecation would flag half the catalog.
    expect(models.find(m => m.id === 'vendor/evergreen')!.deprecated).toBe(false)
  })

  it('flags a model whose expiration date is imminent', () => {
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString().slice(0, 10)
    const [m] = normalizeModels([{ id: 'vendor/going-away', expiration_date: soon }])
    expect(m.deprecated).toBe(true)
  })

  it('survives junk input', () => {
    expect(normalizeModels(null)).toEqual([])
    expect(normalizeModels({})).toEqual([])
    expect(normalizeModels([{ id: 'a/b' }])[0].contextLength).toBe(0)
  })
})

// §7 / Test 6 + 7
describe('free model detection', () => {
  it('recognises the :free variant suffix', () => {
    expect(isFreeModel({ id: 'openai/gpt-oss-20b:free' })).toBe(true)
  })

  it('recognises zero pricing without the suffix', () => {
    expect(isFreeModel({ id: 'vendor/x', pricing: { prompt: '0.0', completion: '0' } })).toBe(true)
  })

  it('does NOT treat "free" inside a name as free', () => {
    // The trap the spec warns about: a paid model whose slug happens to
    // contain the word.
    expect(isFreeModel({ id: 'vendor/freeform-writer-7b', pricing: { prompt: '0.0000002', completion: '0.0000006' } })).toBe(false)
  })

  it('treats the meta-router as free', () => {
    expect(isFreeModel({ id: OPENROUTER_FREE_AUTO })).toBe(true)
  })

  it('splits the catalog into free and paid', () => {
    const models = normalizeModels(PAYLOAD)
    const free = filterModels(models, 'free').map(m => m.id)
    const paid = filterModels(models, 'paid').map(m => m.id)

    expect(free).toContain('openai/gpt-oss-120b:free')
    expect(free).toContain('vendor/zero-priced-no-suffix')
    expect(paid).toContain('anthropic/claude-sonnet-4')
    expect(paid).toContain('vendor/freeform-writer-7b')
    expect(free.concat(paid)).toHaveLength(models.length)
  })
})

describe('capability filters', () => {
  const models = normalizeModels(PAYLOAD)

  it('filters by the visible capability categories', () => {
    expect(filterModels(models, 'vision').map(m => m.id)).toEqual(['anthropic/claude-sonnet-4'])
    expect(filterModels(models, 'tools')).toHaveLength(2)
    expect(filterModels(models, 'longContext').map(m => m.id))
      .toEqual(['openai/gpt-oss-120b:free', 'anthropic/claude-sonnet-4'])
    expect(filterModels(models, 'all')).toHaveLength(models.length)
  })

  it('only constrains on requirements that are actually required', () => {
    // { vision: false } means "doesn't need vision", not "must not have it".
    expect(filterByCapability(models, { vision: false })).toHaveLength(models.length)
    expect(filterByCapability(models, { tools: true, vision: true }).map(m => m.id))
      .toEqual(['anthropic/claude-sonnet-4'])
  })

  it('honours a minimum context requirement', () => {
    expect(filterByCapability(models, { minContext: 150_000 }).map(m => m.id))
      .toEqual(['anthropic/claude-sonnet-4'])
  })
})

// §17 / §33
describe('modelExists', () => {
  const models = normalizeModels(PAYLOAD)

  it('accepts openrouter/free even though it is not a catalog entry', () => {
    expect(modelExists(models, OPENROUTER_FREE_AUTO)).toBe(true)
  })

  it('rejects a slug the catalog no longer carries', () => {
    expect(modelExists(models, 'vendor/retired')).toBe(false)
  })

  it('does not invalidate a saved selection when the catalog fetch failed', () => {
    expect(modelExists([], 'vendor/anything')).toBe(true)
  })
})

describe('display helpers', () => {
  it('quotes prices per million tokens', () => {
    expect(formatPricePerMillion(0)).toBe('$0')
    expect(formatPricePerMillion(0.000003)).toBe('$3.00')
    expect(formatPricePerMillion(0.0000002)).toBe('$0.200')
  })

  it('abbreviates context lengths', () => {
    expect(formatContext(131072)).toBe('131K')
    expect(formatContext(1_000_000)).toBe('1M')
    expect(formatContext(0)).toBe('—')
  })

  it('describes a model in terms a user can act on', () => {
    const models = normalizeModels(PAYLOAD)
    expect(describeModel(models.find(m => m.id === 'openai/gpt-oss-120b:free')!))
      .toBe('FREE · Context: 131K · Tools · Reasoning')
    expect(describeModel(models.find(m => m.id === 'anthropic/claude-sonnet-4')!))
      .toBe('PAID · Context: 200K · Tools · Vision · In $3.00/1M · Out $15.00/1M')
  })
})

describe('classifyOpenRouterStatus', () => {
  it('treats 2xx as a usable answer', () => {
    expect(classifyOpenRouterStatus(200)).toEqual({ kind: 'ok' })
    expect(classifyOpenRouterStatus(201)).toEqual({ kind: 'ok' })
  })

  // The regression this function exists for: a model gated to approved apps
  // returns 403, which used to be classified as fatal and ended the chain on
  // its first candidate.
  it('skips a model gated to approved apps rather than ending the chain', () => {
    expect(classifyOpenRouterStatus(403)).toEqual({ kind: 'skip', reason: 'restricted' })
  })

  it('skips the other per-model refusals', () => {
    expect(classifyOpenRouterStatus(402)).toEqual({ kind: 'skip', reason: 'credits' })
    expect(classifyOpenRouterStatus(404)).toEqual({ kind: 'skip', reason: 'missing' })
    expect(classifyOpenRouterStatus(429)).toEqual({ kind: 'skip', reason: 'rate_limited' })
  })

  // A bad key or a broken upstream fails identically for every candidate, so
  // trying the remaining seventeen is pure latency.
  it('stops the chain on account-wide and server failures', () => {
    expect(classifyOpenRouterStatus(401)).toEqual({ kind: 'fatal' })
    expect(classifyOpenRouterStatus(400)).toEqual({ kind: 'fatal' })
    expect(classifyOpenRouterStatus(500)).toEqual({ kind: 'fatal' })
    expect(classifyOpenRouterStatus(503)).toEqual({ kind: 'fatal' })
  })
})
