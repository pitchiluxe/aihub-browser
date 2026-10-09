import { describe, expect, it } from 'vitest'
import { normalizeOllamaBase, ollamaBaseCandidates } from './ollamaConnection'

describe('normalizeOllamaBase', () => {
  it('uses the local Ollama service by default', () => {
    expect(normalizeOllamaBase('')).toBe('http://127.0.0.1:11434')
  })

  it('accepts host:port values from OLLAMA_HOST', () => {
    expect(normalizeOllamaBase('localhost:11434')).toBe('http://127.0.0.1:11434')
  })

  it('normalizes localhost and strips a trailing API path', () => {
    expect(normalizeOllamaBase('http://localhost:11434/api/')).toBe('http://127.0.0.1:11434')
  })

  it('rejects non-http URLs and malformed values', () => {
    expect(normalizeOllamaBase('file:///tmp/ollama')).toBe('http://127.0.0.1:11434')
    expect(normalizeOllamaBase('not a url')).toBe('http://127.0.0.1:11434')
  })
})

describe('ollamaBaseCandidates', () => {
  it('tries the configured service and the normal local endpoint once each', () => {
    expect(ollamaBaseCandidates('http://localhost:11434')).toEqual(['http://127.0.0.1:11434'])
    expect(ollamaBaseCandidates('http://192.168.1.20:11434'))
      .toEqual(['http://192.168.1.20:11434', 'http://127.0.0.1:11434'])
  })
})
