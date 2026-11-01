import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { createApiSandbox } from './apiSandbox'

function fixture() {
  const emitter = new EventEmitter()
  const debuggerApi = Object.assign(emitter, {
    attached: false,
    attach() { this.attached = true },
    detach() { this.attached = false; emitter.emit('detach') },
    isAttached() { return this.attached },
    sendCommand: vi.fn(async () => ({})),
  })
  const wc = Object.assign(new EventEmitter(), { id: 1, debugger: debuggerApi }) as unknown as WebContents
  const emit = (method: string, params: unknown) => debuggerApi.emit('message', {}, method, params)
  return { wc, debuggerApi, emit }
}
describe('opt-in API capture', () => {
  it('captures fetch/XHR only, redacts credentials, and releases interception on stop', async () => {
    const { wc, debuggerApi, emit } = fixture()
    const sandbox = createApiSandbox()
    expect(sandbox.snapshot(wc).recording).toBe(false)
    await sandbox.start(wc, true)
    emit('Network.requestWillBeSent', { requestId: 'asset', type: 'Image', request: { url: 'https://example.com/a.png' } })
    emit('Network.requestWillBeSent', { requestId: 'api', type: 'Fetch', request: { url: 'https://example.com/data', method: 'GET', headers: { Authorization: 'secret', Accept: 'application/json' } } })
    emit('Network.responseReceived', { requestId: 'api', response: { status: 201 } })
    const value = sandbox.snapshot(wc)
    expect(value.requests).toHaveLength(1)
    expect(value.requests[0].headers).toEqual({ Accept: 'application/json' })
    expect(value.requests[0].status).toBe(201)
    await sandbox.stop(wc)
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Fetch.disable')
    expect(debuggerApi.attached).toBe(false)
    expect(debuggerApi.listenerCount('message')).toBe(0)
  })
  it('forwards edited paused requests once and keeps unedited authentication intact', async () => {
    const { wc, debuggerApi, emit } = fixture()
    const sandbox = createApiSandbox()
    await sandbox.start(wc, true)
    emit('Fetch.requestPaused', { requestId: 'p1', resourceType: 'XHR', request: { url: 'https://example.com/data', method: 'POST', headers: { Authorization: 'secret', 'Content-Type': 'text/plain' }, postData: 'original' } })
    const row = sandbox.snapshot(wc).requests[0]
    expect(row.paused).toBe(true)
    await sandbox.resolve(wc, row.id, { ...row, body: 'edited' })
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Fetch.continueRequest', expect.objectContaining({ requestId: 'p1', postData: Buffer.from('edited').toString('base64') }))
    const call = debuggerApi.sendCommand.mock.calls.find((args: any[]) => args[0] === 'Fetch.continueRequest') as any
    expect(call[1].headers).toBeUndefined()
    await expect(sandbox.resolve(wc, row.id, row)).rejects.toThrow('no longer paused')
    await sandbox.shutdown()
  })
  it('bounds captured records and rolls back unsupported protocol commands', async () => {
    const { wc, debuggerApi, emit } = fixture()
    const sandbox = createApiSandbox()
    await sandbox.start(wc, false)
    for (let i = 0; i < 210; i++) emit('Network.requestWillBeSent', { requestId: String(i), type: 'Fetch', request: { url: 'https://example.com/data', headers: {} } })
    expect(sandbox.snapshot(wc).requests).toHaveLength(200)
    await sandbox.stop(wc)
    debuggerApi.sendCommand.mockRejectedValueOnce(Error('Unsupported'))
    await expect(sandbox.start(wc, true)).rejects.toThrow('Unsupported')
    expect(debuggerApi.attached).toBe(false)
    expect(sandbox.snapshot(wc).recording).toBe(false)
  })
  it('preserves hidden credentials only within the same origin and supports clearing a body', async () => {
    const { wc, debuggerApi, emit } = fixture()
    const sandbox = createApiSandbox()
    await sandbox.start(wc, true)
    const pause = (id: string) => emit('Fetch.requestPaused', { requestId: id, resourceType: 'XHR', request: { url: 'https://example.com/data?token=private', method: 'POST', headers: { Authorization: 'secret', Accept: 'application/json' }, postData: 'original' } })
    pause('same')
    let row = sandbox.snapshot(wc).requests[0]
    await sandbox.resolve(wc, row.id, { ...row, body: '', headers: { ...row.headers, 'Content-Type': 'text/plain' } })
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Fetch.continueRequest', expect.objectContaining({ requestId: 'same', postData: '', headers: expect.arrayContaining([{ name: 'Authorization', value: 'secret' }]) }))
    const same = (debuggerApi.sendCommand.mock.calls as any[]).find(args => args[0] === 'Fetch.continueRequest')[1]
    expect(same.url).toBeUndefined()
    pause('other')
    row = sandbox.snapshot(wc).requests[0]
    await sandbox.resolve(wc, row.id, { ...row, url: 'https://other.example/data' })
    const other = (debuggerApi.sendCommand.mock.calls as any[]).filter(args => args[0] === 'Fetch.continueRequest').at(-1)[1]
    expect(other.headers).not.toEqual(expect.arrayContaining([{ name: 'Authorization', value: 'secret' }]))
    await sandbox.shutdown()
  })
})
