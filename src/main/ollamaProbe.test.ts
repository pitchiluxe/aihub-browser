import { describe, it, expect, vi } from 'vitest'
import { createOllamaProbe } from './ollamaProbe'

const TAGS = JSON.stringify({ models: [{ name: 'llama3.2:3b', capabilities: ['completion', 'tools'], details: { parameter_size: '3.2B' } }] })
const timeout = () => Promise.reject(new Error('timeout'))
type Get = (url: string, ms: number) => Promise<{ status: number; body: string }>

function probe(get: Get, now = { t: 0 }) {
  return { p: createOllamaProbe({ get, bases: () => ['http://127.0.0.1:11434'], now: () => now.t }), now }
}

describe('Ollama probe — a busy local model is still "running"', () => {
  it('reads the model list', async () => {
    const { p } = probe(async () => ({ status: 200, body: TAGS }))
    expect(await p.check(true)).toMatchObject({ running: true, models: ['llama3.2:3b'] })
  })

  it('gives the model list a CPU-sized budget (seen: 3.5–5 s while a model runs)', async () => {
    const budgets: number[] = []
    const { p } = probe(async (_url, ms) => { budgets.push(ms); return { status: 200, body: TAGS } })
    await p.check(true)
    expect(budgets[0]).toBeGreaterThanOrEqual(8000)
  })

  it('model list too slow but Ollama answers /api/version → running, with the last known models', async () => {
    let busy = false
    const { p } = probe(async url => {
      if (url.endsWith('/api/tags')) return busy ? timeout() : { status: 200, body: TAGS }
      return { status: 200, body: '{"version":"0.12"}' }
    })
    await p.check(true)
    busy = true
    expect(await p.check(true)).toMatchObject({ running: true, models: ['llama3.2:3b'] })
  })

  it('one slow round right after a good one does not flip to the cloud (needs 2 misses in a row)', async () => {
    let down = false
    const { p } = probe(async () => down ? timeout() : { status: 200, body: TAGS })
    await p.check(true)
    down = true
    expect((await p.check(true)).running).toBe(true)     // busy, not gone
    expect((await p.check(true)).running).toBe(false)    // really gone
  })

  it('Ollama answering "busy" (503/500) is still Ollama running', async () => {
    const { p } = probe(async () => ({ status: 503, body: '{"error":"server busy, please try again"}' }))
    expect((await p.check(true)).running).toBe(true)
  })

  it('never installed: not running', async () => {
    const { p } = probe(async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) })
    expect((await p.check(true)).running).toBe(false)
  })

  it('"not running" is re-checked within seconds, not served for long (startup race showed "cloud")', async () => {
    let up = false
    const get = vi.fn(async () => up ? { status: 200, body: TAGS } : Promise.reject(new Error('net not ready')))
    const { p, now } = probe(get)
    expect((await p.check(true)).running).toBe(false)
    up = true
    now.t += 4000
    await p.check()                                       // stale "not running": refreshes in the background
    await new Promise(r => setTimeout(r, 0))
    expect((await p.check()).running).toBe(true)
  })

  it('a chat never waits on a re-check: the last result is served while it refreshes', async () => {
    let slow = false
    let resolveSlow: (v: any) => void = () => {}
    const get = vi.fn(async () => slow ? new Promise<any>(r => { resolveSlow = r }) : { status: 200, body: TAGS })
    const { p, now } = probe(get)
    await p.check(true)
    slow = true
    now.t += 60_000                                       // cache expired
    const started = Date.now()
    expect(await p.check()).toMatchObject({ running: true })
    expect(Date.now() - started).toBeLessThan(50)
    resolveSlow({ status: 200, body: TAGS })
  })
})
