import { describe, it, expect } from 'vitest'
import { directKeysFirst } from './providerOrder'

describe('directKeysFirst — the user\'s own API key takes priority over everything', () => {
  it('no keys: nothing direct (Ollama, then OpenRouter, as configured)', () => {
    expect(directKeysFirst({ claudeKey: '', chatGptKey: '' }, {})).toEqual([])
  })
  it('a Claude key goes first; ChatGPT next; both before Ollama/OpenRouter', () => {
    expect(directKeysFirst({ claudeKey: 'sk-ant-x', chatGptKey: '' }, {})).toEqual(['claude'])
    expect(directKeysFirst({ claudeKey: '', chatGptKey: 'sk-x' }, {})).toEqual(['chatgpt'])
    expect(directKeysFirst({ claudeKey: 'sk-ant-x', chatGptKey: 'sk-x' }, {})).toEqual(['claude', 'chatgpt'])
  })
  it('requests with pictures or agent tools stay on the router (the direct calls are text-only)', () => {
    expect(directKeysFirst({ claudeKey: 'sk-ant-x', chatGptKey: 'sk-x' }, { needsTools: true })).toEqual([])
    expect(directKeysFirst({ claudeKey: 'sk-ant-x', chatGptKey: 'sk-x' }, { carriesImages: true })).toEqual([])
  })
  it('whitespace-only keys do not count', () => {
    expect(directKeysFirst({ claudeKey: '   ', chatGptKey: '\n' }, {})).toEqual([])
  })
})
