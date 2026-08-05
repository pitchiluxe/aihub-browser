import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { createJsonStore, createManagedJsonStore, flushAllJsonStores } from './jsonStore'

let dir: string
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Wait for the debounced write to land, rather than sleeping a fixed time and
 * hoping. Under a loaded machine (the full suite in parallel) a fixed sleep
 * raced the timer and failed spuriously — which is worse than no test, because
 * it teaches people to ignore red.
 */
const waitForFile = async (file: string, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true
    await wait(10)
  }
  return false
}

beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'aihub-store-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('createJsonStore', () => {
  it('returns the fallback when the file does not exist', () => {
    const store = createJsonStore(join(dir, 'missing.json'), () => ({ items: [] as string[] }))
    expect(store.get()).toEqual({ items: [] })
  })

  it('returns the fallback when the file is corrupt, without throwing', () => {
    const file = join(dir, 'corrupt.json')
    fs.writeFileSync(file, '{ this is not json')
    const store = createJsonStore(file, () => ['safe'])
    expect(store.get()).toEqual(['safe'])
  })

  it('reads existing contents once and serves them from memory', () => {
    const file = join(dir, 'data.json')
    fs.writeFileSync(file, JSON.stringify([1, 2, 3]))
    const store = createJsonStore<number[]>(file, () => [])
    expect(store.get()).toEqual([1, 2, 3])
    // A write behind the store's back must not be picked up — the whole point
    // is that reads never touch the disk after the first one.
    fs.writeFileSync(file, JSON.stringify([9]))
    expect(store.get()).toEqual([1, 2, 3])
  })

  it('does not write on update until the debounce elapses', async () => {
    const file = join(dir, 'debounced.json')
    const store = createJsonStore<string[]>(file, () => [], { debounceMs: 40 })
    store.update(list => { (list as string[]).push('a') })
    // Nothing on disk yet: the write is deferred, which is the whole point.
    expect(fs.existsSync(file)).toBe(false)
    expect(await waitForFile(file)).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual(['a'])
  })

  it('coalesces a burst of updates into a single write', async () => {
    const file = join(dir, 'burst.json')
    const store = createJsonStore<number[]>(file, () => [], { debounceMs: 30 })
    for (let i = 0; i < 50; i++) store.update(list => { (list as number[]).push(i) })
    expect(fs.existsSync(file)).toBe(false)
    expect(await waitForFile(file)).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toHaveLength(50)
  })

  it('flush writes synchronously and cancels the pending debounce', () => {
    const file = join(dir, 'flushed.json')
    const store = createJsonStore<{ n: number }>(file, () => ({ n: 0 }), { debounceMs: 10_000 })
    store.set({ n: 7 })
    store.flush()
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ n: 7 })
    expect(store.isDirty()).toBe(false)
  })

  it('flush is a no-op when nothing changed', () => {
    const file = join(dir, 'clean.json')
    const store = createJsonStore<number[]>(file, () => [])
    store.get()
    store.flush()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('leaves no temp files behind after writing', async () => {
    const file = join(dir, 'atomic.json')
    const store = createJsonStore<number[]>(file, () => [], { debounceMs: 20 })
    store.set([1])
    expect(await waitForFile(file)).toBe(true)
    store.set([1, 2])
    store.flush()
    const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual([1, 2])
  })

  it('replaces the previous contents rather than appending to them', async () => {
    const file = join(dir, 'replace.json')
    fs.writeFileSync(file, JSON.stringify([1, 2, 3, 4, 5]))
    const store = createJsonStore<number[]>(file, () => [], { debounceMs: 10 })
    store.set([1])
    await waitForFile(file)
    // The replace test needs the CONTENT to settle, not just the file to exist.
    for (let i = 0; i < 100 && JSON.parse(fs.readFileSync(file, 'utf-8')).length !== 1; i++) await wait(10)
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual([1])
  })

  it('writes compact JSON by default and indented when asked', () => {
    const compact = join(dir, 'compact.json')
    const pretty = join(dir, 'pretty.json')
    const a = createJsonStore<{ a: number }>(compact, () => ({ a: 0 }))
    const b = createJsonStore<{ a: number }>(pretty, () => ({ a: 0 }), { pretty: true })
    a.set({ a: 1 }); a.flush()
    b.set({ a: 1 }); b.flush()
    expect(fs.readFileSync(compact, 'utf-8')).toBe('{"a":1}')
    expect(fs.readFileSync(pretty, 'utf-8')).toContain('\n')
  })

  it('creates the containing directory if it is missing', () => {
    const file = join(dir, 'nested', 'deep', 'data.json')
    const store = createJsonStore<number[]>(file, () => [])
    store.set([1])
    store.flush()
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual([1])
  })
})

describe('flushAllJsonStores', () => {
  it('flushes every managed store, so quitting cannot lose pending state', () => {
    const a = join(dir, 'a.json')
    const b = join(dir, 'b.json')
    const storeA = createManagedJsonStore<number[]>(a, () => [], { debounceMs: 10_000 })
    const storeB = createManagedJsonStore<number[]>(b, () => [], { debounceMs: 10_000 })
    storeA.set([1]); storeB.set([2])
    flushAllJsonStores()
    expect(JSON.parse(fs.readFileSync(a, 'utf-8'))).toEqual([1])
    expect(JSON.parse(fs.readFileSync(b, 'utf-8'))).toEqual([2])
  })
})
