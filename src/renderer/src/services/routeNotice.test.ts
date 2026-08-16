import { describe, it, expect } from 'vitest'
import { fallbackLine, withFallbackNotice } from './routeNotice'

describe('fallbackLine', () => {
  it('says nothing when the primary provider answered', () => {
    expect(fallbackLine({ provider: 'ollama', model: 'mistral:7b', fallbackUsed: false })).toBe('')
  })

  it('names the provider, the model and the reason', () => {
    const line = fallbackLine({
      provider: 'openrouter', model: 'openrouter/free',
      fallbackUsed: true, fallbackReason: 'ollama_unavailable',
    })
    expect(line).toContain('OpenRouter fallback')
    expect(line).toContain('openrouter/free')
    expect(line).toContain('local Ollama is not running')
  })

  it('works the other way round too', () => {
    const line = fallbackLine({
      provider: 'ollama', model: 'llama3.2:3b',
      fallbackUsed: true, fallbackReason: 'openrouter_failed',
    })
    expect(line).toContain('local Ollama fallback')
  })

  it('stays quiet for a total failure — that message speaks for itself', () => {
    expect(fallbackLine({ provider: 'none', fallbackUsed: true })).toBe('')
    expect(fallbackLine(null)).toBe('')
  })
})

describe('withFallbackNotice', () => {
  it('leaves the answer untouched when no fallback happened', () => {
    expect(withFallbackNotice('Gold is at 4100.', { provider: 'ollama', fallbackUsed: false }))
      .toBe('Gold is at 4100.')
  })

  it('puts the notice above the answer', () => {
    const out = withFallbackNotice('Gold is at 4100.', {
      provider: 'openrouter', model: 'openrouter/free',
      fallbackUsed: true, fallbackReason: 'ollama_unavailable',
    })
    expect(out.startsWith('_Answered by the OpenRouter fallback')).toBe(true)
    expect(out.endsWith('Gold is at 4100.')).toBe(true)
  })
})
