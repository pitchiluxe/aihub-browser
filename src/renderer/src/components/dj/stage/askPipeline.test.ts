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
  it('plays a named song now through the existing mix-in action', async () => {
    const d = deps()
    await askDj('play Calm Down by Rema', d)
    expect(d.runAction).toHaveBeenCalledWith({ type: 'mixin', query: 'calm down rema' })
  })
  it('loads a named deck when asked', async () => {
    const d = { ...deps(), loadDeck: vi.fn() }
    await askDj('play Peru by Fireboy on deck B', d)
    expect(d.loadDeck).toHaveBeenCalledWith('peru fireboy', 'B', true)
    expect(d.say).toHaveBeenCalledWith(expect.stringMatching(/deck b/i))
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
  it('an artist or title on its own lists matching songs (no model call, no "didn\'t catch")', async () => {
    const chat = vi.fn()
    const d = { ...deps(chat), search: vi.fn() }
    await askDj('Wizkid', d)
    expect(d.search).toHaveBeenCalledWith('Wizkid')
    expect(chat).not.toHaveBeenCalled()
    expect(d.say).not.toHaveBeenCalledWith(expect.stringMatching(/didn'?t catch/i))
  })
  it('a style with no set running starts one in that style, and keeps to it', async () => {
    const instruct = vi.fn()
    const startSet = vi.fn(async () => {})
    const d = { ...deps(), conductor: null, startSet, activeConductor: () => ({ instruct }) }
    await askDj('R&B', d as any)
    expect(startSet).toHaveBeenCalledWith('r&b')
    expect(instruct).toHaveBeenCalledWith(expect.objectContaining({ items: [{ rule: { kind: 'onlyGenres', genres: ['r&b'] } }] }))
  })
  it('"songs by X" searches too', async () => {
    const d = { ...deps(), search: vi.fn() }
    await askDj('songs by Burna Boy', d)
    expect(d.search).toHaveBeenCalledWith('burna boy')
  })
  it('says what it could not do when nothing understood it', async () => {
    const d = deps(async () => ({ provider: 'none', content: 'AI providers are currently unavailable.' }))
    await askDj('the moon is made of cheese', d)
    expect(d.say).toHaveBeenCalledWith(expect.stringMatching(/didn'?t catch/i))
  })
})
