import { describe, it, expect } from 'vitest'
import {
  estimateTokens, messageTokens, planContext, summarizeCondensed,
  looksLikeRecall, buildRecallBlock,
} from './aiContext'
import type { AIMessage } from '../store/browserStore'

const msg = (role: AIMessage['role'], content: string): AIMessage => ({ role, content })

describe('messageTokens', () => {
  it('charges for the turn scaffolding as well as the text', () => {
    expect(messageTokens(msg('user', ''))).toBeGreaterThan(0)
    expect(messageTokens(msg('user', 'hello there'))).toBeGreaterThan(messageTokens(msg('user', 'hi')))
  })
})

describe('estimateTokens', () => {
  it('scales with length and is zero for nothing', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('hello world')).toBeGreaterThan(0)
    expect(estimateTokens('x'.repeat(360))).toBeGreaterThan(estimateTokens('x'.repeat(36)))
  })
  it('lands in the right ballpark for prose', () => {
    // ~200 words of English is roughly 250-300 tokens; anything in that region
    // is good enough to budget with.
    const prose = 'the quick brown fox jumps over the lazy dog '.repeat(25)
    const tokens = estimateTokens(prose)
    expect(tokens).toBeGreaterThan(200)
    expect(tokens).toBeLessThan(400)
  })
})

describe('planContext', () => {
  it('keeps everything when it fits', () => {
    const messages = [msg('user', 'hi'), msg('assistant', 'hello'), msg('user', 'how are you')]
    const plan = planContext(messages, 1000)
    expect(plan.kept).toHaveLength(3)
    expect(plan.condensed).toHaveLength(0)
  })

  it('drops the OLDEST turns first, never the newest', () => {
    const messages = Array.from({ length: 20 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `message ${i} ${'x'.repeat(200)}`))
    const plan = planContext(messages, 300)
    expect(plan.kept.at(-1)!.content).toContain('message 19')
    expect(plan.condensed[0].content).toContain('message 0')
    expect(plan.kept.length + plan.condensed.length).toBe(20)
  })

  it('never returns a plan without the newest message, even if it alone busts the budget', () => {
    const messages = [msg('user', 'old'), msg('user', 'y'.repeat(50_000))]
    const plan = planContext(messages, 10)
    expect(plan.kept).toHaveLength(1)
    expect(plan.kept[0].content).toHaveLength(50_000)
  })

  it('stays inside the budget when it can', () => {
    const messages = Array.from({ length: 30 }, (_, i) => msg('user', `turn ${i} ${'z'.repeat(360)}`))
    const plan = planContext(messages, 500)
    expect(plan.tokens).toBeLessThanOrEqual(500)
  })

  it('ignores stray system messages — the caller owns the system prompt', () => {
    const plan = planContext([msg('system', 'you are x'), msg('user', 'hi')], 1000)
    expect(plan.kept.every(m => m.role !== 'system')).toBe(true)
    expect(plan.kept).toHaveLength(1)
  })

  it('handles an empty or missing history', () => {
    expect(planContext([], 100)).toEqual({ kept: [], condensed: [], tokens: 0 })
    expect(planContext(undefined as any, 100).kept).toEqual([])
  })
})

describe('summarizeCondensed', () => {
  it('is empty when nothing was dropped', () => {
    expect(summarizeCondensed([])).toBe('')
  })

  it('renders one line per turn, labelled by speaker', () => {
    const out = summarizeCondensed([msg('user', 'what is electron'), msg('assistant', 'a runtime')])
    expect(out).toContain('### Earlier in this conversation')
    expect(out).toContain('- User: what is electron')
    expect(out).toContain('- You: a runtime')
  })

  it('truncates long turns and keeps the most recent ones within the cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => msg('user', `turn ${i} ${'w'.repeat(300)}`))
    const out = summarizeCondensed(many, 400)
    expect(out.length).toBeLessThan(600)
    expect(out).toContain('turn 49')
    expect(out).not.toContain('turn 0 ')
  })
})

describe('looksLikeRecall', () => {
  it('spots questions about something the user already read', () => {
    for (const q of [
      'what was that article about renderer crashes',
      'find the page I read yesterday about pricing',
      'I saw a post about this last week, which was it',
      'where did I read about scrypt',
      'remind me of that documentation page for zustand',
    ]) {
      expect(looksLikeRecall(q), q).toBe(true)
    }
  })

  it('leaves ordinary questions to the normal path', () => {
    for (const q of [
      'what is the capital of Kenya',
      'write me a python script',
      'summarize this page',
      'open youtube',
    ]) {
      expect(looksLikeRecall(q), q).toBe(false)
    }
  })

  it('is safe on empty input', () => {
    expect(looksLikeRecall('')).toBe(false)
    expect(looksLikeRecall(undefined as any)).toBe(false)
  })
})

describe('buildRecallBlock', () => {
  const hits = [
    { title: 'Chromium renderer crashes', url: 'https://a.com/1', snippet: 'ACCESS_VIOLATION in the tab process', ts: Date.UTC(2026, 6, 1) },
    { title: 'Electron 34 notes', url: 'https://b.com/2' },
  ]

  it('lists each page with its url so the answer can cite it', () => {
    const block = buildRecallBlock(hits)
    expect(block).toContain('https://a.com/1')
    expect(block).toContain('Chromium renderer crashes')
    expect(block).toContain('ACCESS_VIOLATION')
  })

  it('tells the model what to do when nothing fits', () => {
    expect(buildRecallBlock(hits)).toContain('search the web instead')
  })

  it('is empty for no hits, so no dead section reaches the prompt', () => {
    expect(buildRecallBlock([])).toBe('')
    expect(buildRecallBlock(undefined as any)).toBe('')
    expect(buildRecallBlock([{ title: 'x', url: '' }])).toBe('')
  })

  it('caps how many pages it injects', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `https://x.com/${i}` }))
    const block = buildRecallBlock(many, 3)
    expect(block.match(/https:\/\/x\.com/g)).toHaveLength(3)
  })
})
