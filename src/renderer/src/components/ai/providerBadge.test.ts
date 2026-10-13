import { describe, it, expect } from 'vitest'
import { providerBadge } from './providerBadge'

describe('providerBadge — the AI panel says who will actually answer', () => {
  it('your own key wins, whatever Ollama is doing', () => {
    expect(providerBadge({ ollama: { running: true, models: ['llama3.2:3b'] }, hasClaudeKey: true })).toMatchObject({ tone: 'key', label: 'Your key · Claude', banner: null })
    expect(providerBadge({ ollama: { running: false, models: [] }, hasChatGptKey: true })).toMatchObject({ tone: 'key', label: 'Your key · ChatGPT', banner: null })
  })
  it('Ollama running: local, with the model when known', () => {
    expect(providerBadge({ ollama: { running: true, models: ['llama3.2:3b'] } })).toMatchObject({ tone: 'local', label: 'Local · Ollama', banner: null })
  })
  it('Ollama not running: cloud, with the hint', () => {
    const b = providerBadge({ ollama: { running: false, models: [] } })
    expect(b.tone).toBe('cloud')
    expect(b.banner).toMatch(/start ollama|install ollama/i)
  })
  it('still checking', () => {
    expect(providerBadge({ ollama: null }).tone).toBe('checking')
  })
})
