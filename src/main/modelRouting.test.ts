import { describe, it, expect } from 'vitest'
import { pickAgentModel, isTooSmallForAgentWork, suggestFasterModel, ModelInfo } from './modelRouting'

// Mirrors a real machine's installed set (this is the user's own list).
const INSTALLED: ModelInfo[] = [
  { name: 'gemma4:12b',            tools: true,  params: 11.9,   cloud: false },
  { name: 'smollm2:135m',          tools: false, params: 0.135,  cloud: false },
  { name: 'mistral:7b',            tools: true,  params: 7.2,    cloud: false },
  { name: 'llama3.2:3b',           tools: true,  params: 3.2,    cloud: false },
  { name: 'qwen2.5:14b',           tools: true,  params: 14.8,   cloud: false },
  { name: 'deepseek-v4-pro:cloud', tools: true,  params: 0,      cloud: true  },
  { name: 'qwen2.5:7b',            tools: true,  params: 7.6,    cloud: false },
  { name: 'llama3.1:8b',           tools: true,  params: 8,      cloud: false },
  { name: 'gpt-oss:20b',           tools: true,  params: 20.9,   cloud: false },
  { name: 'tinyllama:latest',      tools: false, params: 1,      cloud: false },
]

describe('pickAgentModel', () => {
  it('upgrades away from a 3B model that cannot drive tools', () => {
    const picked = pickAgentModel(INSTALLED, 'llama3.2:3b')
    expect(picked).not.toBe('llama3.2:3b')
    expect(picked).toBe('qwen2.5:7b')
  })

  it('keeps a configured model that is already capable', () => {
    expect(pickAgentModel(INSTALLED, 'qwen2.5:14b')).toBe('qwen2.5:14b')
    expect(pickAgentModel(INSTALLED, 'gpt-oss:20b')).toBe('gpt-oss:20b')
  })

  it('never picks a model without tool capability', () => {
    const picked = pickAgentModel(INSTALLED, 'llama3.2:3b')
    expect(['smollm2:135m', 'tinyllama:latest']).not.toContain(picked)
  })

  it('prefers a local model over a cloud one', () => {
    const picked = pickAgentModel(INSTALLED, 'llama3.2:3b')
    expect(INSTALLED.find(m => m.name === picked)!.cloud).toBe(false)
  })

  it('prefers the smallest capable model over the biggest', () => {
    const picked = pickAgentModel(INSTALLED, 'llama3.2:3b')!
    expect(INSTALLED.find(m => m.name === picked)!.params).toBeLessThanOrEqual(8)
  })

  it('falls back to a large model when nothing mid-sized is installed', () => {
    const sparse: ModelInfo[] = [
      { name: 'llama3.2:3b', tools: true, params: 3.2, cloud: false },
      { name: 'gpt-oss:20b', tools: true, params: 20.9, cloud: false },
    ]
    expect(pickAgentModel(sparse, 'llama3.2:3b')).toBe('gpt-oss:20b')
  })

  it('returns null when nothing installed can do tool work', () => {
    const weak: ModelInfo[] = [
      { name: 'llama3.2:3b', tools: true, params: 3.2, cloud: false },
      { name: 'tinyllama:latest', tools: false, params: 1, cloud: false },
    ]
    expect(pickAgentModel(weak, 'llama3.2:3b')).toBeNull()
  })

  it('handles an unknown model list without throwing', () => {
    expect(pickAgentModel([], 'llama3.2:3b')).toBeNull()
  })
})

describe('isTooSmallForAgentWork', () => {
  it('flags the small model that produced the original refusal', () => {
    expect(isTooSmallForAgentWork(INSTALLED, 'llama3.2:3b')).toBe(true)
    expect(isTooSmallForAgentWork(INSTALLED, 'tinyllama:latest')).toBe(true)
  })
  it('does not flag a capable one', () => {
    expect(isTooSmallForAgentWork(INSTALLED, 'qwen2.5:7b')).toBe(false)
    expect(isTooSmallForAgentWork(INSTALLED, 'gemma4:12b')).toBe(false)
  })
  it('says nothing about a model it has never seen', () => {
    expect(isTooSmallForAgentWork(INSTALLED, 'something-else')).toBe(false)
  })
})

describe('suggestFasterModel', () => {
  // The machine that produced the bug report: no discrete GPU, eight models
  // installed, mistral:7b configured and unable to start answering in 120s.
  const INSTALLED = [
    { name: 'gemma4:12b',       tools: true,  params: 11.9,  cloud: false },
    { name: 'qwen2.5:14b',      tools: true,  params: 14.8,  cloud: false },
    { name: 'mistral:7b',       tools: true,  params: 7.2,   cloud: false },
    { name: 'llama3.2:3b',      tools: true,  params: 3.2,   cloud: false },
    { name: 'smollm2:135m',     tools: false, params: 0.135, cloud: false },
    { name: 'deepseek-v4:cloud',tools: true,  params: 0,     cloud: true  },
  ]

  it('names the largest model that is still smaller than the one that timed out', () => {
    expect(suggestFasterModel(INSTALLED, 'mistral:7b')).toBe('llama3.2:3b')
  })

  it('gives up as little quality as possible', () => {
    // 12B failed, so 7.2B is the answer — not the tiny one.
    expect(suggestFasterModel(INSTALLED, 'gemma4:12b')).toBe('mistral:7b')
  })

  it('returns null when nothing smaller is installed', () => {
    expect(suggestFasterModel(INSTALLED, 'smollm2:135m')).toBeNull()
  })

  it('never suggests a cloud model, which is not slow for this reason', () => {
    const onlyCloudIsSmaller = [
      { name: 'mistral:7b',        tools: true, params: 7.2, cloud: false },
      { name: 'deepseek-v4:cloud', tools: true, params: 1,   cloud: true  },
    ]
    expect(suggestFasterModel(onlyCloudIsSmaller, 'mistral:7b')).toBeNull()
  })

  it('declines to guess when the failed model has no known size', () => {
    expect(suggestFasterModel(INSTALLED, 'something-unlisted')).toBeNull()
  })
})
