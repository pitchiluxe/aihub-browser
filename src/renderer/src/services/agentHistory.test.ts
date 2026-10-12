import { describe, it, expect } from 'vitest'
import { toModelHistory, digestToolResults, clampToolResult, isUiOnlyReply } from './agentHistory'

describe('toModelHistory', () => {
  it('drops empty assistant turns — the source of OpenRouter "must have at least 1 item"', () => {
    const out = toModelHistory([
      { role: 'assistant', content: 'Hi, I am your agent.' },
      { role: 'user', content: 'Read my resume' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Here are my preferences' },
    ])
    expect(out.every(m => m.content.trim().length > 0)).toBe(true)
  })

  it('never replays provider failures or app notices as things the agent said', () => {
    const out = toModelHistory([
      { role: 'user', content: 'Find jobs' },
      { role: 'assistant', content: 'AI providers are currently unavailable.\n\nOllama:\ntimeout' },
      { role: 'assistant', content: 'Error communicating with AI.' },
      { role: 'assistant', content: 'whatever', failed: true },
      { role: 'user', content: 'Try again' },
    ])
    expect(out.map(m => m.role)).toEqual(['user'])
    expect(out[0].content).toContain('Find jobs')
    expect(out[0].content).toContain('Try again')
  })

  it('strips the fallback provenance line but keeps the answer', () => {
    const out = toModelHistory([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '_Answered by the OpenRouter fallback (x) — local Ollama could not answer._\n\nHello there.' },
    ])
    expect(out[1].content).toBe('Hello there.')
  })

  it('carries earlier tool results forward so the agent still knows what it read', () => {
    const out = toModelHistory([
      { role: 'user', content: 'Read my resume' },
      { role: 'assistant', content: '', toolLog: '[Tool results]\nread_file → Okta, Active Directory' },
      { role: 'user', content: 'Now find jobs' },
    ])
    expect(out).toHaveLength(3)
    expect(out[1].role).toBe('assistant')
    expect(out[1].content).toContain('Active Directory')
  })

  it('merges consecutive same-role turns so roles alternate', () => {
    const out = toModelHistory([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b', images: ['data:image/png;base64,x'] },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe('a\n\nb')
    expect(out[0].images).toEqual(['data:image/png;base64,x'])
  })
})

describe('isUiOnlyReply', () => {
  it('recognises the app-generated stop and error lines', () => {
    expect(isUiOnlyReply('Stopped after reaching the turn limit for this run.')).toBe(true)
    expect(isUiOnlyReply('Failed to start agent. Check your AI configuration in Settings.')).toBe(true)
    expect(isUiOnlyReply('Here are 10 jobs.')).toBe(false)
  })
})

describe('clampToolResult', () => {
  it('truncates long text fields and says so', () => {
    const r = clampToolResult({ path: 'a.pdf', text: 'x'.repeat(50_000) }, 1000) as any
    expect(r.text.length).toBeLessThan(1100)
    expect(r.text).toContain('truncated')
    expect(r.path).toBe('a.pdf')
  })

  it('leaves short results alone', () => {
    expect(clampToolResult({ ok: true, text: 'short' }, 1000)).toEqual({ ok: true, text: 'short' })
  })
})

describe('digestToolResults', () => {
  it('summarises each call with its key result, within budget', () => {
    const d = digestToolResults([
      { tool: 'read_file', path: 'C:/r.pdf', text: 'Skills: Okta, Azure AD. '.repeat(1000) },
      { tool: 'open_tab', error: 'blocked' },
    ], 2000)
    expect(d.length).toBeLessThanOrEqual(2200)
    expect(d).toContain('read_file')
    expect(d).toContain('Okta')
    expect(d).toContain('error: blocked')
  })

  it('returns empty for no results', () => {
    expect(digestToolResults([], 1000)).toBe('')
  })
})
