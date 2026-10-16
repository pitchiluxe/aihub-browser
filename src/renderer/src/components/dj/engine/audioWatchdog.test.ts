import { describe, expect, it } from 'vitest'
import { AudioWatchdog, STALL_MS, type WatchedContext } from './audioWatchdog'

function fakeCtx(state = 'running') {
  const calls: string[] = []
  const ctx = {
    state,
    currentTime: 0,
    async resume() { calls.push('resume'); ctx.state = 'running' },
    async suspend() { calls.push('suspend'); ctx.state = 'suspended' },
    async setSinkId(id: string | { type: 'none' }) { calls.push('sink:' + (typeof id === 'string' ? id : id.type)) },
  }
  return { ctx: ctx as WatchedContext & typeof ctx, calls }
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

describe('AudioWatchdog', () => {
  it('leaves a moving clock alone', async () => {
    const { ctx, calls } = fakeCtx()
    let now = 0
    const w = new AudioWatchdog(ctx, () => true, () => now, () => {})
    for (let i = 0; i < 200; i++) { now += 20; ctx.currentTime += 0.02; w.check() }
    await flush()
    expect(calls).toEqual([])
  })

  it('ignores a stopped clock while nothing is playing', async () => {
    const { ctx, calls } = fakeCtx('suspended')
    let now = 0
    const w = new AudioWatchdog(ctx, () => false, () => now, () => {})
    for (let i = 0; i < 200; i++) { now += 20; w.check() }
    await flush()
    expect(calls).toEqual([])
  })

  it('resumes a suspended context once a deck plays', async () => {
    const { ctx, calls } = fakeCtx('suspended')
    let now = 0
    const w = new AudioWatchdog(ctx, () => true, () => now, () => {})
    w.check()
    now += STALL_MS - 20; w.check()
    await flush()
    expect(calls).toEqual([])
    now += 40; w.check()
    await flush()
    expect(calls).toEqual(['resume'])
    expect(w.recoveries).toBe(1)
  })

  it('re-opens the default output when "running" with a frozen clock', async () => {
    const { ctx, calls } = fakeCtx('running')
    let now = 0
    const w = new AudioWatchdog(ctx, () => true, () => now, () => {})
    w.check()
    now += STALL_MS + 20; w.check()
    await flush()
    expect(calls).toEqual(['sink:none', 'sink:'])
  })

  it('backs off when the output stays dead', async () => {
    const { ctx, calls } = fakeCtx('running')
    let now = 0
    const w = new AudioWatchdog(ctx, () => true, () => now, () => {})
    w.check()
    for (let i = 0; i < 300; i++) { now += 20; w.check(); await flush() } // 6 s
    // first try at 1.5 s, retries 2 s and 4 s apart → at most 2 attempts in 6 s
    expect(calls.filter(c => c === 'sink:').length).toBe(2)
  })
})
