import { describe, it, expect } from 'vitest'
import { createNetGet, createNetPostJson } from './netGet'

const ok = (status: number, body: string) => async () => ({ status, text: async () => body }) as any

describe('netPostJson — JSON POSTs (Ollama chat/embeddings) the same way', () => {
  it('sends JSON and parses the JSON reply', async () => {
    let seen: any = null
    const post = createNetPostJson(async (url, init: any) => { seen = { url, ...init }; return { status: 200, text: async () => '{"embedding":[1,2]}' } as any })
    expect(await post('http://127.0.0.1:11434/api/embeddings', { model: 'm', prompt: 'p' })).toEqual({ status: 200, data: { embedding: [1, 2] } })
    expect(seen.method).toBe('POST')
    expect(JSON.parse(seen.body)).toEqual({ model: 'm', prompt: 'p' })
    expect(seen.headers['Content-Type']).toBe('application/json')
  })
  it('a non-2xx reply rejects (callers fall through to the next model)', async () => {
    const post = createNetPostJson(async () => ({ status: 404, text: async () => '{"error":"model not found"}' }) as any)
    await expect(post('http://x', {})).rejects.toMatchObject({ status: 404 })
  })
  it('times out like netGet', async () => {
    const post = createNetPostJson((_u, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))))
    await expect(post('http://x', {}, 20)).rejects.toThrow('timeout')
  })
})

describe('netGet — main-process GETs through Chromium\'s network process', () => {
  it('returns status and body', async () => {
    const get = createNetGet(ok(200, '{"a":1}'))
    expect(await get('http://127.0.0.1:11434/api/tags')).toEqual({ status: 200, body: '{"a":1}' })
  })

  it('a slow server rejects with "timeout" (what the retry logic looks for) and aborts the request', async () => {
    let aborted = false
    const get = createNetGet((_url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => { aborted = true; rej(new DOMException('aborted', 'AbortError')) })
    }))
    await expect(get('http://127.0.0.1:11434/api/version', 20)).rejects.toThrow('timeout')
    expect(aborted).toBe(true)
  })

  it('maps Chromium network errors to the Node codes the retry logic knows', async () => {
    const failing = (msg: string) => createNetGet(async () => { throw new TypeError(msg) })
    await expect(failing('net::ERR_NAME_NOT_RESOLVED')('https://x.test')).rejects.toMatchObject({ code: 'ENOTFOUND' })
    await expect(failing('net::ERR_CONNECTION_REFUSED')('https://x.test')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    await expect(failing('net::ERR_CONNECTION_RESET')('https://x.test')).rejects.toMatchObject({ code: 'ECONNRESET' })
    await expect(failing('net::ERR_INTERNET_DISCONNECTED')('https://x.test')).rejects.toMatchObject({ code: 'ENETUNREACH' })
    await expect(failing('net::ERR_CONNECTION_TIMED_OUT')('https://x.test')).rejects.toMatchObject({ code: 'ETIMEDOUT' })
  })
})
