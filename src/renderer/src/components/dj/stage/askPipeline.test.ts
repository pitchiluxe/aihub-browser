import { describe, it, expect, vi } from 'vitest'
import { askDj } from './askPipeline'

const deps = (chat?: any) => ({ conductor: { instruct: vi.fn() }, runAction: vi.fn(), chat, say: vi.fn() })

describe('askDj', () => {
  it('sends rules to the conductor', async () => {
    const d = deps()
    await askDj("don't play drake", d)
    expect(d.conductor.instruct).toHaveBeenCalledWith(expect.objectContaining({ items: [{ rule: { kind: 'banArtist', artist: 'drake' } }] }))
    expect(d.runAction).not.toHaveBeenCalled()
  })
  it('runs one-shot actions through the existing executor', async () => {
    const d = deps()
    await askDj('skip', d)
    expect(d.runAction).toHaveBeenCalledWith({ type: 'skip' })
  })
  it('asks the model only for what the rules cannot read, and only accepts whitelisted output', async () => {
    const chat = vi.fn(async () => ({ provider: 'openrouter', content: '{"rules":[{"kind":"lessGenre","genre":"trap"}]}' }))
    const d = deps(chat)
    await askDj('the trap stuff is getting old', d)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(d.conductor.instruct).toHaveBeenCalledWith(expect.objectContaining({ items: [{ rule: { kind: 'lessGenre', genre: 'trap' } }] }))
  })
  it('says what it could not do when nothing understood it', async () => {
    const d = deps(async () => ({ provider: 'none', content: 'AI providers are currently unavailable.' }))
    await askDj('the moon is made of cheese', d)
    expect(d.say).toHaveBeenCalledWith(expect.stringMatching(/didn'?t catch/i))
  })
})
