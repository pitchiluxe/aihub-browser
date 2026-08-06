import { describe, it, expect } from 'vitest'
import { orderFreeModels, isReasoningModel } from './modelRouting'

const CURATED = [
  'qwen/qwen3-coder:free',
  'openai/gpt-oss-120b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
]

describe('isReasoningModel', () => {
  it('spots the models that think before answering', () => {
    // The exact model that produced "the AI response couldn't be parsed".
    expect(isReasoningModel('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')).toBe(true)
    expect(isReasoningModel('deepseek/deepseek-r1:free')).toBe(true)
    expect(isReasoningModel('qwen/qwq-32b:free')).toBe(true)
    expect(isReasoningModel('some/model-thinking:free')).toBe(true)
  })

  it('leaves ordinary instruct models alone', () => {
    expect(isReasoningModel('qwen/qwen3-coder:free')).toBe(false)
    expect(isReasoningModel('meta-llama/llama-3.3-70b-instruct:free')).toBe(false)
  })
})

describe('orderFreeModels', () => {
  const live = [
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'some/other-model:free',
    'qwen/qwen3-coder:free',
    'deepseek/deepseek-r1:free',
    'openai/gpt-oss-120b:free',
  ]

  it('leads with the curated models that are still live', () => {
    const order = orderFreeModels(live, undefined, CURATED)
    expect(order[0]).toBe('qwen/qwen3-coder:free')
    expect(order[1]).toBe('openai/gpt-oss-120b:free')
  })

  it('drops curated models the catalog no longer offers', () => {
    const order = orderFreeModels(['qwen/qwen3-coder:free'], undefined, CURATED)
    expect(order).toEqual(['qwen/qwen3-coder:free'])
  })

  it('puts reasoning models LAST — the bug that broke extension generation', () => {
    const order = orderFreeModels(live, undefined, CURATED)
    const nemotron = order.indexOf('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')
    const plain = order.indexOf('some/other-model:free')
    expect(nemotron).toBeGreaterThan(plain)
    expect(order[order.length - 1]).toMatch(/reasoning|r1/)
  })

  it('never puts a reasoning model first for structured output, even if configured', () => {
    const order = orderFreeModels(live, 'deepseek/deepseek-r1:free', CURATED, { structured: true })
    expect(isReasoningModel(order[0])).toBe(false)
  })

  it('honours the user’s configured model for ordinary chat', () => {
    const order = orderFreeModels(live, 'some/other-model:free', CURATED)
    expect(order[0]).toBe('some/other-model:free')
  })

  it('still offers reasoning models when nothing else exists — some answer beats none', () => {
    const onlyReasoning = ['deepseek/deepseek-r1:free']
    expect(orderFreeModels(onlyReasoning, undefined, CURATED, { structured: true })).toEqual(onlyReasoning)
  })

  it('falls back to the curated list when the catalog could not be fetched', () => {
    const order = orderFreeModels([], 'qwen/qwen3-coder:free', CURATED)
    expect(order[0]).toBe('qwen/qwen3-coder:free')
    expect(order.length).toBeGreaterThan(1)
  })

  it('returns no duplicates', () => {
    const order = orderFreeModels(live, 'qwen/qwen3-coder:free', CURATED)
    expect(new Set(order).size).toBe(order.length)
  })
})

describe('unsuitable models — never chat candidates', () => {
  it('drops classifiers and vision models the free tier actually lists', () => {
    const live = [
      'nvidia/nemotron-3.5-content-safety:free',
      'nvidia/nemotron-nano-12b-v2-vl:free',
      'google/gemma-4-31b-it:free',
    ]
    const order = orderFreeModels(live, undefined, ['google/gemma-4-31b-it:free'])
    expect(order).toEqual(['google/gemma-4-31b-it:free'])
  })

  it('keeps ordinary models with similar-looking names', () => {
    const live = ['nvidia/nemotron-3-nano-30b-a3b:free']
    expect(orderFreeModels(live, undefined, [])).toEqual(live)
  })
})
